// ---------------------------------------------------------------------------
// rade-v2 — FHIR transform wrapper
// ---------------------------------------------------------------------------

import { buildEpicFhirOutput } from "../../adapters/epic-fhir.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import { buildConsultAssessmentContext } from "./helpers.js";

export function buildFhirArtifact(consult: CanonicalConsult): ConsultArtifact {
  const { payload, assessment } = buildConsultAssessmentContext(consult);

  return {
    artifact_name: "fhir",
    content_type: "application/json",
    format: "json",
    generated_at: new Date().toISOString(),
    body: {
      adapter: "epic-fhir",
      note:
        "Current consult-level FHIR projection is backed by the existing Epic/SMART scaffold in this repository.",
      payload: buildEpicFhirOutput(payload, assessment),
    },
  };
}