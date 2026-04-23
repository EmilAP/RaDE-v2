// ---------------------------------------------------------------------------
// rade-v2 — intake barrel exports
// ---------------------------------------------------------------------------

export {
  loadCanonicalIntake,
  clearLoaderCache,
  type RawCanonicalIntake,
  type RawQuestion,
  type RawSection,
  type LoadResult,
  type ValidationIssue,
  type IntakeMetadataReport,
} from "./loader.js";

export {
  buildQuestionnaire,
  getQuestion,
  getSection,
  questionsBySection,
  questionsByClassification,
  type Questionnaire,
  type QuestionMeta,
  type SectionMeta,
  type ResponseTypeMeta,
} from "./questionnaire.js";

export {
  validateAnswers,
  buildAnswerSet,
  Ans,
  type AnswerValue,
  type IntakeAnswerSet,
  type AnswerValidationResult,
} from "./answers.js";

export {
  buildCanonicalPayload,
  type CanonicalCasePayload,
  type NormalizedAnswer,
  type SectionPayload,
  type ClassificationBucket,
  type SourceTrace,
  type DerivedFact,
} from "./payload.js";

export {
  generatePlaceholderAssessment,
  type PlaceholderAssessment,
  type AssessmentStatus,
  type PlaceholderRecommendationCode,
} from "./assessment.js";
