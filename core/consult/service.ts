// ---------------------------------------------------------------------------
// rade-v2 — Consult workflow service (idempotent, workflow-first)
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
  buildCanonicalPayload,
  getNormalizedAnswer,
  type CanonicalCasePayload,
} from "../../intake/payload.js";
import { buildAnswerSet, withProvenance, type AnswerValue } from "../../intake/answers.js";
import { buildQuestionnaire } from "../../intake/questionnaire.js";
import { loadCanonicalIntake } from "../../intake/loader.js";
import {
  appendEvents,
  createAuditEvent,
  replayState,
  type AuditEvent,
} from "./audit.js";
import { createMissingCriticalFieldResolver, type MissingCriticalFieldResolution, type MissingCriticalFieldResolver } from "./missing-fields.js";
import {
  assertTransition,
  initialConsultState,
  isTerminalState,
  type ConsultState,
} from "./state.js";
import {
  createInterimEngineDecision,
  SYSTEM_ACTOR,
  type AcknowledgeRecommendationCommand,
  type AuthorRecommendationCommand,
  type CanonicalConsult,
  type ClarificationThread,
  type CorrectConsultFactsCommand,
  type EngineDecision,
  type ProvideClarificationCommand,
  type ProvenancedAnswer,
  type RequestClarificationCommand,
  type ReturnRecommendationCommand,
  type SubmitConsultCommand,
} from "./types.js";
import {
  JsonFileConsultStore,
  type ConsultStore,
  type PersistedConsultRecord,
  type StoredCommandResult,
} from "./store.js";
import { assertReplayCompatible } from "./idempotency.js";
import {
  resolveAutomationMode,
  type AutomationResolution,
} from "../policy/automation.js";

export type ConsultView = {
  consult: CanonicalConsult;
  audit_events: AuditEvent[];
  missing_critical_fields: MissingCriticalFieldResolution;
  automation_resolution: AutomationResolution;
};

export type ConsultSummary = {
  consult_id: string;
  current_state: ConsultState;
  updated_at: string;
  missing_critical_count: number;
  has_recommendation: boolean;
};

const questionnaire = buildQuestionnaire(loadCanonicalIntake().data);

export class ConsultService {
  constructor(
    private readonly store: ConsultStore = new JsonFileConsultStore(),
    private readonly resolver: MissingCriticalFieldResolver = createMissingCriticalFieldResolver(),
  ) {}

  listConsults(): ConsultSummary[] {
    return this.store.listConsultRecords().map((record) => {
      const resolution = this.resolver.resolve(record.consult);
      return {
        consult_id: record.consult.consult_id,
        current_state: record.consult.current_state,
        updated_at: record.consult.updated_at,
        missing_critical_count: resolution.missing_field_ids.length,
        has_recommendation: !!record.consult.recommendation,
      };
    });
  }

  getConsult(consultId: string): ConsultView {
    const record = this.requireRecord(consultId);
    return this.toView(record);
  }

  getAuditLog(consultId: string): AuditEvent[] {
    return this.requireRecord(consultId).audit_events;
  }

