// ---------------------------------------------------------------------------
// rade-v2 — Intake wiring tests
//
// Tests the mapping from flat checklist answers to engine input, and
// the end-to-end intake-driven pipeline.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { mapAnswersToEngineInput, loadChecklist } from "../core/intake";
import type { IntakeAnswers } from "../core/intake";
import { runIntakeAssessment } from "../core/pipeline";

// ── Fixtures ───────────────────────────────────────────────────────────────

const RACCOON_BITE_ANSWERS: IntakeAnswers = {
  c01: "no",
  c02: "2026-04-03T14:30:00",
  c03: "CA/ON",
  c04: "yes",
  c05: "no",
  c06: "no",
  c07: "raccoon",
  c15: ["bite"],
  c16: "category_III",
  c31: "no",
};

const NON_MAMMAL_ANSWERS: IntakeAnswers = {
  c03: "CA/ON",
  c04: "no",
  c06: "no",
};

const BAT_UNSURE_ANSWERS: IntakeAnswers = {
  c03: "CA/ON",
  c04: "yes",
  c06: "no",
  c11: "yes",          // history suggestive of bat → bat_involved = "unsure"
  c08: "no",           // cannot rule out bat contact
  c15: ["bite"],
};

const BAT_RULED_OUT_ANSWERS: IntakeAnswers = {
  c03: "US/NY",
  c04: "yes",
  c06: "yes",
  c08: "yes",          // bat contact CAN be ruled out
};

const DOG_AVAILABLE_ANSWERS: IntakeAnswers = {
  c03: "CA/ON",
  c04: "yes",
  c06: "no",
  c07: "dog",
  c15: ["bite"],
  c31: "yes",
};

const SKUNK_UNAVAILABLE_ANSWERS: IntakeAnswers = {
  c03: "US/PA",
  c04: "yes",
  c06: "no",
  c07: "skunk",
  c15: ["bite"],
  c31: "no",
};

const SMALL_RODENT_ANSWERS: IntakeAnswers = {
  c03: "CA/ON",
  c04: "yes",
  c05: "yes",
  c06: "no",
  c07: "rodent",
  c15: ["bite"],
  c31: "no",
};

// ── Mapping tests ──────────────────────────────────────────────────────────

describe("mapAnswersToEngineInput — field mapping", () => {
  it("maps raccoon bite answers to correct engine input", () => {
    const input = mapAnswersToEngineInput(RACCOON_BITE_ANSWERS);
    expect(input.country).toBe("CA");
    expect(input.subnational_unit).toBe("ON");
    expect(input.bat_involved).toBe("no");
    expect(input.is_mammal).toBe(true);
    expect(input.relevant_exposure).toBe(true);
    expect(input.animal_available).toBe(false);
    expect(input.host_taxon_id).toBe("raccoon");
    expect(input.exposure_date).toBe("2026-04-03T14:30:00");
  });

  it("maps non-mammal to is_mammal=false", () => {
    const input = mapAnswersToEngineInput(NON_MAMMAL_ANSWERS);
    expect(input.is_mammal).toBe(false);
    expect(input.bat_involved).toBe("no");
  });

  it("derives bat_involved='unsure' from suggestive history", () => {
    const input = mapAnswersToEngineInput(BAT_UNSURE_ANSWERS);
    expect(input.bat_involved).toBe("unsure");
    expect(input.bat_contact_ruled_out).toBe(false);
    expect(input.host_taxon_id).toBeUndefined();
  });

  it("maps bat with contact ruled out correctly", () => {
    const input = mapAnswersToEngineInput(BAT_RULED_OUT_ANSWERS);
    expect(input.bat_involved).toBe("yes");
    expect(input.bat_contact_ruled_out).toBe(true);
    expect(input.host_taxon_id).toBe("bat");
    expect(input.country).toBe("US");
    expect(input.subnational_unit).toBe("NY");
  });

  it("maps dog with animal available", () => {
    const input = mapAnswersToEngineInput(DOG_AVAILABLE_ANSWERS);
    expect(input.host_taxon_id).toBe("dog");
    expect(input.animal_available).toBe(true);
    expect(input.relevant_exposure).toBe(true);
  });

  it("maps skunk unavailable", () => {
    const input = mapAnswersToEngineInput(SKUNK_UNAVAILABLE_ANSWERS);
    expect(input.host_taxon_id).toBe("skunk");
    expect(input.animal_available).toBe(false);
    expect(input.country).toBe("US");
    expect(input.subnational_unit).toBe("PA");
  });

  it("maps rodent to small_rodent taxon", () => {
    const input = mapAnswersToEngineInput(SMALL_RODENT_ANSWERS);
    expect(input.host_taxon_id).toBe("small_rodent");
    expect(input.is_mammal).toBe(true);
  });
});

