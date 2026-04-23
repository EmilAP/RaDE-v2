// ---------------------------------------------------------------------------
// rade-v2 — DHIS2 Export Demo
//
// Demonstrates the full pipeline:
//   canonical intake → validated answers → canonical payload
//   → placeholder assessment → DHIS2 Tracker export payload
//
// Run: npx tsx examples/dhis2-export.ts
// ---------------------------------------------------------------------------

import { resolve, dirname } from "node:path";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadCanonicalIntake, clearLoaderCache } from "../intake/loader.js";
import { buildQuestionnaire } from "../intake/questionnaire.js";
import { validateAnswers, buildAnswerSet, Ans } from "../intake/answers.js";
import { buildCanonicalPayload } from "../intake/payload.js";
import { generatePlaceholderAssessment } from "../intake/assessment.js";
import { buildDhis2Output, buildFollowUpEvent } from "../adapters/dhis2-tracker.js";
import { generateDhis2Manifest } from "../manifests/dhis2-mapping.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../output");

// ── Example: Raccoon bite in Ontario ───────────────────────────────────────

console.log("╔══════════════════════════════════════════════════════╗");
console.log("║  RaDE → DHIS2 Tracker Export Demo                   ║");
console.log("║  Animal Exposure Intake and Follow-up Module         ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// Step 1: Load questionnaire
console.log("1. Loading canonical intake schema...");
clearLoaderCache();
const loadResult = loadCanonicalIntake();
const questionnaire = buildQuestionnaire(loadResult.data);
console.log(`   Schema: ${questionnaire.schema_id} v${questionnaire.version}`);
console.log(`   Questions: ${questionnaire.questions.length}`);
console.log(`   Sections: ${questionnaire.sections.length}\n`);

// Step 2: Build example answers (raccoon bite scenario)
console.log("2. Building example answers (raccoon bite, Ontario)...");

const answers = buildAnswerSet([
  // Intake status
  ["c01", Ans.no()],                                     // Not already started PEP

  // Exposure context
  ["c02", Ans.datetime("2026-04-05T10:30:00Z")],         // Exposure date
  ["c03", Ans.text("Hamilton, Ontario, Canada")],         // Geographic location

  // Animal species
  ["c04", Ans.enum("raccoon")],                           // Animal type

  // Bat exposure
  ["c05", Ans.yes()],                                     // Bat contact ruled out (N/A for raccoon)

  // Exposure characteristics
  ["c12", Ans.multi(["bite_transdermal_or_bleeding"])],   // Bite with bleeding
  ["c13", Ans.multi(["upper_extremity"])],                 // Wound site

  // Exposure timing
  ["c14", Ans.ternary("unknown")],                        // Animal still alive?

  // High-priority features
  ["c15", Ans.no()],                                      // Victim <14
  ["c16", Ans.no()],                                      // Multiple/deep wounds

  // Wound management
  ["c17", Ans.yes()],                                     // Wound washing done

  // Animal clinical features
  ["c18", Ans.ternary("unknown")],                        // Rabies signs
  ["c19", Ans.ternary("unknown")],                        // Died/disappeared in 10d
  ["c20", Ans.ternary("no")],                             // Bit 2+ others
  ["c21", Ans.yes()],                                     // Feral/wild
  ["c22", Ans.no()],                                      // Stray

  // Animal testing
  ["c23", Ans.ternary("no")],                             // Tested for rabies
  // c24 skipped — no test result

  // Animal availability
  ["c25", Ans.ternary("no")],                             // Animal available
  ["c26", Ans.ternary("unknown")],                        // Vaccinated
  ["c27", Ans.ternary("unknown")],                        // Exposed to rabies risk
  ["c28", Ans.ternary("no")],                             // Provoked

  // Patient vaccination history
  ["c29", Ans.ternary("no")],                             // Prior rabies vaccination

  // Patient current status
  ["c37", Ans.ternary("no")],                             // Immunocompromised
  ["c42", Ans.ternary("no")],                             // Pregnant
  ["c43", Ans.ternary("no")],                             // Allergies

  // Resource context
  ["c44", Ans.ternary("no")],                             // RIG limited
]);

// Step 3: Validate
console.log("3. Validating answers...");
const validation = validateAnswers(answers, questionnaire);
console.log(`   Valid: ${validation.valid}`);
console.log(`   Answered: ${validation.answered_count}/${validation.answered_count + validation.unanswered_count}`);
if (validation.issues.length > 0) {
  console.log(`   Issues: ${validation.issues.length}`);
  for (const iss of validation.issues) {
    console.log(`     - ${iss.question_id}: ${iss.message}`);
  }
}
console.log();

// Step 4: Build canonical payload
console.log("4. Building canonical case payload...");
const payload = buildCanonicalPayload(answers, questionnaire);
console.log(`   Payload ID: ${payload.payload_id}`);
console.log(`   Sections: ${payload.sections.length}`);
console.log(`   Derived facts: ${payload.derived_facts.length}`);
console.log(`   Unresolved core fields: ${payload.unresolved_fields.length}\n`);

// Step 5: Generate placeholder assessment
console.log("5. Generating placeholder assessment...");
const assessment = generatePlaceholderAssessment(payload);
console.log(`   Status: ${assessment.status}`);
console.log(`   Recommendation: ${assessment.recommendation_code}`);
console.log(`   Risk signals: ${assessment.risk_signals.join(", ") || "(none)"}\n`);

// Step 6: Build DHIS2 output
console.log("6. Building DHIS2 Tracker export payload...");
const dhis2 = buildDhis2Output(payload, assessment, "PLACEHOLDER_ORG_UNIT", {
  firstName: "Jane",
  lastName: "Doe",
  dateOfBirth: "1992-03-15",
  sex: "F",
  phone: "+1-555-0123",
});

const tp = dhis2.trackerPayload;
console.log(`   Tracked entities: ${tp.trackedEntities.length}`);
console.log(`   Enrollments: ${tp.enrollments.length}`);
console.log(`   Events: ${tp.events.length}`);
console.log(`     - Intake event: ${tp.events[0]?.dataValues.length ?? 0} data values`);
console.log(`     - Assessment event: ${tp.events[1]?.dataValues.length ?? 0} data values`);

// Step 7: Show follow-up event example
console.log("\n7. Building example follow-up event (Day 0 vaccine dose)...");
const followUpEvent = buildFollowUpEvent(
  tp.trackedEntities[0].trackedEntity,
  payload.payload_id,
  "PLACEHOLDER_ORG_UNIT",
  {
    visitDate: "2026-04-05",
    visitType: "vaccine_dose",
    doseNumber: 1,
    rigAdministered: true,
    outcomeStatus: "on_schedule",
    notes: "Day 0 — initial PEP dose + RIG administered",
  },
  0,
);
console.log(`   Follow-up event: ${followUpEvent.event}`);
console.log(`   Data values: ${followUpEvent.dataValues.length}\n`);

// Step 8: Validation report
console.log("8. Validation report:");
const vr = dhis2.validationReport;
console.log(`   Valid for live import: ${vr.valid}`);
console.log(`   Ready for /api/tracker?importMode=VALIDATE: ${vr.readyForValidateEndpoint}`);
console.log(`   Placeholder UIDs: ${vr.placeholderUids.length}`);
if (vr.warnings.length > 0) {
  console.log("   Warnings:");
  for (const w of vr.warnings) {
    console.log(`     ⚠ ${w}`);
  }
}
console.log();

// Step 9: Mapping manifest summary
console.log("9. DHIS2 mapping manifest:");
const manifest = dhis2.manifest;
console.log(`   Program: ${manifest.program.name}`);
console.log(`   TEI attributes: ${manifest.teiAttributes.length}`);
console.log(`   Intake data elements: ${manifest.dataElements.length}`);
console.log(`   Assessment data elements: ${manifest.assessmentFields.length}`);
console.log(`   Follow-up data elements: ${manifest.followUpFields.length}`);
console.log(`   Option sets: ${manifest.optionSets.length}`);
console.log(`   Program stages: ${Object.keys(manifest.programStages).length}`);
console.log();

// Step 10: Write output files
console.log("10. Writing output files...");

import { mkdirSync } from "node:fs";
mkdirSync(OUTPUT_DIR, { recursive: true });

// Full tracker payload
const fullPayload = {
  ...tp,
  events: [...tp.events, followUpEvent],
};
const trackerPath = resolve(OUTPUT_DIR, "dhis2-tracker-payload.json");
writeFileSync(trackerPath, JSON.stringify(fullPayload, null, 2));
console.log(`    → ${trackerPath}`);

// Mapping manifest
const manifestPath = resolve(OUTPUT_DIR, "dhis2-mapping-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`    → ${manifestPath}`);

// Validation report
const validationPath = resolve(OUTPUT_DIR, "dhis2-validation-report.json");
writeFileSync(validationPath, JSON.stringify(vr, null, 2));
console.log(`    → ${validationPath}`);

// Canonical payload (for reference)
const canonicalPath = resolve(OUTPUT_DIR, "canonical-case-payload.json");
writeFileSync(canonicalPath, JSON.stringify(payload, null, 2));
console.log(`    → ${canonicalPath}`);

console.log("\n" + "─".repeat(56));
console.log("NOTES:");
for (const note of dhis2.notes) {
  console.log(`  ${note}`);
}
console.log("─".repeat(56));

console.log("\n✓ DHIS2 export demo complete.");
console.log("  Next steps:");
console.log("  1. Replace RADE_* placeholder UIDs with real DHIS2 UIDs");
console.log("  2. Import metadata scaffold via POST /api/metadata");
console.log("  3. Test payload via POST /api/tracker?importMode=VALIDATE");
console.log("  4. Integrate canonical rabies flow when finalized");
