// ---------------------------------------------------------------------------
// rade-v2 — Public health / field renderer
//
// Produces structured summaries oriented toward public health officers
// and field investigators.
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload, NormalizedAnswer } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type PublicHealthOutput = {
  report_text: string;
  structured: PublicHealthStructured;
};

export type PublicHealthStructured = {
  exposure_summary: ExposureSummary;
  animal_summary: AnimalSummary;
  policy_fields: PolicyFields;
  follow_up_fields: FollowUpFields;
  assessment_status: string;
  recommendation_code: string;
};

export type ExposureSummary = {
  exposure_date: string | null;
  geographic_location: string | null;
  exposure_characteristics: string[];
  wound_site: string[];
  wound_washing_performed: string | null;
};

export type AnimalSummary = {
  animal_type: string | null;
  animal_alive: string | null;
  animal_available: string | null;
  animal_tested: string | null;
  test_result: string | null;
  animal_rabies_signs: string | null;
  animal_vaccinated: string | null;
  animal_feral_or_wild: string | null;
  animal_stray: string | null;
};

export type PolicyFields = {
  rig_availability_limited: string | null;
  patient_immunocompromised: string | null;
  prior_vaccination: string | null;
  recent_pep: string | null;
};

export type FollowUpFields = {
  patient_started_pep: string | null;
  high_priority_victim: boolean;
  unanswered_critical_count: number;
};

// ── Renderer ───────────────────────────────────────────────────────────────

export function renderPublicHealth(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): PublicHealthOutput {
  const structured = buildStructured(payload, assessment);
  const report = buildReportText(payload, structured, assessment);
  return { report_text: report, structured };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function ansStr(payload: CanonicalCasePayload, qId: string): string | null {
  for (const sec of payload.sections) {
    for (const a of sec.answers) {
      if (a.question_id === qId && a.is_answered) return a.normalized_string;
    }
  }
  return null;
}

function ansMulti(payload: CanonicalCasePayload, qId: string): string[] {
  for (const sec of payload.sections) {
    for (const a of sec.answers) {
      if (a.question_id === qId && a.is_answered && a.raw_value.kind === "multiselect") {
        return a.raw_value.values;
      }
    }
  }
  return [];
}

function buildStructured(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): PublicHealthStructured {
  const hp15 = ansStr(payload, "c15");
  const hp16 = ansStr(payload, "c16");
  const isHighPriority = hp15 === "yes" || hp16 === "yes";

  return {
    exposure_summary: {
      exposure_date: ansStr(payload, "c02"),
      geographic_location: ansStr(payload, "c03"),
      exposure_characteristics: ansMulti(payload, "c12"),
      wound_site: ansMulti(payload, "c13"),
      wound_washing_performed: ansStr(payload, "c17"),
    },
    animal_summary: {
      animal_type: ansStr(payload, "c04"),
      animal_alive: ansStr(payload, "c14"),
      animal_available: ansStr(payload, "c25"),
      animal_tested: ansStr(payload, "c23"),
      test_result: ansStr(payload, "c24"),
      animal_rabies_signs: ansStr(payload, "c18"),
      animal_vaccinated: ansStr(payload, "c26"),
      animal_feral_or_wild: ansStr(payload, "c21"),
      animal_stray: ansStr(payload, "c22"),
    },
    policy_fields: {
      rig_availability_limited: ansStr(payload, "c44"),
      patient_immunocompromised: ansStr(payload, "c37"),
      prior_vaccination: ansStr(payload, "c29"),
      recent_pep: ansStr(payload, "c30"),
    },
    follow_up_fields: {
      patient_started_pep: ansStr(payload, "c01"),
      high_priority_victim: isHighPriority,
      unanswered_critical_count: payload.unresolved_fields.length,
    },
    assessment_status: assessment.status,
    recommendation_code: assessment.recommendation_code,
  };
}

function buildReportText(
  payload: CanonicalCasePayload,
  s: PublicHealthStructured,
  assessment: PlaceholderAssessment,
): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════");
  lines.push("  RABIES PEP INTAKE — PUBLIC HEALTH FIELD REPORT");
  lines.push("  Status: DECISION LOGIC PENDING");
  lines.push("═══════════════════════════════════════════════════════");
  lines.push("");

  lines.push("── Exposure Summary ──");
  lines.push(`  Date: ${s.exposure_summary.exposure_date ?? "Not recorded"}`);
  lines.push(`  Location: ${s.exposure_summary.geographic_location ?? "Not recorded"}`);
  if (s.exposure_summary.exposure_characteristics.length > 0) {
    lines.push(`  Characteristics: ${s.exposure_summary.exposure_characteristics.join(", ")}`);
  }
  if (s.exposure_summary.wound_site.length > 0) {
    lines.push(`  Wound site: ${s.exposure_summary.wound_site.join(", ")}`);
  }
  lines.push(`  Wound washing: ${s.exposure_summary.wound_washing_performed ?? "Not recorded"}`);
  lines.push("");

  lines.push("── Animal / Testing / Availability ──");
  lines.push(`  Species: ${s.animal_summary.animal_type ?? "Not recorded"}`);
  lines.push(`  Alive: ${s.animal_summary.animal_alive ?? "Not recorded"}`);
  lines.push(`  Available: ${s.animal_summary.animal_available ?? "Not recorded"}`);
  lines.push(`  Tested: ${s.animal_summary.animal_tested ?? "Not recorded"}`);
  lines.push(`  Test result: ${s.animal_summary.test_result ?? "N/A"}`);
  lines.push(`  Rabies signs: ${s.animal_summary.animal_rabies_signs ?? "Not recorded"}`);
  lines.push(`  Vaccinated: ${s.animal_summary.animal_vaccinated ?? "Not recorded"}`);
  lines.push(`  Feral/wild: ${s.animal_summary.animal_feral_or_wild ?? "Not recorded"}`);
  lines.push(`  Stray: ${s.animal_summary.animal_stray ?? "Not recorded"}`);
  lines.push("");

  lines.push("── Policy / Operational Fields ──");
  lines.push(`  RIG limited: ${s.policy_fields.rig_availability_limited ?? "Not recorded"}`);
  lines.push(`  Immunocompromised: ${s.policy_fields.patient_immunocompromised ?? "Not recorded"}`);
  lines.push(`  Prior vaccination: ${s.policy_fields.prior_vaccination ?? "Not recorded"}`);
  lines.push(`  Recent PEP: ${s.policy_fields.recent_pep ?? "Not recorded"}`);
  lines.push("");

  lines.push("── Follow-Up ──");
  lines.push(`  PEP already started: ${s.follow_up_fields.patient_started_pep ?? "Not recorded"}`);
  lines.push(`  High priority: ${s.follow_up_fields.high_priority_victim ? "YES" : "No"}`);
  lines.push(`  Unanswered critical: ${s.follow_up_fields.unanswered_critical_count}`);
  lines.push("");

  lines.push(`── Assessment: ${assessment.recommendation_code} ──`);
  lines.push(`  ${assessment.rationale.summary}`);
  lines.push("");
  lines.push("═══════════════════════════════════════════════════════");

  return lines.join("\n");
}
