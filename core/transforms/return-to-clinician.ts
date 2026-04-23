// ---------------------------------------------------------------------------
// rade-v2 — Return-to-clinician artifact transform
// ---------------------------------------------------------------------------

import { renderRecommendationReturn } from "../../renderers/recommendation-return.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";

export function buildReturnToClinicianArtifact(
  consult: CanonicalConsult,
): ConsultArtifact {
  const rendered = renderRecommendationReturn(consult);

  return {
    artifact_name: "return-to-clinician",
    content_type: "text/plain",
    format: "text",
    generated_at: new Date().toISOString(),
    body: rendered.note_text,
  };
}