// ---------------------------------------------------------------------------
// rade-v2 — Authoritative consult JSON snapshot transform
// ---------------------------------------------------------------------------

import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";

export function buildConsultJsonArtifact(consult: CanonicalConsult): ConsultArtifact {
  return {
    artifact_name: "json",
    content_type: "application/json",
    format: "json",
    generated_at: new Date().toISOString(),
    body: consult,
  };
}