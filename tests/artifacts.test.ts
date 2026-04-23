import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { registerDefaultConsultTransforms } from "../app/consult-runtime.js";
import { ConsultService } from "../core/consult/service.js";
import { JsonFileConsultStore } from "../core/consult/store.js";
import { ConsultTransformRegistry } from "../core/transforms/registry.js";
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
  const dir = mkdtempSync(join(tmpdir(), "rade-artifacts-"));
  return new ConsultService(new JsonFileConsultStore(dir));
}

function createRegistry(): ConsultTransformRegistry {
  return registerDefaultConsultTransforms(new ConsultTransformRegistry());
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

describe("consult artifacts remain derived", () => {
  it("rendering artifacts does not mutate consult state or audit history", () => {
    const service = createService();
    const registry = createRegistry();

    const submitted = service.submitConsult({
      idempotency_key: "submit-artifacts-1",
      submitter: clinician,
      submitted_answers: buildInitialAnswers(),
      narrative_input: "Raccoon bite to hand.",
    });

    service.authorRecommendation({
      idempotency_key: "recommend-artifacts-1",
      consult_id: submitted.consult.consult_id,
      authored_by: reviewer,
      category: "observe_or_test",
      label: "Observe or test pathway",
      rationale: "Animal is available for public health follow-up.",
      urgency: "important",
    });

    const returned = service.returnRecommendation({
      idempotency_key: "return-artifacts-1",
      consult_id: submitted.consult.consult_id,
      returned_by: reviewer,
    });

    const before = service.getConsult(submitted.consult.consult_id);

    for (const artifactName of [
      "chart-note",
      "json",
      "structured-consult",
      "fhir",
      "openemr",
      "dhis2",
      "sormas",
      "return-to-clinician",
    ]) {
      const artifact = registry.render(artifactName, before.consult);
      expect(artifact.artifact_name).toBe(artifactName);
    }

    const after = service.getConsult(submitted.consult.consult_id);

    expect(returned.consult.current_state).toBe("RECOMMENDATION_RETURNED");
    expect(after.consult).toEqual(before.consult);
    expect(after.audit_events).toEqual(before.audit_events);
  });

  it("lists scaffolded targets without treating them as executable state transitions", () => {
    const service = createService();
    const registry = createRegistry();

    const submitted = service.submitConsult({
      idempotency_key: "submit-artifacts-2",
      submitter: clinician,
      submitted_answers: buildInitialAnswers(),
    });

    const descriptor = registry.list().find((artifact) => artifact.artifact_name === "openmrs");
    expect(descriptor).toMatchObject({
      artifact_name: "openmrs",
      availability: "scaffolded",
    });

    expect(() => registry.render("openmrs", submitted.consult)).toThrow(/OpenMRS|scaffolded/i);
    expect(service.getConsult(submitted.consult.consult_id).consult.current_state).toBe("AWAITING_PH_REVIEW");
  });

  it("rerenders the returned recommendation artifact from corrected consult facts", () => {
    const service = createService();
    const registry = createRegistry();

    const submitted = service.submitConsult({
      idempotency_key: "submit-artifacts-3",
      submitter: clinician,
      submitted_answers: buildInitialAnswers(),
      narrative_input: "Raccoon bite to hand.",
    });

    service.authorRecommendation({
      idempotency_key: "recommend-artifacts-3",
      consult_id: submitted.consult.consult_id,
      authored_by: reviewer,
      category: "observe_or_test",
      label: "Observe or test pathway",
      rationale: "Animal is available for public health follow-up.",
      urgency: "important",
      follow_up_tasks: [
        {
          task_id: "task-1",
          label: "Confirm animal testing status with local public health",
          priority: "important",
          task_type: "follow_up",
        },
      ],
    });

    service.returnRecommendation({
      idempotency_key: "return-artifacts-3",
      consult_id: submitted.consult.consult_id,
      returned_by: reviewer,
    });

    const beforeCorrection = service.getConsult(submitted.consult.consult_id);
    const beforeArtifact = String(
      registry.render("return-to-clinician", beforeCorrection.consult).body,
    );

    expect(beforeArtifact).toContain("Recommendation category: observe_or_test");
    expect(beforeArtifact).toContain("Disposition: Observe or test pathway");
    expect(beforeArtifact).toContain("Required follow-up tasks:");
    expect(beforeArtifact).toContain("PH review completed: yes");
    expect(beforeArtifact).toContain("Location: Ontario, Canada");

    const corrected = service.correctConsultFacts({
      idempotency_key: "correct-artifacts-3",
      consult_id: submitted.consult.consult_id,
      corrected_by: clinician,
      answer_patches: {
        c03: answer({ kind: "free_text", value: "Toronto, Ontario" }),
      },
      note: "Corrected exposure location after reviewing the chart.",
    });

    const afterArtifact = String(
      registry.render("return-to-clinician", corrected.consult).body,
    );

    expect(afterArtifact).toContain("Location: Toronto, Ontario");
    expect(afterArtifact).toContain("Reviewer: PH Reviewer");
    expect(afterArtifact).not.toBe(beforeArtifact);
  });
});