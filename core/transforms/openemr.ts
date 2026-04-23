// ---------------------------------------------------------------------------
// rade-v2 — OpenEMR transform wrapper
// ---------------------------------------------------------------------------

import { buildOpenEmrOutput } from "../../adapters/openemr.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import { buildConsultAssessmentContext } from "./helpers.js";

export function buildOpenEmrArtifact(consult: CanonicalConsult): ConsultArtifact {
  const { payload, assessment } = buildConsultAssessmentContext(consult);

  return {
    artifact_name: "openemr",
    content_type: "application/json",
    format: "json",
    generated_at: new Date().toISOString(),
    body: buildOpenEmrOutput(payload, assessment),
  };
}