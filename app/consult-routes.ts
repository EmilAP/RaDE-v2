// ---------------------------------------------------------------------------
// rade-v2 — Consult workflow routes
// ---------------------------------------------------------------------------

import { Hono, type Context } from "hono";

import { loadCanonicalIntake } from "../intake/loader.js";
import { buildQuestionnaire, getQuestion } from "../intake/questionnaire.js";
import type { AnswerValue } from "../intake/answers.js";
import { getConsultService, getConsultTransformRegistry } from "./consult-runtime.js";
import type {
  ActorRef,
  AcknowledgeRecommendationCommand,
  AuthorRecommendationCommand,
  CorrectConsultFactsCommand,
  ProvenancedAnswer,
  ProvideClarificationCommand,
  RequestClarificationCommand,
  ReturnRecommendationCommand,
  SourceModality,
  SubmitConsultCommand,
} from "../core/consult/types.js";

const consults = new Hono();
const service = getConsultService();
const registry = getConsultTransformRegistry();
const questionnaire = buildQuestionnaire(loadCanonicalIntake().data);

consults.get("/", (c) => {
  return c.json({ consults: service.listConsults() });
});

consults.post("/", async (c) => {
  try {
    const body = await c.req.json<{
      consult_id?: string;
      submitter?: Partial<ActorRef>;
      answers?: Record<string, unknown>;
      narrative_input?: string;
      automation_mode?: SubmitConsultCommand["automation_mode"];
      source_modality?: SourceModality;
      answer_meta?: Record<
        string,
        Partial<Pick<ProvenancedAnswer, "source_modality" | "confidence" | "status">>
      >;
    }>();

    const idempotencyKey = requireIdempotencyKey(c.req.header("Idempotency-Key"), body);
    if (!body.answers) {
      return c.json({ error: "Missing answers payload" }, 400);
    }

    const submitter = coerceActor(body.submitter, "clinician_submitter", "Demo Clinician");
    const submittedAnswers = mapRawAnswersToProvenanced(
      body.answers,
      submitter,
      body.source_modality ?? "clicked",
      body.answer_meta,
    );

    const result = service.submitConsult({
      idempotency_key: idempotencyKey,
      consult_id: body.consult_id,
      submitter,
      submitted_answers: submittedAnswers,
      narrative_input: body.narrative_input,
      automation_mode: body.automation_mode,
    });

    return c.json(result, 201);
  } catch (error) {
    return jsonError(c, error);
  }
});

consults.get("/:consultId", (c) => {
  try {
    return c.json(service.getConsult(c.req.param("consultId")));
  } catch (error) {
    return jsonError(c, error, 404);
  }
});

consults.get("/:consultId/state", (c) => {
  try {
    const view = service.getConsult(c.req.param("consultId"));
    return c.json({
      consult_id: view.consult.consult_id,
      current_state: view.consult.current_state,
      updated_at: view.consult.updated_at,
    });
  } catch (error) {
    return jsonError(c, error, 404);
  }
});

consults.get("/:consultId/audit", (c) => {
  try {
    return c.json({
      consult_id: c.req.param("consultId"),
      audit_events: service.getAuditLog(c.req.param("consultId")),
    });
  } catch (error) {
    return jsonError(c, error, 404);
  }
});

