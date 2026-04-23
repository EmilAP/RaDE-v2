// ---------------------------------------------------------------------------
// rade-v2 — PH workspace transform
// ---------------------------------------------------------------------------

import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";
import type { MissingCriticalFieldResolver } from "../consult/missing-fields.js";

export function buildPhWorkspaceArtifact(
  consult: CanonicalConsult,
  resolver: MissingCriticalFieldResolver,
): ConsultArtifact {
  const resolution = resolver.resolve(consult);

  return {
    artifact_name: "ph-workspace",
    content_type: "application/json",
    format: "json",
    generated_at: new Date().toISOString(),
    body: {
      consult_id: consult.consult_id,
      state: consult.current_state,
      missing_critical_fields: resolution.missing_fields,
      engine_decisions: consult.engine_decisions,
      recommendation: consult.recommendation ?? null,
      sections: consult.body.payload.sections,
    },
  };
}