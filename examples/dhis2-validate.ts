// ---------------------------------------------------------------------------
// rade-v2 — DHIS2 Validate-First Workflow
//
// Generates a DHIS2 Tracker export payload and produces a validation
// analysis. Optionally sends to a DHIS2 instance for server-side
// validation using POST /api/tracker?importMode=VALIDATE.
//
// Run: npx tsx examples/dhis2-validate.ts [--post <dhis2-base-url>]
//
// Examples:
//   npx tsx examples/dhis2-validate.ts
//   npx tsx examples/dhis2-validate.ts --post http://localhost:8080
// ---------------------------------------------------------------------------

import { resolve, dirname } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadCanonicalIntake, clearLoaderCache } from "../intake/loader.js";
import { buildQuestionnaire } from "../intake/questionnaire.js";
import { buildAnswerSet, Ans } from "../intake/answers.js";
import { buildCanonicalPayload } from "../intake/payload.js";
import { generatePlaceholderAssessment } from "../intake/assessment.js";
import { buildDhis2Output, type Dhis2TrackerPayload } from "../adapters/dhis2-tracker.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(__dirname, "../output");

// ── Parse args ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const postIndex = args.indexOf("--post");
const dhis2BaseUrl = postIndex >= 0 ? args[postIndex + 1] : null;

// ── Build payload ──────────────────────────────────────────────────────────

console.log("=== DHIS2 Validate-First Workflow ===\n");

clearLoaderCache();
const questionnaire = buildQuestionnaire(loadCanonicalIntake().data);

// Minimal example answers for validation testing
const answers = buildAnswerSet([
  ["c01", Ans.no()],
  ["c02", Ans.datetime("2026-04-05T10:30:00Z")],
  ["c03", Ans.text("Hamilton, Ontario, Canada")],
  ["c04", Ans.enum("raccoon")],
  ["c12", Ans.multi(["bite_transdermal_or_bleeding"])],
  ["c17", Ans.yes()],
  ["c21", Ans.yes()],
  ["c25", Ans.ternary("no")],
  ["c29", Ans.ternary("no")],
  ["c37", Ans.ternary("no")],
]);

const payload = buildCanonicalPayload(answers, questionnaire);
const assessment = generatePlaceholderAssessment(payload);
const dhis2 = buildDhis2Output(payload, assessment);

// ── Client-side validation ─────────────────────────────────────────────────

console.log("--- Client-Side Validation ---\n");

const vr = dhis2.validationReport;

console.log(`Valid for live import: ${vr.valid}`);
console.log(`Ready for VALIDATE endpoint: ${vr.readyForValidateEndpoint}`);
console.log();

if (vr.placeholderUids.length > 0) {
  console.log(`Placeholder UIDs (${vr.placeholderUids.length}):`);
  for (const uid of vr.placeholderUids) {
    console.log(`  ✗ ${uid}`);
  }
  console.log();
}

if (vr.missingRequiredFields.length > 0) {
  console.log(`Missing required fields (${vr.missingRequiredFields.length}):`);
  for (const f of vr.missingRequiredFields) {
    console.log(`  ✗ ${f}`);
  }
  console.log();
}

if (vr.warnings.length > 0) {
  console.log("Warnings:");
  for (const w of vr.warnings) {
    console.log(`  ⚠ ${w}`);
  }
  console.log();
}

// ── Write to file ──────────────────────────────────────────────────────────

mkdirSync(OUTPUT_DIR, { recursive: true });

const trackerPayloadPath = resolve(OUTPUT_DIR, "dhis2-validate-payload.json");
writeFileSync(trackerPayloadPath, JSON.stringify(dhis2.trackerPayload, null, 2));
console.log(`Tracker payload written to: ${trackerPayloadPath}`);

const reportPath = resolve(OUTPUT_DIR, "dhis2-validate-report.json");
writeFileSync(
  reportPath,
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      clientValidation: vr,
      payloadSummary: {
        trackedEntities: dhis2.trackerPayload.trackedEntities.length,
        enrollments: dhis2.trackerPayload.enrollments.length,
        events: dhis2.trackerPayload.events.length,
        totalDataValues: dhis2.trackerPayload.events.reduce(
          (sum, e) => sum + e.dataValues.length,
          0,
        ),
      },
      serverValidation: dhis2BaseUrl ? "pending" : "not_requested",
    },
    null,
    2,
  ),
);
console.log(`Validation report written to: ${reportPath}`);

// ── Optional: POST to DHIS2 VALIDATE endpoint ─────────────────────────────

if (dhis2BaseUrl) {
  console.log(`\n--- Server-Side Validation ---\n`);
  console.log(`Target: ${dhis2BaseUrl}/api/tracker?importMode=VALIDATE`);
  console.log();

  if (!vr.readyForValidateEndpoint) {
    console.log("⚠ Payload contains placeholder UIDs. Server-side validation");
    console.log("  will likely fail. Replace RADE_* UIDs with real DHIS2 UIDs first.");
    console.log();
  }

  await postToValidateEndpoint(dhis2BaseUrl, dhis2.trackerPayload);
} else {
  console.log("\n--- Server-Side Validation ---\n");
  console.log("Skipped. Use --post <dhis2-base-url> to send to a DHIS2 instance.");
  console.log("Example: npx tsx examples/dhis2-validate.ts --post http://localhost:8080");
}

console.log("\n=== Workflow complete ===");

// ── DHIS2 API caller ───────────────────────────────────────────────────────

async function postToValidateEndpoint(
  baseUrl: string,
  trackerPayload: Dhis2TrackerPayload,
): Promise<void> {
  const url = `${baseUrl}/api/tracker?importMode=VALIDATE&async=false`;

  // NOTE: Using basic auth for dev/demo only. In production use OAuth2 / PAT.
  const username = process.env.DHIS2_USERNAME ?? "admin";
  const password = process.env.DHIS2_PASSWORD ?? "district";
  const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(trackerPayload),
    });

    const body = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = body;
    }

    console.log(`Status: ${response.status} ${response.statusText}`);
    console.log(`Response:`);
    console.log(JSON.stringify(parsed, null, 2));

    // Write server response
    const serverReportPath = resolve(OUTPUT_DIR, "dhis2-server-validation-response.json");
    writeFileSync(
      serverReportPath,
      JSON.stringify({ status: response.status, body: parsed }, null, 2),
    );
    console.log(`\nServer response written to: ${serverReportPath}`);
  } catch (err) {
    console.error(`Failed to reach DHIS2 at ${baseUrl}:`);
    console.error(err instanceof Error ? err.message : String(err));
  }
}
