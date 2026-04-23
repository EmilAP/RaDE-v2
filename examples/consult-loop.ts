// ---------------------------------------------------------------------------
// rade-v2 — Example: closed-loop consult relay walkthrough
//
// Run: npm run example:consult-loop
// ---------------------------------------------------------------------------

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConsultService } from "../core/consult/service.js";
import { JsonFileConsultStore } from "../core/consult/store.js";
import type { ActorRef, ProvenancedAnswer } from "../core/consult/types.js";

const clinician: ActorRef = {
  actor_id: "clinician-demo-1",
  role: "clinician_submitter",
  display_name: "Demo Clinician",
  organization_id: "clinic-on-001",
};

const reviewer: ActorRef = {
  actor_id: "ph-demo-1",
  role: "ph_reviewer",
  display_name: "Demo PH Reviewer",
  organization_id: "ph-on-001",
};

function createService(): ConsultService {
  const dir = mkdtempSync(join(tmpdir(), "rade-consult-loop-"));
  return new ConsultService(new JsonFileConsultStore(dir));
}

function answer(
  value: ProvenancedAnswer["value"],
  actor: ActorRef = clinician,
): ProvenancedAnswer {
  return {
    value,
    source_modality: "clicked",
    confidence: "high",
    status: value.kind === "unanswered" ? "missing" : "confirmed",
    captured_by: actor,
    captured_at: "2026-04-22T12:00:00.000Z",
    last_confirmed_by: actor,
    last_confirmed_at: "2026-04-22T12:00:00.000Z",
  };
}

function buildInitialAnswers(): Record<string, ProvenancedAnswer> {
  return {
    c01: answer({ kind: "binary", value: "no" }),
    c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
    c03: answer({ kind: "free_text", value: "Toronto, Ontario, Canada" }),
    c04: answer({ kind: "enum", value: "raccoon" }),
    c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
  };
}

function printStep(title: string, lines: string[]): void {
  console.log(`\n=== ${title} ===`);
  for (const line of lines) {
    console.log(line);
  }
}

const service = createService();

printStep("Scenario", [
  "Rabies consult relay demo for a raccoon bite in Ontario.",
  "The engine remains an interim advisory stub, so the workflow still routes through PH review.",
]);

const submitted = service.submitConsult({
  idempotency_key: "consult-loop-submit",
  submitter: clinician,
  submitted_answers: buildInitialAnswers(),
  narrative_input: "Patient bitten on the right hand by a raccoon while removing garbage bins.",
});

printStep("1. Clinician Submits Consult", [
  `Consult ID: ${submitted.consult.consult_id}`,
  `State: ${submitted.consult.current_state}`,
  `Automation mode: ${submitted.consult.automation_mode}`,
  `Automation rationale: ${submitted.automation_resolution.rationale}`,
  `Missing critical fields: ${submitted.missing_critical_fields.missing_field_ids.join(", ") || "none"}`,
  `Engine status: ${submitted.consult.engine_decisions[0]?.status ?? "unknown"}`,
]);

const clarification = service.requestClarification({
  idempotency_key: "consult-loop-clarification-request",
  consult_id: submitted.consult.consult_id,
  requested_by: reviewer,
  freeform_question: "Is the animal available for observation or laboratory testing?",
});

const clarificationId = clarification.consult.clarifications[0]!.request.clarification_id;

printStep("2. PH Requests Clarification", [
  `State: ${clarification.consult.current_state}`,
  `Clarification ID: ${clarificationId}`,
  `Target questions: ${clarification.consult.clarifications[0]!.request.target_question_ids.join(", ")}`,
  `Prompt: ${clarification.consult.clarifications[0]!.request.freeform_question ?? "n/a"}`,
]);

const responded = service.provideClarification({
  idempotency_key: "consult-loop-clarification-response",
  consult_id: submitted.consult.consult_id,
  clarification_id: clarificationId,
  responded_by: clinician,
  answer_patches: {
    c25: answer({ kind: "ternary", value: "yes" }),
  },
  narrative_update:
    "Animal control captured the raccoon, and testing availability was confirmed after PH follow-up.",
});

printStep("3. Clinician Responds", [
  `State: ${responded.consult.current_state}`,
  `Remaining missing fields: ${responded.missing_critical_fields.missing_field_ids.join(", ") || "none"}`,
  `Narrative: ${responded.consult.body.narrative_input ?? "n/a"}`,
]);

const authored = service.authorRecommendation({
  idempotency_key: "consult-loop-author",
  consult_id: submitted.consult.consult_id,
  authored_by: reviewer,
  category: "observe_or_test",
  label: "Observe or test before escalating PEP",
  rationale:
    "The animal is available for observation or testing, so PH advises coordinated follow-up before escalating prophylaxis.",
  urgency: "important",
  follow_up_tasks: [
    {
      task_id: "task-follow-up-animal-control",
      label: "Confirm animal control testing timeline",
      priority: "important",
      task_type: "coordination",
    },
  ],
});

printStep("4. PH Authors Recommendation", [
  `State: ${authored.consult.current_state}`,
  `Recommendation: ${authored.consult.recommendation?.label ?? "n/a"}`,
  `Urgency: ${authored.consult.recommendation?.urgency ?? "n/a"}`,
]);

const returned = service.returnRecommendation({
  idempotency_key: "consult-loop-return",
  consult_id: submitted.consult.consult_id,
  returned_by: reviewer,
});

printStep("5. Recommendation Returned", [
  `State: ${returned.consult.current_state}`,
  `Returned at: ${returned.consult.recommendation?.returned_to_clinician_at ?? "n/a"}`,
]);

const acknowledged = service.acknowledgeRecommendation({
  idempotency_key: "consult-loop-acknowledge",
  consult_id: submitted.consult.consult_id,
  acknowledged_by: clinician,
});

printStep("6. Clinician Acknowledges", [
  `State: ${acknowledged.consult.current_state}`,
  `Acknowledged at: ${acknowledged.consult.recommendation?.acknowledged_at ?? "n/a"}`,
]);

printStep(
  "Audit Trail",
  acknowledged.audit_events.map(
    (event, index) =>
      `${index + 1}. ${event.event_type} | ${event.from_state ?? "-"} -> ${event.to_state ?? "-"} | ${event.actor.role}`,
  ),
);