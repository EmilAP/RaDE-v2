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

// Intake v2 (canonical intake pipeline)
export {
  loadCanonicalIntake,
  clearLoaderCache,
  buildQuestionnaire,
  getQuestion,
  getSection,
  questionsBySection,
  questionsByClassification,
  validateAnswers,
  buildAnswerSet,
  Ans,
  buildCanonicalPayload,
  generatePlaceholderAssessment,
  type RawCanonicalIntake,
  type RawQuestion,
  type RawSection,
  type LoadResult,
  type ValidationIssue,
  type IntakeMetadataReport,
  type Questionnaire,
  type QuestionMeta,
  type SectionMeta,
  type ResponseTypeMeta,
  type AnswerValue,
  type IntakeAnswerSet,
  type AnswerValidationResult,
  type CanonicalCasePayload,
  type NormalizedAnswer,
  type SectionPayload,
  type ClassificationBucket,
  type SourceTrace,
  type DerivedFact,
  type PlaceholderAssessment,
  type AssessmentStatus,
  type PlaceholderRecommendationCode,
} from "./intake/index";

// Renderers
export { renderClinicianNote } from "./renderers/clinician";
export { renderClinicianIntake } from "./renderers/clinician-v2";
export { renderPublicHealth } from "./renderers/public-health";
export { renderPatientSummary } from "./renderers/patient";

// Adapters
export { buildFhirOutput, type FhirOutput } from "./adapters/fhir";
export { buildEpicFhirOutput, type EpicFhirOutput } from "./adapters/epic-fhir";
export { buildOpenEmrOutput, type OpenEmrOutput } from "./adapters/openemr";
export { buildSormasOutput, type SormasOutput } from "./adapters/sormas";
export {
  buildDhis2Output,
  buildFollowUpEvent,
  type Dhis2Output,
  type Dhis2TrackerPayload,
  type Dhis2TrackedEntity,
  type Dhis2Enrollment,
  type Dhis2Event,
  type Dhis2DataValue,
  type Dhis2ValidationReport,
  type TeiDemographics,
  type FollowUpVisitInput,
} from "./adapters/dhis2-tracker";

// Mapping manifests
export {
  generateMappingManifest,
  type IntakeToPayloadMapping,
  type IntakeToRendererMapping,
  type IntakeToPlatformMapping,
  type MappingManifest,
} from "./manifests/intake-mapping";

export {
  generateDhis2Manifest,
  DHIS2_PROGRAM,
  DHIS2_TRACKED_ENTITY_TYPE,
  DHIS2_PROGRAM_STAGES,
  TEI_ATTRIBUTES,
  getDataElementUid,
  type Dhis2MappingManifest,
  type Dhis2DataElementDef,
  type Dhis2OptionSetDef,
  type Dhis2TeiAttributeDef,
  type Dhis2ValueType,
} from "./manifests/dhis2-mapping";
