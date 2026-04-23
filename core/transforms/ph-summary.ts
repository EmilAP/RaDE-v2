// ---------------------------------------------------------------------------
// rade-v2 — PH summary transform
// ---------------------------------------------------------------------------

import { renderPublicHealth } from "../../renderers/public-health.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import { buildConsultAssessmentContext } from "./helpers.js";

export function buildPhSummaryArtifact(consult: CanonicalConsult): ConsultArtifact {
  const { payload, assessment } = buildConsultAssessmentContext(consult);
  const rendered = renderPublicHealth(payload, assessment);

  return {
    artifact_name: "ph-summary",
    content_type: "text/plain",
    format: "text",
    generated_at: new Date().toISOString(),
    body: rendered.report_text,
  };
}