// ---------------------------------------------------------------------------
// rade-v2 — Placeholder assessment / result contract
//
// Stub assessment layer. The canonical flow is NOT final.
// All outputs are explicitly honest placeholders.
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload, DerivedFact } from "./payload.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type AssessmentStatus =
  | "not_assessed"
  | "flow_pending"
  | "placeholder_assessment_generated";

export type PlaceholderRecommendationCode =
  | "manual_review_required"
  | "rabies_flow_pending"
  | "insufficient_logic_available";

export type PlaceholderRationale = {
  summary: string;
  lines: string[];
  flow_dependency: string;
};

export type PlaceholderAssessment = {
  assessment_id: string;
  status: AssessmentStatus;
  recommendation_code: PlaceholderRecommendationCode;
  rationale: PlaceholderRationale;
  derived_facts_snapshot: DerivedFact[];
  risk_signals: string[];
  unanswered_critical_questions: string[];
  todo_markers: string[];
  created_at: string;
};

// ── Builder ────────────────────────────────────────────────────────────────

export function generatePlaceholderAssessment(
  payload: CanonicalCasePayload,
): PlaceholderAssessment {
  const now = new Date().toISOString();
  const assessmentId = `placeholder_${Date.now()}`;

  // Gather risk signals from derived facts
  const riskSignals: string[] = [];
  for (const df of payload.derived_facts) {
    if (df.fact_id === "df_bat_involved" && df.value === true) {
      riskSignals.push("bat_exposure_detected");
    }
    if (df.fact_id === "df_has_relevant_exposure" && df.value === true) {
      riskSignals.push("relevant_exposure_present");
    }
    if (df.fact_id === "df_high_priority_victim" && df.value === true) {
      riskSignals.push("high_priority_victim");
    }
    if (df.fact_id === "df_immunocompromised" && df.value === true) {
      riskSignals.push("immunocompromised_patient");
    }
    if (df.fact_id === "df_is_mammal" && df.value === false) {
      riskSignals.push("non_mammal_exposure");
    }
  }

  // Determine recommendation code
  let code: PlaceholderRecommendationCode = "rabies_flow_pending";
  if (payload.unresolved_fields.length > 10) {
    code = "insufficient_logic_available";
  }
  if (riskSignals.length > 0) {
    code = "manual_review_required";
  }

  return {
    assessment_id: assessmentId,
    status: "placeholder_assessment_generated",
    recommendation_code: code,
    rationale: {
      summary:
        "Canonical rabies decision flow is not yet integrated. This is a structural placeholder assessment.",
      lines: [
        `${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count} questions answered`,
        `${riskSignals.length} risk signal(s) detected from derived facts`,
        `${payload.unresolved_fields.length} unanswered core question(s)`,
        "Final recommendation requires canonical flow integration",
      ],
      flow_dependency: "rade_canonical_rabies_flow (not yet finalized)",
    },
    derived_facts_snapshot: payload.derived_facts,
    risk_signals: riskSignals,
    unanswered_critical_questions: payload.unresolved_fields,
    todo_markers: [
      "TODO: Integrate canonical rabies decision flow when finalized",
      "TODO: Replace placeholder recommendation with flow-derived output",
      "TODO: Map derived facts through flow decision nodes",
      "TODO: Apply policy overlays from canonical flow",
      "TODO: Generate follow-up task list from flow endpoints",
    ],
    created_at: now,
  };
}
