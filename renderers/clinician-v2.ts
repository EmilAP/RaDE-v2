// ---------------------------------------------------------------------------
// rade-v2 — Clinician renderer (intake-driven)
//
// Consumes canonical case payload + placeholder assessment.
// Produces structured intake summary + chart-ready note draft.
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload, SectionPayload, NormalizedAnswer } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type ClinicianIntakeOutput = {
  note_draft: string;
  structured_summary: ClinicianStructuredSummary;
};

export type ClinicianStructuredSummary = {
  schema_id: string;
  answered_count: number;
  total_questions: number;
  assessment_status: string;
  recommendation_code: string;
  risk_signals: string[];
  unanswered_critical: string[];
  sections: Array<{
    section_id: string;
    title: string;
    answered: number;
    total: number;
    answers: Array<{ question_id: string; text: string; value: string }>;
  }>;
};

// ── Renderer ───────────────────────────────────────────────────────────────

export function renderClinicianIntake(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): ClinicianIntakeOutput {
  const note = buildNoteDraft(payload, assessment);
  const summary = buildStructuredSummary(payload, assessment);
  return { note_draft: note, structured_summary: summary };
}

// ── Note draft ─────────────────────────────────────────────────────────────

function buildNoteDraft(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): string {
  const lines: string[] = [];

  lines.push("══════════════════════════════════════════════════════════════");
  lines.push("  RABIES PEP INTAKE — CLINICIAN NOTE DRAFT");
  lines.push("  ⚠ DECISION LOGIC PENDING — NOT A FINAL RECOMMENDATION ⚠");
  lines.push("══════════════════════════════════════════════════════════════");
  lines.push("");
  lines.push(`Date: ${payload.created_at}`);
  lines.push(`Schema: ${payload.schema_id} (${payload.intake_metadata.schema_version})`);
  lines.push(
    `Completion: ${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count} questions answered`,
  );
  lines.push("");

  // Sections
  for (const sec of payload.sections) {
    if (sec.answers.length === 0) continue;
    lines.push(`── ${sec.section_title} ──`);
    for (const ans of sec.answers) {
      const marker = ans.is_answered ? "•" : "○";
      lines.push(`  ${marker} [${ans.question_id}] ${ans.normalized_string}`);
    }
    lines.push("");
  }

  // Unanswered critical questions
  if (payload.unresolved_fields.length > 0) {
    lines.push("── Unanswered Critical Questions ──");
    for (const id of payload.unresolved_fields) {
      lines.push(`  ○ ${id} — UNANSWERED`);
    }
    lines.push("");
  }

  // Risk signals
  if (assessment.risk_signals.length > 0) {
    lines.push("── Risk Signals (from derived facts) ──");
    for (const sig of assessment.risk_signals) {
      lines.push(`  ⚠ ${sig}`);
    }
    lines.push("");
  }

  // Assessment status
  lines.push("── Assessment Status ──");
  lines.push(`  Status: ${assessment.status}`);
  lines.push(`  Recommendation: ${assessment.recommendation_code}`);
  lines.push(`  ${assessment.rationale.summary}`);
  lines.push("");

  lines.push("══════════════════════════════════════════════════════════════");
  lines.push("  END OF DRAFT — REQUIRES CLINICIAN REVIEW");
  lines.push("══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

// ── Structured summary ─────────────────────────────────────────────────────

function buildStructuredSummary(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): ClinicianStructuredSummary {
  return {
    schema_id: payload.schema_id,
    answered_count: payload.intake_metadata.answered_count,
    total_questions: payload.intake_metadata.question_count,
    assessment_status: assessment.status,
    recommendation_code: assessment.recommendation_code,
    risk_signals: assessment.risk_signals,
    unanswered_critical: payload.unresolved_fields,
    sections: payload.sections.map((sec) => ({
      section_id: sec.section_id,
      title: sec.section_title,
      answered: sec.answered_count,
      total: sec.answers.length,
      answers: sec.answers
        .filter((a) => a.is_answered)
        .map((a) => ({
          question_id: a.question_id,
          text: a.question_id, // question text available via questionnaire lookup
          value: a.normalized_string,
        })),
    })),
  };
}
