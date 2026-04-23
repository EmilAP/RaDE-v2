import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { INTAKE_HTML, getIntakeConstraintWarnings } from "../app/intake-routes.js";
import { renderPhConsultDetailPage } from "../app/ph-routes.js";
import { renderConsultStatusPage } from "../app/consult-status-page.js";
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
  const dir = mkdtempSync(join(tmpdir(), "rade-consult-ui-"));
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

function buildSubmittedView() {
  const service = createService();
  return service.submitConsult({
    idempotency_key: "consult-ui-submit",
    submitter: clinician,
    submitted_answers: {
      c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
      c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
      c04: answer({ kind: "enum", value: "raccoon" }),
      c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
    },
  });
}

describe("consult workflow UI", () => {
  it("does not keep raw JSON dumps in the main clinician or PH views", () => {
    const view = buildSubmittedView();

    const clinicianHtml = renderConsultStatusPage({ view, artifacts: [] });
    const phHtml = renderPhConsultDetailPage(view);

    expect(clinicianHtml).toContain("AWAITING_PH_REVIEW");
    expect(clinicianHtml).not.toContain("Submitted summary");
    expect(clinicianHtml).not.toContain("\"schema_id\"");
    expect(phHtml).not.toContain("Consult Body");
    expect(phHtml).not.toContain("\"payload_id\"");
    expect(phHtml).not.toContain("\"event_type\"");
  });

  it("shows the current state and a simple workflow timeline on the clinician status page", () => {
    const service = createService();
    const submitted = service.submitConsult({
      idempotency_key: "consult-ui-timeline-submit",
      submitter: clinician,
      submitted_answers: {
        c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
        c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
        c04: answer({ kind: "enum", value: "raccoon" }),
        c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
      },
    });

    const clarification = service.requestClarification({
      idempotency_key: "consult-ui-timeline-clarify",
      consult_id: submitted.consult.consult_id,
      requested_by: reviewer,
      target_question_ids: ["c25"],
      freeform_question: "Is the animal available for testing?",
    });

    const html = renderConsultStatusPage({
      view: clarification,
      artifacts: [],
    });

    expect(html).toContain("Current state:");
    expect(html).toContain("CLARIFICATION_REQUESTED");
    expect(html).toContain("Workflow timeline");
    expect(html).toContain("Submitted");
    expect(html).toContain("Clarification requested");
  });

  it("renders answer review sections and recent correction markers on both pages", () => {
    const service = createService();
    const submitted = service.submitConsult({
      idempotency_key: "consult-ui-correction-submit",
      submitter: clinician,
      submitted_answers: {
        c02: answer({ kind: "datetime", value: "2026-04-20T10:00:00Z" }),
        c03: answer({ kind: "free_text", value: "Ontario, Canada" }),
        c04: answer({ kind: "enum", value: "bat" }),
        c12: answer({ kind: "multiselect", values: ["bite_transdermal_or_bleeding"] }),
      },
    });

    const corrected = service.correctConsultFacts({
      idempotency_key: "consult-ui-correction-update",
      consult_id: submitted.consult.consult_id,
      corrected_by: clinician,
      answer_patches: {
        c05: answer({ kind: "binary", value: "yes" }),
      },
      note: "Added the missing bat-specific exposure detail.",
    });

    const clinicianHtml = renderConsultStatusPage({
      view: corrected,
      artifacts: [],
    });
    const phHtml = renderPhConsultDetailPage(corrected);

    expect(clinicianHtml).toContain("Answer review");
    expect(clinicianHtml).toContain("Exposure");
    expect(clinicianHtml).toContain("Recently corrected");
    expect(clinicianHtml).toContain("Correct consult facts");
    expect(phHtml).toContain("Answer review");
    expect(phHtml).toContain("Fact updates");
    expect(phHtml).toContain("Latest correction:");
  });
});

describe("intake guardrails", () => {
  it("warns when non-bat species answers include bat-only context", () => {
    expect(
      getIntakeConstraintWarnings({
        c04: "rodent",
        c05: "no",
      }),
    ).toHaveLength(1);
  });

  it("removes the old raw soap note JSON dump from the intake client view", () => {
    expect(INTAKE_HTML).not.toContain("JSON.stringify(data.soap_note,null,2)");
    expect(INTAKE_HTML).toContain("Go to clinician status page");
  });
});