  submitConsult(command: SubmitConsultCommand): ConsultView {
    return this.runIdempotent<ConsultView>(
      "submit_consult",
      command.idempotency_key,
      () => {
        const consultId = command.consult_id ?? randomUUID();
        if (this.store.loadConsultRecord(consultId)) {
          throw new Error(`Consult already exists: ${consultId}`);
        }

        const createdAt = new Date().toISOString();
        const payload = this.buildPayload(command.submitted_answers);
        const automationResolution = resolveAutomationMode({
          payload,
          requested_mode: command.automation_mode,
        });
        const resolution = this.resolver.resolve({
          consult_id: consultId,
          created_at: createdAt,
          updated_at: createdAt,
          module_id: "rabies",
          schema_version: payload.intake_metadata.schema_version,
          automation_mode: automationResolution.mode,
          parties: { submitter: command.submitter },
          body: {
            schema_id: payload.schema_id,
            payload,
            submitted_answers: command.submitted_answers,
            narrative_input: command.narrative_input,
          },
          engine_decisions: [],
          clarifications: [],
          corrections: [],
          escalation_events: [],
          current_state: initialConsultState(),
        });

        const engineDecisions = command.engine_decision
          ? [command.engine_decision]
          : [
              createInterimEngineDecision({
                missing_critical_fields: resolution.missing_field_ids,
              }),
            ];

        const consult: CanonicalConsult = {
          consult_id: consultId,
          created_at: createdAt,
          updated_at: createdAt,
          module_id: "rabies",
          schema_version: payload.intake_metadata.schema_version,
          automation_mode: automationResolution.mode,
          parties: { submitter: command.submitter },
          body: {
            schema_id: payload.schema_id,
            payload,
            submitted_answers: command.submitted_answers,
            narrative_input: command.narrative_input,
          },
          engine_decisions: engineDecisions,
          clarifications: [],
          corrections: [],
          escalation_events: [],
          current_state: initialConsultState(),
        };

        const auditEvents: AuditEvent[] = [
          createAuditEvent({
            consult_id: consultId,
            event_type: "consult_submitted",
            actor: command.submitter,
            from_state: "DRAFT",
            to_state: "SUBMITTED",
            idempotency_key: command.idempotency_key,
            payload: { automation_mode: consult.automation_mode },
          }),
          createAuditEvent({
            consult_id: consultId,
            event_type: "consult_ready_for_review",
            actor: SYSTEM_ACTOR,
            from_state: "SUBMITTED",
            to_state: "AWAITING_PH_REVIEW",
            idempotency_key: command.idempotency_key,
          }),
          createAuditEvent({
            consult_id: consultId,
            event_type: "engine_decision_recorded",
            actor: SYSTEM_ACTOR,
            idempotency_key: command.idempotency_key,
            payload: { status: engineDecisions[0].status },
          }),
        ];

        consult.current_state = replayState(auditEvents);
        consult.updated_at = auditEvents[auditEvents.length - 1]!.at;

        const record = { consult, audit_events: auditEvents } satisfies PersistedConsultRecord;
        this.store.saveConsultRecord(record);
        return this.toView(record);
      },
    );
  }

