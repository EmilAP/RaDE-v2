// ---------------------------------------------------------------------------
// rade-v2 — Example: raccoon bite via intake answers
//
// Same clinical scenario as raccoon-bite.ts but driven through the intake
// wiring layer: flat checklist answers → engine → output → FHIR.
//
// Run: npx tsx examples/intake-raccoon-bite.ts
// ---------------------------------------------------------------------------

import type { IntakeAnswers } from "../core/intake";
import { runIntakeAssessment } from "../core/pipeline";
import { renderClinicianNote } from "../renderers/clinician";
import { buildFhirOutput } from "../adapters/fhir";

// ── Intake answers (raccoon bite, Ontario) ─────────────────────────────────

const answers: IntakeAnswers = {
  // Intake status
  c01: "no",                       // Has the patient already started RPEP?

  // Exposure context
  c02: "2026-04-03T14:30:00",      // Date/time of exposure
  c03: "CA/ON",                    // Geographic location

  // Animal species
  c04: "yes",                      // Is the animal a mammal?
  c05: "no",                       // Is the animal a rodent?
  c06: "no",                       // Was the animal a bat?
  c07: "raccoon",                  // What type of mammal?

  // Exposure characteristics
  c15: ["bite"],                   // Bite occurred
  c16: "category_III",            // WHO wound category III

  // Exposure timing
  c18: "no",                       // Exposure >10 days ago? No
  c19: "unknown",                  // Is the animal still alive?

  // High-priority features
  c20: "no",                       // Victim <14 years?
  c21: "no",                       // Multiple or deep wounds?
  c22: "no",                       // Wounds in highly innervated areas?

  // Wound management
  c23: "yes",                      // Wound washing performed?

  // Animal clinical features
  c24: "unknown",                  // Animal show signs of rabies?
  c25: "unknown",                  // Animal died/disappeared in 10 days?
  c26: "no",                       // Animal bit 2+ others?
  c27: "yes",                      // Feral or wild?
  c28: "no",                       // Stray?

  // Animal availability
  c31: "no",                       // Animal available for observation?

  // Patient vaccination history
  c35: "no",                       // Prior rabies vaccination?
  c36: "no",                       // Completed PEP in past 3 months?

  // Patient current status
  c43: "no",                       // Immunocompromised?
  c47: "no",                       // Pregnant?
  c48: "no",                       // Allergies to vaccine/RIG?
};

// ── Run through intake pipeline ────────────────────────────────────────────

const { envelope, engine_result, mapped_input } =
  runIntakeAssessment(answers);

console.log("=== MAPPED ENGINE INPUT ===");
console.log(JSON.stringify(mapped_input, null, 2));

console.log("\n=== ENGINE RESULT ===");
console.log(`Recommendation: ${engine_result.recommendation_class_id}`);
console.log(`Risk tier:      ${engine_result.risk_tier}`);
console.log(`Triggered:      ${engine_result.triggered_rules.join(", ")}`);
console.log(`Drivers:        ${engine_result.key_drivers.join(", ")}`);

console.log("\n=== ENVELOPE ===");
console.log(JSON.stringify(envelope, null, 2));

console.log("\n=== CLINICIAN EMR NOTE ===");
const { emr_note, summary } = renderClinicianNote(envelope);
console.log(emr_note);

console.log("\n=== CLINICIAN SUMMARY ===");
console.log(JSON.stringify(summary, null, 2));

console.log("\n=== FHIR OUTPUT ===");
const fhir = buildFhirOutput(envelope);
console.log(`Bundle entries: ${fhir.bundle.entry.length}`);
console.log(
  `Resource types: ${fhir.bundle.entry.map((e) => e.resource.resourceType).join(", ")}`,
);

console.log("\n=== CDS CARD ===");
console.log(JSON.stringify(fhir.cds_card, null, 2));
