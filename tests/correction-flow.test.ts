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

function createService(): ConsultService {
  const dir = mkdtempSync(join(tmpdir(), "rade-correction-flow-"));
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

describe("consult fact correction flow", () => {
  it("updates authoritative consult facts and appends an audit event", () => {
    const service = createService();

    const submitted = service.submitConsult({
      idempotency_key: "submit-correction-1",
      submitter: clinician,
      submitted_answers: {
        c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
        c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
        c04: answer({ kind: "enum", value: "bat" }),
        c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
      },
    });

    expect(submitted.missing_critical_fields.missing_field_ids).toContain("c05");

    const corrected = service.correctConsultFacts({
      idempotency_key: "correct-correction-1",
      consult_id: submitted.consult.consult_id,
      corrected_by: clinician,
      answer_patches: {
        c05: answer({ kind: "binary", value: "yes" }),
      },
      note: "Patient clarified direct bat contact.",
    });

    expect(corrected.consult.current_state).toBe("AWAITING_PH_REVIEW");
    expect(corrected.consult.body.submitted_answers.c05?.value).toEqual({
      kind: "binary",
      value: "yes",
    });
    expect(corrected.missing_critical_fields.missing_field_ids).not.toContain("c05");
    expect(corrected.consult.corrections).toHaveLength(1);
    expect(corrected.audit_events.at(-1)?.event_type).toBe("consult_facts_corrected");

    const replayed = service.correctConsultFacts({
      idempotency_key: "correct-correction-1",
      consult_id: submitted.consult.consult_id,
      corrected_by: clinician,
      answer_patches: {
        c05: answer({ kind: "binary", value: "yes" }),
      },
      note: "Patient clarified direct bat contact.",
    });

    expect(replayed.consult).toEqual(corrected.consult);
    expect(replayed.audit_events).toEqual(corrected.audit_events);
  });
});