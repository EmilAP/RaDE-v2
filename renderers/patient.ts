// ---------------------------------------------------------------------------
// rade-v2 — Patient-friendly renderer (optional, simple, non-diagnostic)
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";

export type PatientSummaryOutput = {
  text: string;
};

export function renderPatientSummary(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): PatientSummaryOutput {
  const lines: string[] = [];

  lines.push("Your Rabies Exposure Intake Summary");
  lines.push("───────────────────────────────────");
  lines.push("");
  lines.push("This is a summary of the information collected during your intake.");
  lines.push("It is NOT a diagnosis or treatment recommendation.");
  lines.push("");
  lines.push(
    `We collected answers to ${payload.intake_metadata.answered_count} of ${payload.intake_metadata.question_count} intake questions.`,
  );

  if (payload.unresolved_fields.length > 0) {
    lines.push(
      `There are ${payload.unresolved_fields.length} important question(s) that still need to be answered.`,
    );
  }
  lines.push("");

  // Very simple high-level summary from sections
  for (const sec of payload.sections) {
    if (sec.answered_count === 0) continue;
    lines.push(`${sec.section_title}: ${sec.answered_count} item(s) recorded`);
  }
  lines.push("");

  lines.push("What happens next?");
  lines.push("• Your healthcare provider will review this information.");
  lines.push("• A decision about treatment will be made by your care team.");
  lines.push(
    "• If you have concerns about an animal bite or scratch, seek medical attention.",
  );
  lines.push("");
  lines.push("This summary was generated automatically and does not replace medical advice.");

  return { text: lines.join("\n") };
}
