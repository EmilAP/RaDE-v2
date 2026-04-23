// ---------------------------------------------------------------------------
// rade-v2 — DHIS2 transform wrapper
// ---------------------------------------------------------------------------

import { buildDhis2Output } from "../../adapters/dhis2-tracker.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import { buildConsultAssessmentContext } from "./helpers.js";

export function buildDhis2Artifact(consult: CanonicalConsult): ConsultArtifact {
  const { payload, assessment } = buildConsultAssessmentContext(consult);

  return {
    artifact_name: "dhis2",
    content_type: "application/json",
    format: "json",
    generated_at: new Date().toISOString(),
    body: buildDhis2Output(payload, assessment),
  };
}