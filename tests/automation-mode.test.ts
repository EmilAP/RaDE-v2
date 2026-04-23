import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { replayState } from "../core/consult/audit.js";
import { ConsultService } from "../core/consult/service.js";
import { JsonFileConsultStore } from "../core/consult/store.js";
import type { ActorRef, AutomationMode, ProvenancedAnswer } from "../core/consult/types.js";

const clinician: ActorRef = {
  actor_id: "clinician-1",
  role: "clinician_submitter",
  display_name: "Clinician Submitter",
};

function createService(): ConsultService {
  const dir = mkdtempSync(join(tmpdir(), "rade-automation-mode-"));
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

function buildInitialAnswers(): Record<string, ProvenancedAnswer> {
  return {
    c01: answer({ kind: "binary", value: "no" }),
    c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
    c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
    c04: answer({ kind: "enum", value: "raccoon" }),
    c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
  };
}

describe("automation mode resolution", () => {
  it("resolves the default automation mode inside submitConsult", () => {
    const service = createService();

    const submitted = service.submitConsult({
      idempotency_key: "automation-default",
      submitter: clinician,
      submitted_answers: buildInitialAnswers(),
    });

    expect(submitted.consult.automation_mode).toBe("PH_REQUIRED");
    expect(submitted.automation_resolution.mode).toBe("PH_REQUIRED");
    expect(submitted.consult.current_state).toBe("AWAITING_PH_REVIEW");
    expect(submitted.audit_events[0]?.payload?.automation_mode).toBe("PH_REQUIRED");
  });

  it.each(["PH_OPTIONAL", "AUTO_ALLOWED"] as const)(
    "stores %s from the service-layer policy but keeps workflow-first PH review",
    (mode: AutomationMode) => {
      const service = createService();

      const submitted = service.submitConsult({
        idempotency_key: `automation-${mode.toLowerCase()}`,
        submitter: clinician,
        submitted_answers: buildInitialAnswers(),
        automation_mode: mode,
      });

      expect(submitted.consult.automation_mode).toBe(mode);
      expect(submitted.automation_resolution.mode).toBe(mode);
      expect(submitted.consult.current_state).toBe("AWAITING_PH_REVIEW");
      expect(submitted.audit_events.map((event) => event.event_type)).toEqual([
        "consult_submitted",
        "consult_ready_for_review",
        "engine_decision_recorded",
      ]);
    },
  );

  it("deduplicates idempotent submit retries under automation resolution", () => {
    const service = createService();
    const command = {
      idempotency_key: "automation-retry-auto-allowed",
      submitter: clinician,
      submitted_answers: buildInitialAnswers(),
      automation_mode: "AUTO_ALLOWED" as const,
    };

    const first = service.submitConsult(command);
    const second = service.submitConsult(command);

    expect(second.consult.consult_id).toBe(first.consult.consult_id);
    expect(second.consult.automation_mode).toBe("AUTO_ALLOWED");
    expect(second.audit_events).toHaveLength(first.audit_events.length);
    expect(second.audit_events.map((event) => event.event_id)).toEqual(
      first.audit_events.map((event) => event.event_id),
    );
    expect(service.listConsults()).toHaveLength(1);
  });

  it("keeps audit replay and consult state authoritative after automation resolution", () => {
    const service = createService();

    const submitted = service.submitConsult({
      idempotency_key: "automation-replay",
      submitter: clinician,
      submitted_answers: buildInitialAnswers(),
      automation_mode: "PH_OPTIONAL",
    });

    const reloaded = service.getConsult(submitted.consult.consult_id);

    expect(replayState(reloaded.audit_events)).toBe(reloaded.consult.current_state);
    expect(reloaded.consult.automation_mode).toBe("PH_OPTIONAL");
    expect(reloaded.automation_resolution.mode).toBe("PH_OPTIONAL");
    expect(reloaded.audit_events[0]?.payload?.automation_mode).toBe("PH_OPTIONAL");
  });
});