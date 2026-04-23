// ---------------------------------------------------------------------------
// rade-v2 — Shared consult transform helpers
// ---------------------------------------------------------------------------

import { generatePlaceholderAssessment } from "../../intake/assessment.js";
import type { CanonicalConsult } from "../consult/types.js";

export function buildConsultAssessmentContext(consult: CanonicalConsult) {
  const payload = consult.body.payload;
  const assessment = generatePlaceholderAssessment(payload);

  return { payload, assessment };
}

export function buildConsultStructuredExport(consult: CanonicalConsult) {
  return {
    consult_id: consult.consult_id,
    current_state: consult.current_state,
    automation_mode: consult.automation_mode,
    created_at: consult.created_at,
    updated_at: consult.updated_at,
    submitter: consult.parties.submitter,
    reviewer: consult.parties.reviewer ?? null,
    payload_summary: {
      schema_id: consult.body.payload.schema_id,
      answered: consult.body.payload.intake_metadata.answered_count,
      total: consult.body.payload.intake_metadata.question_count,
      unresolved_fields: consult.body.payload.unresolved_fields,
      derived_facts: consult.body.payload.derived_facts,
    },
    clarifications: consult.clarifications,
    recommendation: consult.recommendation ?? null,
    engine_decisions: consult.engine_decisions,
    escalation_events: consult.escalation_events,
  };
}