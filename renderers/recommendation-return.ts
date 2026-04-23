// ---------------------------------------------------------------------------
// rade-v2 — Return-to-clinician recommendation renderer
// ---------------------------------------------------------------------------

import type { CanonicalConsult } from "../core/consult/types.js";
import { getNormalizedAnswer } from "../intake/payload.js";

export type RecommendationReturnOutput = {
  note_text: string;
  structured: {
    consult_id: string;
    state: string;
    recommendation_category: string;
    recommendation_label: string;
    rationale: string;
    urgency: string;
    ph_review_completed: boolean;
    reviewer_name: string;
    returned_at?: string;
    key_facts: {
      species: string;
      exposure_type: string;
      location: string;
      exposure_date: string;
    };
    follow_up_tasks: string[];
  };
};

export function renderRecommendationReturn(
  consult: CanonicalConsult,
): RecommendationReturnOutput {
  if (!consult.recommendation) {
    throw new Error("Cannot render return artifact without a recommendation");
  }

  const recommendation = consult.recommendation;
  const lines: string[] = [];

  lines.push("══════════════════════════════════════════════════════");
  lines.push("PUBLIC HEALTH CONSULT RECOMMENDATION");
  lines.push("══════════════════════════════════════════════════════");
  lines.push(`Consult ID: ${consult.consult_id}`);
  lines.push(`Current state: ${consult.current_state}`);
  lines.push(`Recommendation category: ${recommendation.category}`);
  lines.push(`Disposition: ${recommendation.label}`);
  lines.push(`Urgency: ${recommendation.urgency}`);
  lines.push(`PH review completed: yes`);
  lines.push(`Reviewer: ${recommendation.authored_by.display_name}`);
  lines.push(`Authored at: ${recommendation.authored_at}`);
  lines.push(`Returned to clinician: ${recommendation.returned_to_clinician_at ?? "Not yet returned"}`);
  lines.push("");
  lines.push("Consult facts on record:");
  lines.push(`- Species: ${getAnswerText(consult, "c04")}`);
  lines.push(`- Exposure type: ${getAnswerText(consult, "c12")}`);
  lines.push(`- Location: ${getAnswerText(consult, "c03")}`);
  lines.push(`- Exposure date: ${getAnswerText(consult, "c02")}`);
  lines.push("");
  lines.push("Rationale:");
  lines.push(recommendation.rationale);
  lines.push("");
  lines.push("Required follow-up tasks:");

  if (recommendation.follow_up_tasks.length === 0) {
    lines.push("- None specified");
  } else {
    for (const task of recommendation.follow_up_tasks) {
      lines.push(`- ${task.label} [${task.priority}]`);
    }
  }

  if (recommendation.escalation_required) {
    lines.push("");
    lines.push("Escalation: further PH supervision required");
  }

  lines.push("");
  lines.push(`Signed at: ${recommendation.signed_at}`);
  lines.push("══════════════════════════════════════════════════════");

  return {
    note_text: lines.join("\n"),
    structured: {
      consult_id: consult.consult_id,
      state: consult.current_state,
      recommendation_category: recommendation.category,
      recommendation_label: recommendation.label,
      rationale: recommendation.rationale,
      urgency: recommendation.urgency,
      ph_review_completed: true,
      reviewer_name: recommendation.authored_by.display_name,
      returned_at: recommendation.returned_to_clinician_at,
      key_facts: {
        species: getAnswerText(consult, "c04"),
        exposure_type: getAnswerText(consult, "c12"),
        location: getAnswerText(consult, "c03"),
        exposure_date: getAnswerText(consult, "c02"),
      },
      follow_up_tasks: recommendation.follow_up_tasks.map((task) => task.label),
    },
  };
}

function getAnswerText(consult: CanonicalConsult, questionId: string): string {
  const answer = getNormalizedAnswer(consult.body.payload, questionId);
  if (!answer || !answer.is_answered) {
    return "Not recorded";
  }

  return answer.normalized_string;
}