consults.post("/:consultId/clarifications", async (c) => {
  try {
    const body = await c.req.json<{
      requested_by?: Partial<ActorRef>;
      target_question_ids?: string[];
      freeform_question?: string;
      due_by?: string;
    }>();
    const idempotencyKey = requireIdempotencyKey(c.req.header("Idempotency-Key"), body);

    const result = service.requestClarification({
      idempotency_key: idempotencyKey,
      consult_id: c.req.param("consultId"),
      requested_by: coerceActor(body.requested_by, "ph_reviewer", "Demo PH Reviewer"),
      target_question_ids: body.target_question_ids,
      freeform_question: body.freeform_question,
      due_by: body.due_by,
    } satisfies RequestClarificationCommand);

    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

consults.post("/:consultId/clarifications/:clarificationId/response", async (c) => {
  try {
    const body = await c.req.json<{
      responded_by?: Partial<ActorRef>;
      answers?: Record<string, unknown>;
      narrative_update?: string;
      source_modality?: SourceModality;
      answer_meta?: Record<
        string,
        Partial<Pick<ProvenancedAnswer, "source_modality" | "confidence" | "status">>
      >;
    }>();
    const idempotencyKey = requireIdempotencyKey(c.req.header("Idempotency-Key"), body);
    if (!body.answers) {
      return c.json({ error: "Missing clarification answers payload" }, 400);
    }

    const respondent = coerceActor(body.responded_by, "clinician_submitter", "Demo Clinician");
    const patches = mapRawAnswersToProvenanced(
      body.answers,
      respondent,
      body.source_modality ?? "clicked",
      body.answer_meta,
    );

    const result = service.provideClarification({
      idempotency_key: idempotencyKey,
      consult_id: c.req.param("consultId"),
      clarification_id: c.req.param("clarificationId"),
      responded_by: respondent,
      answer_patches: patches,
      narrative_update: body.narrative_update,
    } satisfies ProvideClarificationCommand);

    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

consults.post("/:consultId/corrections", async (c) => {
  try {
    const body = await c.req.json<{
      corrected_by?: Partial<ActorRef>;
      answers?: Record<string, unknown>;
      narrative_update?: string;
      note?: string;
      source_modality?: SourceModality;
      answer_meta?: Record<
        string,
        Partial<Pick<ProvenancedAnswer, "source_modality" | "confidence" | "status">>
      >;
    }>();
    const idempotencyKey = requireIdempotencyKey(c.req.header("Idempotency-Key"), body);
    if (!body.answers && body.narrative_update === undefined) {
      return c.json({ error: "Missing correction answers payload" }, 400);
    }

    const correctedBy = coerceActor(
      body.corrected_by,
      "clinician_submitter",
      "Demo Clinician",
    );
    const patches = mapRawAnswersToProvenanced(
      body.answers ?? {},
      correctedBy,
      body.source_modality ?? "clicked",
      body.answer_meta,
    );

    const result = service.correctConsultFacts({
      idempotency_key: idempotencyKey,
      consult_id: c.req.param("consultId"),
      corrected_by: correctedBy,
      answer_patches: patches,
      narrative_update: body.narrative_update,
      note: body.note,
    } satisfies CorrectConsultFactsCommand);

    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

consults.post("/:consultId/recommendation", async (c) => {
  try {
    const body = await c.req.json<{
      authored_by?: Partial<ActorRef>;
      category: AuthorRecommendationCommand["category"];
      label: string;
      rationale: string;
      urgency: AuthorRecommendationCommand["urgency"];
      follow_up_tasks?: AuthorRecommendationCommand["follow_up_tasks"];
      escalation_required?: boolean;
    }>();
    const idempotencyKey = requireIdempotencyKey(c.req.header("Idempotency-Key"), body);

    const result = service.authorRecommendation({
      idempotency_key: idempotencyKey,
      consult_id: c.req.param("consultId"),
      authored_by: coerceActor(body.authored_by, "ph_reviewer", "Demo PH Reviewer"),
      category: body.category,
      label: body.label,
      rationale: body.rationale,
      urgency: body.urgency,
      follow_up_tasks: body.follow_up_tasks,
      escalation_required: body.escalation_required,
    } satisfies AuthorRecommendationCommand);

    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

consults.post("/:consultId/recommendation/return", async (c) => {
  try {
    const body = await c.req.json<{ returned_by?: Partial<ActorRef> }>();
    const idempotencyKey = requireIdempotencyKey(c.req.header("Idempotency-Key"), body);

    const result = service.returnRecommendation({
      idempotency_key: idempotencyKey,
      consult_id: c.req.param("consultId"),
      returned_by: coerceActor(body.returned_by, "ph_reviewer", "Demo PH Reviewer"),
    } satisfies ReturnRecommendationCommand);

    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

consults.post("/:consultId/acknowledge", async (c) => {
  try {
    const body = await c.req.json<{ acknowledged_by?: Partial<ActorRef> }>();
    const idempotencyKey = requireIdempotencyKey(c.req.header("Idempotency-Key"), body);

    const result = service.acknowledgeRecommendation({
      idempotency_key: idempotencyKey,
      consult_id: c.req.param("consultId"),
      acknowledged_by: coerceActor(body.acknowledged_by, "clinician_submitter", "Demo Clinician"),
    } satisfies AcknowledgeRecommendationCommand);

    return c.json(result);
  } catch (error) {
    return jsonError(c, error);
  }
});

consults.get("/:consultId/artifacts", (c) => {
  return c.json({ artifacts: registry.list() });
});

consults.get("/:consultId/artifacts/:artifactName", (c) => {
  try {
    const artifactName = c.req.param("artifactName");
    const descriptor = registry.getDescriptor(artifactName);
    if (!descriptor) {
      return c.json({ error: `Unknown artifact: ${artifactName}` }, 404);
    }
    if (descriptor.availability === "scaffolded") {
      return c.json({ error: descriptor.gap_reason ?? `Artifact is scaffolded: ${artifactName}` }, 404);
    }

    const consult = service.getConsult(c.req.param("consultId")).consult;
    const artifact = registry.render(artifactName, consult);

    if (artifact.format === "text") {
      return c.text(String(artifact.body));
    }

    return c.json(artifact);
  } catch (error) {
    return jsonError(c, error, 404);
  }
});

export default consults;

function requireIdempotencyKey(
  headerValue: string | undefined,
  body: Record<string, unknown>,
): string {
  const key = headerValue ?? (typeof body.idempotency_key === "string" ? body.idempotency_key : undefined);
  if (!key) {
    throw new Error("Missing Idempotency-Key header or idempotency_key body field");
  }
  return key;
}

function coerceActor(
  input: Partial<ActorRef> | undefined,
  role: ActorRef["role"],
  displayName: string,
): ActorRef {
  return {
    actor_id: input?.actor_id ?? `demo-${role}`,
    role,
    display_name: input?.display_name ?? displayName,
    organization_id: input?.organization_id,
  };
}

function mapRawAnswersToProvenanced(
  raw: Record<string, unknown>,
  actor: ActorRef,
  defaultModality: SourceModality,
  meta:
    | Record<
        string,
        Partial<Pick<ProvenancedAnswer, "source_modality" | "confidence" | "status">>
      >
    | undefined,
): Record<string, ProvenancedAnswer> {
  const result: Record<string, ProvenancedAnswer> = {};

  for (const [questionId, rawValue] of Object.entries(raw)) {
    if (rawValue === undefined || rawValue === null || rawValue === "") continue;
    const question = getQuestion(questionnaire, questionId);
    if (!question) continue;
    const value = normalizeAnswerValue(question.response.type, rawValue);
    if (!value) continue;

    const answerMeta = meta?.[questionId];
    const capturedAt = new Date().toISOString();
    result[questionId] = {
      value,
      source_modality: answerMeta?.source_modality ?? defaultModality,
      confidence: answerMeta?.confidence ?? (defaultModality === "inferred" ? "medium" : "high"),
      status: answerMeta?.status ?? "confirmed",
      captured_by: actor,
      captured_at: capturedAt,
      last_confirmed_by: actor,
      last_confirmed_at: capturedAt,
    };
  }

  return result;
}

function normalizeAnswerValue(
  responseType: string,
  rawValue: unknown,
): AnswerValue | undefined {
  switch (responseType) {
    case "binary_yn":
      return rawValue === "yes"
        ? { kind: "binary", value: "yes" }
        : { kind: "binary", value: "no" };
    case "ternary_ynu":
      return {
        kind: "ternary",
        value: rawValue as "yes" | "no" | "unknown",
      };
    case "enum":
      return { kind: "enum", value: String(rawValue) };
    case "count_enum":
      return { kind: "count_enum", value: String(rawValue) };
    case "multiselect_any": {
      const values = Array.isArray(rawValue)
        ? rawValue.map((entry) => String(entry))
        : [String(rawValue)];
      return { kind: "multiselect", values };
    }
    case "datetime":
      return { kind: "datetime", value: String(rawValue) };
    case "free_text":
      return { kind: "free_text", value: String(rawValue) };
    default:
      return undefined;
  }
}

function jsonError(
  c: Context,
  error: unknown,
  status: 400 | 404 = 400,
) {
  return c.json({ error: error instanceof Error ? error.message : String(error) }, status);
}