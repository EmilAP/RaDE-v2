// ---------------------------------------------------------------------------
// rade-v2 — SORMAS transform wrapper
// ---------------------------------------------------------------------------

import { buildSormasOutput } from "../../adapters/sormas.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import { buildConsultAssessmentContext } from "./helpers.js";

export function buildSormasArtifact(consult: CanonicalConsult): ConsultArtifact {
  const { payload, assessment } = buildConsultAssessmentContext(consult);

  return {
    artifact_name: "sormas",
    content_type: "application/json",
    format: "json",
    generated_at: new Date().toISOString(),
    body: buildSormasOutput(payload, assessment),
  };
}