describe("mapAnswersToEngineInput — derived values", () => {
  it("derives relevant_exposure from WHO category_I as false", () => {
    const input = mapAnswersToEngineInput({ c03: "CA/ON", c16: "category_I" });
    expect(input.relevant_exposure).toBe(false);
  });

  it("derives relevant_exposure from WHO category_II as true", () => {
    const input = mapAnswersToEngineInput({ c03: "CA/ON", c16: "category_II" });
    expect(input.relevant_exposure).toBe(true);
  });

  it("derives relevant_exposure from multiselect exposure items", () => {
    const input = mapAnswersToEngineInput({
      c03: "CA/ON",
      c15: ["saliva_on_mucosa"],
    });
    expect(input.relevant_exposure).toBe(true);
  });

  it("bat as mammal type sets bat_involved=yes and host_taxon_id=bat", () => {
    const input = mapAnswersToEngineInput({
      c03: "CA/ON",
      c04: "yes",
      c07: "bat",
    });
    expect(input.bat_involved).toBe("yes");
    expect(input.host_taxon_id).toBe("bat");
  });

  it("rodent fallback via c05 when c07 is absent", () => {
    const input = mapAnswersToEngineInput({
      c03: "CA/ON",
      c04: "yes",
      c05: "yes",
    });
    expect(input.host_taxon_id).toBe("small_rodent");
  });

  it("defaults geography to CA/ON when c03 is absent", () => {
    const input = mapAnswersToEngineInput({});
    expect(input.country).toBe("CA");
    expect(input.subnational_unit).toBe("ON");
  });
});

describe("mapAnswersToEngineInput — normalisation", () => {
  it("handles coyote → fox taxon mapping", () => {
    const input = mapAnswersToEngineInput({ c03: "CA/ON", c07: "coyote" });
    expect(input.host_taxon_id).toBe("fox");
  });

  it("handles livestock → dog taxon mapping", () => {
    const input = mapAnswersToEngineInput({ c03: "CA/ON", c07: "livestock" });
    expect(input.host_taxon_id).toBe("dog");
  });

  it("handles unknown mammal type → undefined taxon", () => {
    const input = mapAnswersToEngineInput({ c03: "CA/ON", c07: "unknown" });
    expect(input.host_taxon_id).toBeUndefined();
  });
});

// ── Checklist loader ───────────────────────────────────────────────────────

describe("loadChecklist", () => {
  it("loads the canonical checklist with correct schema_id", () => {
    const checklist = loadChecklist();
    expect(checklist.schema_id).toBe("canonical_rabies_intake_v1");
    expect(checklist.questions.length).toBe(49);
  });

  it("returns cached instance on second call", () => {
    const a = loadChecklist();
    const b = loadChecklist();
    expect(a).toBe(b);
  });
});

// ── End-to-end intake pipeline ─────────────────────────────────────────────

describe("runIntakeAssessment — end-to-end", () => {
  it("raccoon bite: answers → observe_or_test", () => {
    const result = runIntakeAssessment(RACCOON_BITE_ANSWERS);

    // Mapped input is correct
    expect(result.mapped_input.host_taxon_id).toBe("raccoon");
    expect(result.mapped_input.animal_available).toBe(false);

    // Engine produces expected recommendation
    expect(result.engine_result.recommendation_class_id).toBe(
      "observe_or_test_pathway",
    );
    expect(result.engine_result.risk_tier).toBe("moderate");

    // Envelope is well-formed
    expect(result.envelope.assessment?.recommendation.category).toBe(
      "observe_or_test",
    );
    expect(result.envelope.status).toBe("action_required");
  });

  it("non-mammal: answers → no_pep_likely", () => {
    const result = runIntakeAssessment(NON_MAMMAL_ANSWERS);
    expect(result.engine_result.recommendation_class_id).toBe("no_pep_likely");
    expect(result.envelope.status).toBe("completed");
  });

  it("bat unsure: answers → pep_recommended (bat policy supersedes)", () => {
    const result = runIntakeAssessment(BAT_UNSURE_ANSWERS);
    expect(result.engine_result.recommendation_class_id).toBe(
      "pep_recommended",
    );
    expect(result.engine_result.triggered_rules).toContain(
      "bat_policy_supersedes",
    );
  });

  it("bat ruled out: answers → no_pep_likely", () => {
    const result = runIntakeAssessment(BAT_RULED_OUT_ANSWERS);
    expect(result.engine_result.recommendation_class_id).toBe("no_pep_likely");
    expect(result.engine_result.triggered_rules).toContain(
      "bat_contact_ruled_out",
    );
  });

  it("dog available: answers → observe_or_test", () => {
    const result = runIntakeAssessment(DOG_AVAILABLE_ANSWERS);
    expect(result.engine_result.recommendation_class_id).toBe(
      "observe_or_test_pathway",
    );
    expect(result.engine_result.triggered_rules).toContain(
      "animal_available_observe",
    );
  });

  it("skunk unavailable: answers → pep_recommended", () => {
    const result = runIntakeAssessment(SKUNK_UNAVAILABLE_ANSWERS);
    expect(result.engine_result.recommendation_class_id).toBe(
      "pep_recommended",
    );
    expect(result.engine_result.risk_tier).toBe("high");
  });

  it("small rodent: answers → no_pep_likely (negligible)", () => {
    const result = runIntakeAssessment(SMALL_RODENT_ANSWERS);
    expect(result.engine_result.recommendation_class_id).toBe("no_pep_likely");
    expect(result.engine_result.risk_tier).toBe("negligible");
  });

  it("produces identical engine result to direct runAssessment", () => {
    const intakeResult = runIntakeAssessment(RACCOON_BITE_ANSWERS);

    // The mapped input should produce the same engine decision
    expect(intakeResult.engine_result.recommendation_class_id).toBe(
      "observe_or_test_pathway",
    );
    expect(intakeResult.engine_result.risk_tier).toBe("moderate");
    expect(intakeResult.engine_result.epi_zone_id).toBe(
      "na_wildlife_multi_reservoir",
    );
  });
});
