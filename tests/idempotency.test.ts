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
  const dir = mkdtempSync(join(tmpdir(), "rade-idempotency-"));
  return new ConsultService(new JsonFileConsultStore(dir));
}

function answer(value: ProvenancedAnswer["value"]): ProvenancedAnswer {
  return {
    value,
    source_modality: "clicked",
    confidence: "high",
    status: "confirmed",
    captured_by: clinician,
    captured_at: "2026-04-22T12:00:00.000Z",
    last_confirmed_by: clinician,
    last_confirmed_at: "2026-04-22T12:00:00.000Z",
  };
}

describe("consult command idempotency", () => {
  it("deduplicates submit retries by idempotency key", () => {
    const service = createService();
    const command = {
      idempotency_key: "submit-retry-1",
      submitter: clinician,
      submitted_answers: {
        c01: answer({ kind: "binary", value: "no" }),
        c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
        c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
        c04: answer({ kind: "enum", value: "raccoon" }),
        c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
      },
    };

    const first = service.submitConsult(command);
    const second = service.submitConsult(command);

    expect(second.consult.consult_id).toBe(first.consult.consult_id);
    expect(second.audit_events).toHaveLength(first.audit_events.length);
    expect(service.listConsults()).toHaveLength(1);
  });
});