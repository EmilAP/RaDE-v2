// ---------------------------------------------------------------------------
// rade-v2 — Escalation draft renderer
// ---------------------------------------------------------------------------

import type { CanonicalConsult } from "../core/consult/types.js";

export type EscalationDraftOutput = {
  note_text: string;
};

export function renderEscalationDraft(consult: CanonicalConsult): EscalationDraftOutput {
  const recommendation = consult.recommendation;
  const lines = [
    "ESCALATION DRAFT",
    `Consult ID: ${consult.consult_id}`,
    `Current state: ${consult.current_state}`,
    recommendation
      ? `Recommendation: ${recommendation.label}`
      : "Recommendation: not yet authored",
    recommendation?.escalation_required
      ? "Escalation requested by PH reviewer."
      : "Escalation has not been requested for this consult.",
  ];

  if (recommendation) {
    lines.push("", "Rationale:", recommendation.rationale);
  }

  return { note_text: lines.join("\n") };
}