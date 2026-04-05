// ---------------------------------------------------------------------------
// rade-v2 — End-to-end tests
//
// Proves the full pipeline: input → engine → envelope → clinician → FHIR
// across all major clinical scenarios.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { runAssessment } from "../core/pipeline";
import { runEngine } from "../core/engine";
import { renderClinicianNote } from "../renderers/clinician";
import { buildFhirOutput } from "../adapters/fhir";
import type { AssessmentInput } from "../core/types";

// ── Fixtures ───────────────────────────────────────────────────────────────

const RACCOON_BITE: AssessmentInput = {
  country: "CA",
  subnational_unit: "ON",
  bat_involved: "no",
  is_mammal: true,
  relevant_exposure: true,
  animal_available: false,
  host_taxon_id: "raccoon",
  patient_age_years: 34,
};

const NON_MAMMAL: AssessmentInput = {
  country: "CA",
  subnational_unit: "ON",
  bat_involved: "no",
  is_mammal: false,
};

const BAT_UNSURE: AssessmentInput = {
  country: "CA",
  subnational_unit: "ON",
  bat_involved: "unsure",
  bat_contact_ruled_out: false,
};

const BAT_RULED_OUT: AssessmentInput = {
  country: "US",
  subnational_unit: "NY",
  bat_involved: "yes",
  bat_contact_ruled_out: true,
};

const DOG_AVAILABLE: AssessmentInput = {
  country: "CA",
  subnational_unit: "ON",
  bat_involved: "no",
  is_mammal: true,
  relevant_exposure: true,
  animal_available: true,
  host_taxon_id: "dog",
};

const SKUNK_UNAVAILABLE: AssessmentInput = {
  country: "US",
  subnational_unit: "PA",
  bat_involved: "no",
  is_mammal: true,
  relevant_exposure: true,
  animal_available: false,
  host_taxon_id: "skunk",
};

const SMALL_RODENT: AssessmentInput = {
  country: "CA",
  subnational_unit: "ON",
  bat_involved: "no",
  is_mammal: true,
  relevant_exposure: true,
  animal_available: false,
  host_taxon_id: "small_rodent",
};

const UNKNOWN_ANIMAL: AssessmentInput = {
  country: "CA",
  subnational_unit: "ON",
  bat_involved: "no",
  is_mammal: true,
  relevant_exposure: true,
  animal_available: false,
  host_taxon_id: "unknown_species",
};

// ── Engine tests ───────────────────────────────────────────────────────────

describe("Engine — rule evaluation", () => {
  it("raccoon unavailable → observe_or_test (moderate risk, moderate trigger, default)", () => {
    const r = runEngine(RACCOON_BITE);
    expect(r.recommendation_class_id).toBe("observe_or_test_pathway");
    expect(r.risk_tier).toBe("moderate");
    expect(r.epi_zone_id).toBe("na_wildlife_multi_reservoir");
    expect(r.host_profile?.host_taxon_id).toBe("raccoon");
    expect(r.triggered_rules).toContain("default_observe_or_test");
  });

  it("non-mammal → no_pep_likely (early exit)", () => {
    const r = runEngine(NON_MAMMAL);
    expect(r.recommendation_class_id).toBe("no_pep_likely");
    expect(r.risk_tier).toBe("negligible");
    expect(r.triggered_rules).toContain("non_mammal_exit");
  });

  it("bat unsure + contact not ruled out + bat_policy_supersedes → pep_recommended", () => {
    const r = runEngine(BAT_UNSURE);
    expect(r.recommendation_class_id).toBe("pep_recommended");
    expect(r.triggered_rules).toContain("bat_policy_supersedes");
  });

  it("bat + contact ruled out → no_pep_likely", () => {
    const r = runEngine(BAT_RULED_OUT);
    expect(r.recommendation_class_id).toBe("no_pep_likely");
    expect(r.triggered_rules).toContain("bat_contact_ruled_out");
  });

  it("dog available → observe_or_test (animal available rule)", () => {
    const r = runEngine(DOG_AVAILABLE);
    expect(r.recommendation_class_id).toBe("observe_or_test_pathway");
    expect(r.risk_tier).toBe("low");
    expect(r.triggered_rules).toContain("animal_available_observe");
  });

  it("skunk unavailable → pep_recommended (strong trigger + unavailable)", () => {
    const r = runEngine(SKUNK_UNAVAILABLE);
    expect(r.recommendation_class_id).toBe("pep_recommended");
    expect(r.risk_tier).toBe("high");
    expect(r.triggered_rules).toContain("strong_trigger_unavailable");
  });

  it("small rodent → no_pep_likely (negligible, no conflict)", () => {
    const r = runEngine(SMALL_RODENT);
    expect(r.recommendation_class_id).toBe("no_pep_likely");
    expect(r.risk_tier).toBe("negligible");
    expect(r.triggered_rules).toContain("negligible_no_conflict");
  });

  it("unknown animal unavailable → expert_review (conflict escalation)", () => {
    const r = runEngine(UNKNOWN_ANIMAL);
    expect(r.recommendation_class_id).toBe("urgent_local_expert_review");
    expect(r.confidence_flags).toContain("unknown_host_profile");
    expect(r.triggered_rules).toContain("conflict_escalation");
  });
});

// ── Full pipeline tests ────────────────────────────────────────────────────

