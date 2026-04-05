// ---------------------------------------------------------------------------
// rade-v2 — Example: raccoon bite in Ontario
//
// Run: npm run example
// ---------------------------------------------------------------------------

import { runAssessment } from "../core/pipeline";
import { renderClinicianNote } from "../renderers/clinician";
import { buildFhirOutput } from "../adapters/fhir";

const { envelope } = runAssessment({
  country: "CA",
  subnational_unit: "ON",
  bat_involved: "no",
  is_mammal: true,
  relevant_exposure: true,
  animal_available: false,
  host_taxon_id: "raccoon",
  patient_age_years: 34,
});

console.log("=== ENVELOPE ===");
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
