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
  const dir = mkdtempSync(join(tmpdir(), "rade-missing-fields-"));
  return new ConsultService(new JsonFileConsultStore(dir));
}

function answer(value: ProvenancedAnswer["value"]): ProvenancedAnswer {
  return {
    value,
    source_modality: "clicked",
    confidence: "high",
    status: value.kind === "unanswered" ? "missing" : "confirmed",
    captured_by: clinician,
    captured_at: "2026-04-22T12:00:00.000Z",
    last_confirmed_by: clinician,
    last_confirmed_at: "2026-04-22T12:00:00.000Z",
  };
}

describe("missing critical field resolver", () => {
  it("flags blocking rabies review fields and keeps follow-up context separate", () => {
    const service = createService();

    const submitted = service.submitConsult({
      idempotency_key: "missing-fields-raccoon",
      submitter: clinician,
      submitted_answers: {
        c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
        c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
        c04: answer({ kind: "enum", value: "raccoon" }),
        c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
      },
    });

    expect(submitted.missing_critical_fields.blocking_field_ids).toEqual(
      expect.arrayContaining(["c18", "c25"]),
    );
    expect(submitted.missing_critical_fields.non_blocking_field_ids).toEqual(
      expect.arrayContaining(["c01", "c14", "c23"]),
    );
    expect(submitted.missing_critical_fields.blocking_reasons).toContain(
      "critical_intake_fields_missing",
    );
  });

  it("requires bat-specific exposure context when the species remains bat-related", () => {
    const service = createService();

    const submitted = service.submitConsult({
      idempotency_key: "missing-fields-bat",
      submitter: clinician,
      submitted_answers: {
        c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
        c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
        c04: answer({ kind: "enum", value: "bat" }),
        c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
        c18: answer({ kind: "ternary", value: "unknown" }),
        c25: answer({ kind: "ternary", value: "no" }),
      },
    });

    expect(submitted.missing_critical_fields.blocking_field_ids).toContain("c05");
  });
});