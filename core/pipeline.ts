// ---------------------------------------------------------------------------
// rade-v2 — Assessment pipeline
//
// Single entry point that wires engine → case → assessment → envelope.
// ---------------------------------------------------------------------------

import type { AssessmentInput, CaseEnvelope, EngineResult } from "./types";
import { runEngine } from "./engine";
import { buildCase, buildAssessment, createEnvelope } from "./envelope";

export type AssessmentResult = {
  envelope: CaseEnvelope;
  engine_result: EngineResult;
};

export function runAssessment(input: AssessmentInput): AssessmentResult {
  const engineResult = runEngine(input);
  const clinicalCase = buildCase(input);
  const assessment = buildAssessment(engineResult, clinicalCase);
  const envelope = createEnvelope(clinicalCase, assessment);
  return { envelope, engine_result: engineResult };
}
