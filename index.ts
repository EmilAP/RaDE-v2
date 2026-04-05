// ---------------------------------------------------------------------------
// rade-v2 — Barrel exports
// ---------------------------------------------------------------------------

// Types
export type {
  AssessmentInput,
  CaseEnvelope,
  Assessment,
  ClinicalCase,
  ClinicianSummary,
  CdsCard,
  FhirBundle,
  FhirBundleEntry,
  FhirResource,
  EngineResult,
  FollowUpTask,
  HostProfile,
  RecommendationCategory,
  RiskTier,
  Urgency,
  WorkflowStatus,
} from "./core/types";

// Pipeline
export { runAssessment, type AssessmentResult } from "./core/pipeline";
export {
  runIntakeAssessment,
  type IntakeAssessmentResult,
} from "./core/pipeline";

// Intake
export {
  mapAnswersToEngineInput,
  loadChecklist,
  type IntakeAnswers,
  type CanonicalChecklist,
} from "./core/intake";

// Engine (for advanced usage)
export { runEngine } from "./core/engine";

// Renderers
export { renderClinicianNote } from "./renderers/clinician";

// Adapters
export { buildFhirOutput, type FhirOutput } from "./adapters/fhir";
