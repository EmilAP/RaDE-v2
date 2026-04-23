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
  const dir = mkdtempSync(join(tmpdir(), "rade-clarification-"));
  return new ConsultService(new JsonFileConsultStore(dir));
}

function answer(value: ProvenancedAnswer["value"], actor: ActorRef): ProvenancedAnswer {
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

describe("clarification loop", () => {
  it("centralizes clarification targets and returns the consult to PH review", () => {
    const service = createService();
    const submitted = service.submitConsult({
      idempotency_key: "submit-clarification",
      submitter: clinician,
      submitted_answers: {
        c01: answer({ kind: "binary", value: "no" }, clinician),
        c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }, clinician),
        c03: answer({ kind: "free_text", value: "Ontario, Canada" }, clinician),
        c04: answer({ kind: "enum", value: "raccoon" }, clinician),
        c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }, clinician),
      },
    });

    expect(submitted.missing_critical_fields.missing_field_ids).toContain("c25");

    const clarification = service.requestClarification({
      idempotency_key: "request-clarification",
      consult_id: submitted.consult.consult_id,
      requested_by: reviewer,
    });

    expect(clarification.consult.clarifications[0]?.request.target_question_ids).toContain("c25");

    const responded = service.provideClarification({
      idempotency_key: "respond-clarification",
      consult_id: submitted.consult.consult_id,
      clarification_id: clarification.consult.clarifications[0]!.request.clarification_id,
      responded_by: clinician,
      answer_patches: {
        c25: answer({ kind: "ternary", value: "yes" }, clinician),
      },
    });

    expect(responded.consult.current_state).toBe("AWAITING_PH_REVIEW");
    expect(responded.missing_critical_fields.missing_field_ids).not.toContain("c25");
  });
});