// ---------------------------------------------------------------------------
// rade-v2 — Chart note transform
// ---------------------------------------------------------------------------

import { renderClinicianIntake } from "../../renderers/clinician-v2.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import { buildConsultAssessmentContext } from "./helpers.js";

export function buildChartNoteArtifact(consult: CanonicalConsult): ConsultArtifact {
  const { payload, assessment } = buildConsultAssessmentContext(consult);
  const rendered = renderClinicianIntake(payload, assessment);

  return {
    artifact_name: "chart-note",
    content_type: "text/plain",
    format: "text",
    generated_at: new Date().toISOString(),
    body: rendered.note_draft,
  };
}