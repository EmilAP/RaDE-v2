// ---------------------------------------------------------------------------
// rade-v2 — Assessment pipeline
//
// Single entry point that wires engine → case → assessment → envelope.
// ---------------------------------------------------------------------------

import type { AssessmentInput, CaseEnvelope, EngineResult } from "./types";
import { runEngine } from "./engine";
import { buildCase, buildAssessment, createEnvelope } from "./envelope";
import { mapAnswersToEngineInput, type IntakeAnswers } from "./intake";

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

// ── Intake-driven pipeline ─────────────────────────────────────────────────

export type IntakeAssessmentResult = AssessmentResult & {
  mapped_input: AssessmentInput;
};

export function runIntakeAssessment(
  answers: IntakeAnswers,
): IntakeAssessmentResult {
  const mappedInput = mapAnswersToEngineInput(answers);
  const result = runAssessment(mappedInput);
  return { ...result, mapped_input: mappedInput };
}
