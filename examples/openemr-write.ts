// ---------------------------------------------------------------------------
// rade-v2 — Example: end-to-end OpenEMR Standard API write
//
// Loads canonical intake, builds sample raccoon-bite answers, generates
// the canonical payload + placeholder assessment, writes an encounter +
// vitals to OpenEMR, and logs the resulting IDs.
//
// Run:  npx tsx examples/openemr-write.ts
//
// Requires OpenEMR running at https://localhost:9300 with a registered
// OAuth2 client. Set env vars or defaults will be used:
//   OPENEMR_BASE_URL, OPENEMR_CLIENT_ID, OPENEMR_CLIENT_SECRET,
//   OPENEMR_USER, OPENEMR_PASS
// ---------------------------------------------------------------------------

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCanonicalIntake } from "../intake/loader.js";
import { buildQuestionnaire } from "../intake/questionnaire.js";
import { buildAnswerSet, Ans } from "../intake/answers.js";
import { buildCanonicalPayload } from "../intake/payload.js";
import { generatePlaceholderAssessment } from "../intake/assessment.js";
import { buildStandardApiPayload } from "../adapters/openemr.js";
import { setConfig, listPatients } from "../app/openemr-client.js";
import { runOpenEMRWriteFlow } from "../app/openemr-flow.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTAKE_PATH = resolve(
  __dirname,
  "../data/canonical/canonical_rabies_intake_v2.json",
);

async function main() {
  // ── 1. Load questionnaire ────────────────────────────────────────────
  console.log("Loading canonical intake…");
  const result = loadCanonicalIntake(INTAKE_PATH);
  if (!result.valid) {
    console.error("Canonical intake failed validation:", result.issues);
    process.exit(1);
  }
  const questionnaire = buildQuestionnaire(result.data);
  console.log(
    `  ${questionnaire.questions.length} questions, ${questionnaire.sections.length} sections`,
  );

  // ── 2. Build sample answers (raccoon bite scenario) ──────────────────
  console.log("\nBuilding sample raccoon-bite answers…");
  const answers = buildAnswerSet([
    ["c01", Ans.no()],                                    // PEP not yet started
    ["c02", Ans.datetime("2026-04-06T10:30:00")],         // exposure time
    ["c03", Ans.text("Ottawa, Ontario, Canada")],         // location
    ["c04", Ans.enum("raccoon")],                         // animal type
    ["c12", Ans.multi(["bite_transdermal_or_bleeding"])],  // bite that broke skin
    ["c13", Ans.multi(["hands"])],                        // anatomical site
    ["c14", Ans.ternary("unknown")],                      // animal still alive?
    ["c15", Ans.no()],                                    // victim < 14 years old
  ]);

  // ── 3. Generate canonical payload + assessment ───────────────────────
  console.log("Generating canonical payload…");
  const payload = buildCanonicalPayload(answers, questionnaire);
  const assessment = generatePlaceholderAssessment(payload);
  console.log(`  Answered: ${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count}`);
  console.log(`  Derived facts: ${payload.derived_facts.length}`);
  console.log(`  Risk signals: ${assessment.risk_signals.join(", ") || "(none)"}`);
  console.log(`  Recommendation: ${assessment.recommendation_code}`);

  // ── 4. Preview Standard API payloads ─────────────────────────────────
  const apiPayload = buildStandardApiPayload(payload, assessment);
  console.log("\n--- Encounter payload ---");
  console.log(JSON.stringify(apiPayload.encounter_create, null, 2));
  console.log("\n--- Vitals note (first 500 chars) ---");
  console.log(apiPayload.vitals_create.note.slice(0, 500));

  // ── 5. Configure OpenEMR client ──────────────────────────────────────
  if (process.env.OPENEMR_CLIENT_ID) {
    setConfig({
      clientId: process.env.OPENEMR_CLIENT_ID,
      clientSecret: process.env.OPENEMR_CLIENT_SECRET,
    });
  }

  // ── 6. Find a patient to write to ───────────────────────────────────
  console.log("\nFetching patients from OpenEMR…");
  const patients = await listPatients();
  if (patients.length === 0) {
    console.error("No patients found. Create a test patient first.");
    process.exit(1);
  }
  const patient = patients[0];
  console.log(`  Using patient: ${patient.fname} ${patient.lname} (uuid: ${patient.uuid})`);

  // ── 7. Run the write flow ────────────────────────────────────────────
  console.log("\nWriting to OpenEMR Standard API…");
  const result2 = await runOpenEMRWriteFlow(patient.uuid, patient.pid, payload, assessment);

  console.log(`\n=== ${result2.openemr_submission_status.toUpperCase()} ===`);
  console.log(`  Medical problem created: ${result2.medical_problem_created}`);
  console.log(`  SOAP note created:       ${result2.soap_note_created}`);
  if (result2.encounter) {
    console.log(`  Encounter UUID:          ${result2.encounter.uuid}`);
    console.log(`  Encounter ID:            ${result2.encounter.encounter}`);
  }
  if (result2.vitals_id) {
    console.log(`  Vitals ID:               ${result2.vitals_id}`);
  }
  if (result2.warnings.length > 0) {
    console.log("\n  Warnings:");
    for (const w of result2.warnings) console.log(`    ⚠ ${w}`);
  }
  if (result2.errors.length > 0) {
    console.log("\n  Errors:");
    for (const e of result2.errors) console.log(`    ✗ ${e}`);
  }

  console.log("\n--- Verify in OpenEMR ---");
  console.log("1. Open https://localhost:9300 → login as admin/pass");
  console.log(`2. Search patient: ${patient.fname} ${patient.lname}`);
  console.log("3. Open the patient chart → Encounters tab");
  console.log("4. Find the new encounter → check vitals note");
}

main().catch((err) => {
  console.error("\nFailed:", err.message ?? err);
  process.exit(1);
});
