// ---------------------------------------------------------------------------
// rade-v2 — Adapter smoke test
//
// Usage:
//   npm run example:adapters
//   npm run example:adapters -- epic
//   npm run example:adapters -- openemr
//   npm run example:adapters -- sormas
//   npm run example:adapters -- dhis2
// ---------------------------------------------------------------------------

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCanonicalIntake } from "../intake/loader.js";
import { buildQuestionnaire } from "../intake/questionnaire.js";
import { buildAnswerSet, Ans } from "../intake/answers.js";
import { buildCanonicalPayload } from "../intake/payload.js";
import { generatePlaceholderAssessment } from "../intake/assessment.js";
import { buildEpicFhirOutput } from "../adapters/epic-fhir.js";
import { buildOpenEmrOutput } from "../adapters/openemr.js";
import { buildSormasOutput } from "../adapters/sormas.js";
import { buildDhis2Output } from "../adapters/dhis2.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const intakePath = resolve(
  __dirname,
  "../data/canonical/canonical_rabies_intake_v2.json",
);

const adapter = (process.argv[2] ?? "all").toLowerCase();

const questionnaire = buildQuestionnaire(loadCanonicalIntake(intakePath).data);
const answers = buildAnswerSet([
  ["c01", Ans.yes()],
  ["c02", Ans.datetime("2026-04-05T10:30:00Z")],
  ["c03", Ans.text("Ontario, Canada")],
  ["c04", Ans.enum("raccoon")],
  ["c05", Ans.yes()],
  ["c12", Ans.multi(["bite_transdermal_or_bleeding"])],
  ["c13", Ans.multi(["upper_extremity"])],
  ["c14", Ans.ternary("yes")],
  ["c15", Ans.no()],
  ["c16", Ans.no()],
  ["c17", Ans.yes()],
  ["c18", Ans.ternary("no")],
  ["c21", Ans.no()],
  ["c22", Ans.no()],
  ["c25", Ans.ternary("yes")],
  ["c26", Ans.ternary("unknown")],
  ["c29", Ans.ternary("no")],
  ["c37", Ans.ternary("no")],
  ["c44", Ans.ternary("no")],
]);

const payload = buildCanonicalPayload(answers, questionnaire);
const assessment = generatePlaceholderAssessment(payload);

const outputs = {
  epic: buildEpicFhirOutput(payload, assessment),
  openemr: buildOpenEmrOutput(payload, assessment),
  sormas: buildSormasOutput(payload, assessment),
  dhis2: buildDhis2Output(payload, assessment),
};

if (adapter !== "all") {
  const selected = outputs[adapter as keyof typeof outputs];
  if (!selected) {
    console.error(`Unknown adapter: ${adapter}`);
    console.error("Expected one of: all, epic, openemr, sormas, dhis2");
    process.exit(1);
  }
  console.log(JSON.stringify(selected, null, 2));
  process.exit(0);
}

for (const [name, value] of Object.entries(outputs)) {
  console.log(`=== ${name.toUpperCase()} ===`);
  console.log(JSON.stringify(value, null, 2));
  console.log("");
}