  requestClarification(command: RequestClarificationCommand): ConsultView {
    return this.runIdempotent<ConsultView>(
      "request_clarification",
      command.idempotency_key,
      () => {
        const record = this.requireRecord(command.consult_id);
        assertTransition(record.consult.current_state, "CLARIFICATION_REQUESTED");

        const resolution = this.resolver.resolve(record.consult);
        const targetQuestionIds =
          command.target_question_ids && command.target_question_ids.length > 0
            ? command.target_question_ids
            : resolution.clarification_targets;

        if (targetQuestionIds.length === 0) {
          throw new Error("No clarification targets available for this consult");
        }

        const request = {
          clarification_id: randomUUID(),
          consult_id: command.consult_id,
          requested_by: command.requested_by,
          requested_at: new Date().toISOString(),
          target_question_ids: targetQuestionIds,
          freeform_question: command.freeform_question,
          due_by: command.due_by,
          resolver_snapshot: {
            missing_field_ids: resolution.missing_field_ids,
            clarification_targets: resolution.clarification_targets,
            blocking_reasons: resolution.blocking_reasons,
          },
        };

        const nextConsult: CanonicalConsult = {
          ...record.consult,
          updated_at: request.requested_at,
          parties: {
            ...record.consult.parties,
            reviewer: command.requested_by,
          },
          clarifications: [
            ...record.consult.clarifications,
            { request } satisfies ClarificationThread,
          ],
        };

        const nextEvents = appendEvents(record.audit_events, [
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "clarification_requested",
            actor: command.requested_by,
            from_state: record.consult.current_state,
            to_state: "CLARIFICATION_REQUESTED",
            idempotency_key: command.idempotency_key,
            payload: {
              clarification_id: request.clarification_id,
              target_question_ids: request.target_question_ids,
            },
          }),
        ]);

        nextConsult.current_state = replayState(nextEvents);
        const nextRecord = { consult: nextConsult, audit_events: nextEvents };
        this.store.saveConsultRecord(nextRecord);
        return this.toView(nextRecord);
      },
    );
  }

  provideClarification(command: ProvideClarificationCommand): ConsultView {
    return this.runIdempotent<ConsultView>(
      "provide_clarification",
      command.idempotency_key,
      () => {
        const record = this.requireRecord(command.consult_id);
        assertTransition(record.consult.current_state, "CLARIFICATION_PROVIDED");

        const clarificationIndex = record.consult.clarifications.findIndex(
          (thread) => thread.request.clarification_id === command.clarification_id,
        );

        if (clarificationIndex < 0) {
          throw new Error(`Unknown clarification: ${command.clarification_id}`);
        }

        const response = {
          response_id: randomUUID(),
          clarification_id: command.clarification_id,
          responded_by: command.responded_by,
          responded_at: new Date().toISOString(),
          answer_patches: command.answer_patches,
          narrative_update: command.narrative_update,
          idempotency_key: command.idempotency_key,
        };

        const updatedAnswers = {
          ...record.consult.body.submitted_answers,
          ...command.answer_patches,
        };

        const updatedThreads = [...record.consult.clarifications];
        updatedThreads[clarificationIndex] = {
          ...updatedThreads[clarificationIndex]!,
          response,
        };

        const updatedPayload = this.buildPayload(updatedAnswers);
        const nextConsult: CanonicalConsult = {
          ...record.consult,
          updated_at: response.responded_at,
          body: {
            ...record.consult.body,
            payload: updatedPayload,
            submitted_answers: updatedAnswers,
            narrative_input: command.narrative_update ?? record.consult.body.narrative_input,
          },
          clarifications: updatedThreads,
        };

        const nextEvents = appendEvents(record.audit_events, [
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "clarification_responded",
            actor: command.responded_by,
            from_state: record.consult.current_state,
            to_state: "CLARIFICATION_PROVIDED",
            idempotency_key: command.idempotency_key,
            payload: { clarification_id: command.clarification_id },
          }),
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "consult_ready_for_review",
            actor: SYSTEM_ACTOR,
            from_state: "CLARIFICATION_PROVIDED",
            to_state: "AWAITING_PH_REVIEW",
            idempotency_key: command.idempotency_key,
          }),
        ]);

        nextConsult.current_state = replayState(nextEvents);
        const nextRecord = { consult: nextConsult, audit_events: nextEvents };
        this.store.saveConsultRecord(nextRecord);
        return this.toView(nextRecord);
      },
    );
  }

  correctConsultFacts(command: CorrectConsultFactsCommand): ConsultView {
    return this.runIdempotent<ConsultView>(
      "correct_consult_facts",
      command.idempotency_key,
      () => {
        const record = this.requireRecord(command.consult_id);

        if (isTerminalState(record.consult.current_state)) {
          throw new Error("Cannot correct consult facts after the consult is closed or cancelled");
        }

        if (record.consult.current_state === "CLARIFICATION_REQUESTED") {
          throw new Error("Use the clarification response flow while a clarification request is open");
        }

        if (
          Object.keys(command.answer_patches).length === 0 &&
          command.narrative_update === undefined
        ) {
          throw new Error("Correction requires at least one answer patch or narrative update");
        }

        const correctedAt = new Date().toISOString();
        const correctionId = randomUUID();
        const updatedAnswers = {
          ...record.consult.body.submitted_answers,
          ...command.answer_patches,
        };
        const updatedPayload = this.buildPayload(updatedAnswers);
        const corrections = [
          ...(record.consult.corrections ?? []),
          {
            correction_id: correctionId,
            corrected_by: command.corrected_by,
            corrected_at: correctedAt,
            answer_patches: command.answer_patches,
            narrative_update: command.narrative_update,
            note: command.note,
            idempotency_key: command.idempotency_key,
          },
        ];

        const nextConsult: CanonicalConsult = {
          ...record.consult,
          updated_at: correctedAt,
          body: {
            ...record.consult.body,
            payload: updatedPayload,
            submitted_answers: updatedAnswers,
            narrative_input:
              command.narrative_update ?? record.consult.body.narrative_input,
          },
          corrections,
        };

        const nextEvents = appendEvents(record.audit_events, [
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "consult_facts_corrected",
            actor: command.corrected_by,
            idempotency_key: command.idempotency_key,
            payload: {
              correction_id: correctionId,
              corrected_question_ids: Object.keys(command.answer_patches),
              note: command.note,
            },
          }),
        ]);

        nextConsult.current_state = replayState(nextEvents);
        const nextRecord = { consult: nextConsult, audit_events: nextEvents };
        this.store.saveConsultRecord(nextRecord);
        return this.toView(nextRecord);
      },
    );
  }

  authorRecommendation(command: AuthorRecommendationCommand): ConsultView {
    return this.runIdempotent<ConsultView>(
      "author_recommendation",
      command.idempotency_key,
      () => {
        const record = this.requireRecord(command.consult_id);
        assertTransition(record.consult.current_state, "RECOMMENDATION_AUTHORED");

        const authoredAt = new Date().toISOString();
        const recommendation = {
          recommendation_id: randomUUID(),
          consult_id: command.consult_id,
          authored_by: command.authored_by,
          authored_at: authoredAt,
          category: command.category,
          label: command.label,
          rationale: command.rationale,
          urgency: command.urgency,
          follow_up_tasks: command.follow_up_tasks ?? [],
          escalation_required: command.escalation_required ?? false,
          signed_at: authoredAt,
          engine_decision_ref: record.consult.engine_decisions[0]?.decision_id,
          policy_overlays_applied: command.policy_overlays_applied ?? [],
        };

        const nextConsult: CanonicalConsult = {
          ...record.consult,
          updated_at: authoredAt,
          parties: {
            ...record.consult.parties,
            reviewer: command.authored_by,
          },
          recommendation,
        };

        const nextEvents = appendEvents(record.audit_events, [
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "recommendation_authored",
            actor: command.authored_by,
            from_state: record.consult.current_state,
            to_state: "RECOMMENDATION_AUTHORED",
            idempotency_key: command.idempotency_key,
            payload: { recommendation_id: recommendation.recommendation_id },
          }),
        ]);

        nextConsult.current_state = replayState(nextEvents);
        const nextRecord = { consult: nextConsult, audit_events: nextEvents };
        this.store.saveConsultRecord(nextRecord);
        return this.toView(nextRecord);
      },
    );
  }

  returnRecommendation(command: ReturnRecommendationCommand): ConsultView {
    return this.runIdempotent<ConsultView>(
      "return_recommendation",
      command.idempotency_key,
      () => {
        const record = this.requireRecord(command.consult_id);
        assertTransition(record.consult.current_state, "RECOMMENDATION_RETURNED");
        if (!record.consult.recommendation) {
          throw new Error("Cannot return a recommendation before one is authored");
        }

        const returnedAt = new Date().toISOString();
        const nextConsult: CanonicalConsult = {
          ...record.consult,
          updated_at: returnedAt,
          recommendation: {
            ...record.consult.recommendation,
            returned_by: command.returned_by,
            returned_to_clinician_at: returnedAt,
          },
        };

        const nextEvents = appendEvents(record.audit_events, [
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "recommendation_returned",
            actor: command.returned_by,
            from_state: record.consult.current_state,
            to_state: "RECOMMENDATION_RETURNED",
            idempotency_key: command.idempotency_key,
          }),
        ]);

        nextConsult.current_state = replayState(nextEvents);
        const nextRecord = { consult: nextConsult, audit_events: nextEvents };
        this.store.saveConsultRecord(nextRecord);
        return this.toView(nextRecord);
      },
    );
  }

  acknowledgeRecommendation(command: AcknowledgeRecommendationCommand): ConsultView {
    return this.runIdempotent<ConsultView>(
      "acknowledge_recommendation",
      command.idempotency_key,
      () => {
        const record = this.requireRecord(command.consult_id);
        assertTransition(record.consult.current_state, "ACKNOWLEDGED");
        if (!record.consult.recommendation) {
          throw new Error("Cannot acknowledge a recommendation before one is returned");
        }

        const acknowledgedAt = new Date().toISOString();
        const nextConsult: CanonicalConsult = {
          ...record.consult,
          updated_at: acknowledgedAt,
          recommendation: {
            ...record.consult.recommendation,
            acknowledged_by: command.acknowledged_by,
            acknowledged_at: acknowledgedAt,
          },
        };

        const nextEvents = appendEvents(record.audit_events, [
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "recommendation_acknowledged",
            actor: command.acknowledged_by,
            from_state: record.consult.current_state,
            to_state: "ACKNOWLEDGED",
            idempotency_key: command.idempotency_key,
          }),
          createAuditEvent({
            consult_id: command.consult_id,
            event_type: "consult_closed",
            actor: command.acknowledged_by,
            from_state: "ACKNOWLEDGED",
            to_state: "CLOSED",
            idempotency_key: command.idempotency_key,
          }),
        ]);

        nextConsult.current_state = replayState(nextEvents);
        const nextRecord = { consult: nextConsult, audit_events: nextEvents };
        this.store.saveConsultRecord(nextRecord);
        return this.toView(nextRecord);
      },
    );
  }

  private toView(record: PersistedConsultRecord): ConsultView {
    return {
      consult: record.consult,
      audit_events: record.audit_events,
      missing_critical_fields: this.resolver.resolve(record.consult),
      automation_resolution: resolveAutomationMode({ consult: record.consult }),
    };
  }

  private requireRecord(consultId: string): PersistedConsultRecord {
    const record = this.store.loadConsultRecord(consultId);
    if (!record) {
      throw new Error(`Consult not found: ${consultId}`);
    }
    return record;
  }

  private runIdempotent<TResult>(
    commandName: string,
    idempotencyKey: string,
    fn: () => TResult,
  ): TResult {
    const existing = this.store.getCommandResult<TResult>(idempotencyKey);
    if (existing) {
      assertReplayCompatible(existing as StoredCommandResult<unknown>, commandName);
      return existing.result;
    }

    const result = fn();
    const consultId = this.extractConsultId(result);
    this.store.saveCommandResult({
      idempotency_key: idempotencyKey,
      command_name: commandName,
      consult_id: consultId,
      recorded_at: new Date().toISOString(),
      result,
    } satisfies StoredCommandResult<TResult>);
    return result;
  }

  private extractConsultId(result: unknown): string | undefined {
    if (
      typeof result === "object" &&
      result !== null &&
      "consult" in result &&
      typeof (result as { consult?: { consult_id?: unknown } }).consult?.consult_id === "string"
    ) {
      return (result as { consult: { consult_id: string } }).consult.consult_id;
    }
    return undefined;
  }

  private buildPayload(
    submittedAnswers: Record<string, ProvenancedAnswer>,
  ): CanonicalCasePayload {
    const entries = Object.entries(submittedAnswers).map(
      ([questionId, answer]) => [
        questionId,
        withProvenance(answer.value, {
          source_modality: answer.source_modality,
          confidence: answer.confidence,
          status: answer.status,
          captured_by: answer.captured_by,
          captured_at: answer.captured_at,
          last_confirmed_by: answer.last_confirmed_by,
          last_confirmed_at: answer.last_confirmed_at,
        }),
      ] as [string, ReturnType<typeof withProvenance>],
    );
    return buildCanonicalPayload(buildAnswerSet(entries), questionnaire);
  }
}

export function createConsultService(
  store?: ConsultStore,
  resolver?: MissingCriticalFieldResolver,
): ConsultService {
  return new ConsultService(store, resolver);
}