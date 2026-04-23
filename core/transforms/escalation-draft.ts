// ---------------------------------------------------------------------------
// rade-v2 — Escalation draft transform
// ---------------------------------------------------------------------------

import { renderEscalationDraft } from "../../renderers/escalation-draft.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";

export function buildEscalationDraftArtifact(consult: CanonicalConsult): ConsultArtifact {
  const rendered = renderEscalationDraft(consult);

  return {
    artifact_name: "escalation-draft",
    content_type: "text/plain",
    format: "text",
    generated_at: new Date().toISOString(),
    body: rendered.note_text,
  };
}