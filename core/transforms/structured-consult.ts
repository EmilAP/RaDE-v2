// ---------------------------------------------------------------------------
// rade-v2 — Neutral structured consult export transform
// ---------------------------------------------------------------------------

import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import { buildConsultStructuredExport } from "./helpers.js";

export function buildStructuredConsultArtifact(consult: CanonicalConsult): ConsultArtifact {
  return {
    artifact_name: "structured-consult",
    content_type: "application/json",
    format: "json",
    generated_at: new Date().toISOString(),
    body: buildConsultStructuredExport(consult),
  };
}