import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ConsultService } from "../core/consult/service.js";
import { JsonFileConsultStore } from "../core/consult/store.js";
import type { ActorRef, ProvenancedAnswer } from "../core/consult/types.js";

const clinician: ActorRef = {
  actor_id: "clinician-1",
  role: "clinician_submitter",
  display_name: "Clinician Submitter",
};

const reviewer: ActorRef = {
  actor_id: "ph-1",
  role: "ph_reviewer",
  display_name: "PH Reviewer",
};

function createService(): ConsultService {
  const dir = mkdtempSync(join(tmpdir(), "rade-consult-service-"));
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
    c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
    c04: answer({ kind: "enum", value: "raccoon" }),
    c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
  };
}

describe("consult service happy path", () => {
  it("supports the workflow-first vertical slice without a real engine", () => {
    const service = createService();

    const submitted = service.submitConsult({
      idempotency_key: "submit-1",
      submitter: clinician,
      submitted_answers: buildInitialAnswers(),
      narrative_input: "Raccoon bite to hand.",
    });

    expect(submitted.consult.current_state).toBe("AWAITING_PH_REVIEW");
    expect(submitted.audit_events.map((event) => event.event_type)).toEqual([
      "consult_submitted",
      "consult_ready_for_review",
      "engine_decision_recorded",
    ]);

    const clarification = service.requestClarification({
      idempotency_key: "clarify-1",
      consult_id: submitted.consult.consult_id,
      requested_by: reviewer,
      target_question_ids: ["c25"],
      freeform_question: "Is the animal available for testing or observation?",
    });

    expect(clarification.consult.current_state).toBe("CLARIFICATION_REQUESTED");
    expect(clarification.consult.clarifications).toHaveLength(1);

    const response = service.provideClarification({
      idempotency_key: "clarify-response-1",
      consult_id: submitted.consult.consult_id,
      clarification_id: clarification.consult.clarifications[0]!.request.clarification_id,
      responded_by: clinician,
      answer_patches: {
        c25: answer({ kind: "ternary", value: "yes" }),
      },
    });

    expect(response.consult.current_state).toBe("AWAITING_PH_REVIEW");
    expect(response.missing_critical_fields.missing_field_ids).not.toContain("c25");

    const authored = service.authorRecommendation({
      idempotency_key: "recommend-1",
      consult_id: submitted.consult.consult_id,
      authored_by: reviewer,
      category: "observe_or_test",
      label: "Observe or test pathway",
      rationale: "Animal is available, so PH recommends observation/testing before PEP escalation.",
      urgency: "important",
    });

    expect(authored.consult.current_state).toBe("RECOMMENDATION_AUTHORED");
    expect(authored.consult.recommendation?.label).toBe("Observe or test pathway");

    const returned = service.returnRecommendation({
      idempotency_key: "return-1",
      consult_id: submitted.consult.consult_id,
      returned_by: reviewer,
    });

    expect(returned.consult.current_state).toBe("RECOMMENDATION_RETURNED");
    expect(returned.consult.recommendation?.returned_to_clinician_at).toBeDefined();

    const acknowledged = service.acknowledgeRecommendation({
      idempotency_key: "ack-1",
      consult_id: submitted.consult.consult_id,
      acknowledged_by: clinician,
    });

    expect(acknowledged.consult.current_state).toBe("CLOSED");
    expect(acknowledged.audit_events.at(-2)?.event_type).toBe("recommendation_acknowledged");
    expect(acknowledged.audit_events.at(-1)?.event_type).toBe("consult_closed");
  });
});