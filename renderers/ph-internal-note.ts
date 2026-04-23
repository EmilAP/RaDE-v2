// ---------------------------------------------------------------------------
// rade-v2 — PH internal note renderer
// ---------------------------------------------------------------------------

import type { CanonicalConsult } from "../core/consult/types.js";

export type PhInternalNoteOutput = {
  note_text: string;
};

export function renderPhInternalNote(consult: CanonicalConsult): PhInternalNoteOutput {
  const lines = [
    "PUBLIC HEALTH INTERNAL NOTE",
    `Consult ID: ${consult.consult_id}`,
    `Current state: ${consult.current_state}`,
    `Automation mode: ${consult.automation_mode}`,
    `Submitter: ${consult.parties.submitter.display_name}`,
    `Clarification threads: ${consult.clarifications.length}`,
    consult.recommendation
      ? `Recommendation: ${consult.recommendation.label} (${consult.recommendation.urgency})`
      : "Recommendation: not yet authored",
    consult.recommendation?.escalation_required
      ? "Escalation: required"
      : "Escalation: not currently requested",
  ];

  return { note_text: lines.join("\n") };
}