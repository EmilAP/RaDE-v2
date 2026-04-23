// ---------------------------------------------------------------------------
// rade-v2 — PH internal note transform
// ---------------------------------------------------------------------------

import { renderPhInternalNote } from "../../renderers/ph-internal-note.js";
import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";

export function buildPhInternalNoteArtifact(consult: CanonicalConsult): ConsultArtifact {
  const rendered = renderPhInternalNote(consult);

  return {
    artifact_name: "ph-internal-note",
    content_type: "text/plain",
    format: "text",
    generated_at: new Date().toISOString(),
    body: rendered.note_text,
  };
}