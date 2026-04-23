// ---------------------------------------------------------------------------
// rade-v2 — Intake provenance re-exports
// ---------------------------------------------------------------------------

export type {
  IntakeActorCapture,
  SourceModality,
  ProvenanceConfidence,
  ProvenanceStatus,
  AnswerProvenance,
  IntakeAnswer,
} from "./answers.js";

export {
  withProvenance,
  getAnswerValue,
  getAnswerProvenance,
} from "./answers.js";