describe("Pipeline — full vertical slice", () => {
  it("raccoon bite: envelope → clinician → FHIR", () => {
    const { envelope } = runAssessment(RACCOON_BITE);

    // Envelope
    expect(envelope.envelope_id).toBeDefined();
    expect(envelope.schema_version).toBe("0.1.0");
    expect(envelope.module_id).toBe("rabies");
    expect(envelope.status).toBe("action_required");

    // Assessment
    const a = envelope.assessment!;
    expect(a.recommendation.category).toBe("observe_or_test");
    expect(a.recommendation.requires_public_health).toBe(true);
    expect(a.risk_snapshot.overall_risk_tier).toBe("moderate");
    expect(a.key_factors).toContain("host_risk_tier_moderate");
    expect(a.follow_up_tasks.length).toBeGreaterThan(0);

    // Clinician
    const { emr_note, summary } = renderClinicianNote(envelope);
    expect(emr_note).toContain("RABIES EXPOSURE RISK ASSESSMENT");
    expect(emr_note).toContain("raccoon");
    expect(emr_note).toContain("MODERATE");
    expect(emr_note).toContain("RECOMMENDATION:");
    expect(emr_note).toContain("PUBLIC HEALTH NOTIFICATION REQUIRED");
    expect(summary.recommendation_category).toBe("observe_or_test");
    expect(summary.risk_tier).toBe("moderate");
    expect(summary.urgency).toBe("important");
    expect(summary.requires_public_health).toBe(true);

    // FHIR
    const fhir = buildFhirOutput(envelope);
    expect(fhir.bundle.resourceType).toBe("Bundle");
    expect(fhir.bundle.type).toBe("collection");
    expect(fhir.bundle.entry.length).toBeGreaterThanOrEqual(4);

    const resourceTypes = fhir.bundle.entry.map((e) => e.resource.resourceType);
    expect(resourceTypes).toContain("Patient");
    expect(resourceTypes).toContain("Observation");
    expect(resourceTypes).toContain("RiskAssessment");
    expect(resourceTypes).toContain("ServiceRequest");
    expect(resourceTypes).toContain("Task");

    expect(fhir.cds_card.indicator).toBe("warning");
    expect(fhir.cds_card.summary).toBeTruthy();
  });

  it("non-mammal: no_action → completed status", () => {
    const { envelope } = runAssessment(NON_MAMMAL);
    expect(envelope.status).toBe("completed");
    expect(envelope.assessment!.recommendation.category).toBe("no_action");
    expect(envelope.assessment!.recommendation.requires_public_health).toBe(false);

    const { summary } = renderClinicianNote(envelope);
    expect(summary.urgency).toBe("routine");
  });

  it("bat unsure: prophylaxis → action_required", () => {
    const { envelope } = runAssessment(BAT_UNSURE);
    expect(envelope.status).toBe("action_required");
    expect(envelope.assessment!.recommendation.category).toBe("prophylaxis");
    expect(envelope.assessment!.recommendation.requires_escalation).toBe(true);

    const { emr_note } = renderClinicianNote(envelope);
    expect(emr_note).toContain("unsure");
    expect(emr_note).toContain("REQUIRES ESCALATION");
  });

  it("skunk unavailable: prophylaxis with high risk", () => {
    const { envelope } = runAssessment(SKUNK_UNAVAILABLE);
    expect(envelope.assessment!.recommendation.category).toBe("prophylaxis");
    expect(envelope.assessment!.risk_snapshot.overall_risk_tier).toBe("high");

    const fhir = buildFhirOutput(envelope);
    expect(fhir.cds_card.indicator).toBe("critical");
  });

  it("small rodent: no_action, negligible risk", () => {
    const { envelope } = runAssessment(SMALL_RODENT);
    expect(envelope.status).toBe("completed");
    expect(envelope.assessment!.recommendation.category).toBe("no_action");
    expect(envelope.assessment!.risk_snapshot.overall_risk_tier).toBe("negligible");
  });

  it("unknown animal: expert_review with conflict flags", () => {
    const { envelope } = runAssessment(UNKNOWN_ANIMAL);
    expect(envelope.assessment!.recommendation.category).toBe("expert_review");
    expect(envelope.status).toBe("action_required");

    const { summary } = renderClinicianNote(envelope);
    expect(summary.urgency).toBe("urgent");
  });
});

// ── FHIR structure tests ───────────────────────────────────────────────────

describe("FHIR adapter — resource structure", () => {
  it("produces valid bundle with correct references", () => {
    const { envelope } = runAssessment(RACCOON_BITE);
    const fhir = buildFhirOutput(envelope);

    // Every entry has fullUrl and resource with id
    for (const e of fhir.bundle.entry) {
      expect(e.fullUrl).toMatch(/^urn:rade:/);
      expect(e.resource.id).toBeDefined();
      expect(e.resource.resourceType).toBeTruthy();
    }

    // Patient ID matches case ID
    const patient = fhir.bundle.entry.find(
      (e) => e.resource.resourceType === "Patient",
    )!;
    expect(patient.resource.id).toBe(envelope.case.case_id);
  });

  it("task count matches follow_up_tasks", () => {
    const { envelope } = runAssessment(RACCOON_BITE);
    const fhir = buildFhirOutput(envelope);
    const taskCount = fhir.bundle.entry.filter(
      (e) => e.resource.resourceType === "Task",
    ).length;
    expect(taskCount).toBe(envelope.assessment!.follow_up_tasks.length);
  });
});
