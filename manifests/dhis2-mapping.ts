// ---------------------------------------------------------------------------
// rade-v2 — DHIS2 mapping manifest
//
// Machine-readable mapping between canonical intake questions and
// DHIS2 Tracker data model elements. This is the single source of truth
// for how canonical intake fields land in DHIS2.
// ---------------------------------------------------------------------------

import type { Questionnaire, QuestionMeta } from "../intake/questionnaire.js";
import { buildQuestionnaire } from "../intake/questionnaire.js";

// ── Program constants ──────────────────────────────────────────────────────
// Placeholder UIDs — replace with real DHIS2-generated UIDs on deployment.

export const DHIS2_PROGRAM = {
  uid: "RADE_PROG_001",
  name: "Animal Exposure Intake and Follow-up",
  shortName: "Animal Exposure PEP",
  programType: "WITH_REGISTRATION" as const,
  description:
    "Tracker program for animal exposure (rabies-focused) intake, assessment, and PEP follow-up. Driven by RaDE canonical intake.",
} as const;

export const DHIS2_TRACKED_ENTITY_TYPE = {
  uid: "RADE_TET_PERSON",
  name: "Person",
} as const;

export const DHIS2_PROGRAM_STAGES = {
  exposureIntake: {
    uid: "RADE_PS_INTAKE",
    name: "Exposure Intake",
    sortOrder: 1,
    repeatable: false,
    description:
      "Captures the full initial exposure report: context, animal, exposure details, patient history.",
  },
  assessmentDisposition: {
    uid: "RADE_PS_ASSESS",
    name: "Assessment and Disposition",
    sortOrder: 2,
    repeatable: true,
    description:
      "Assessment outcome and disposition. Repeatable to allow re-assessment as information changes. Currently placeholder — awaiting canonical rabies flow.",
  },
  followUpVisit: {
    uid: "RADE_PS_FOLLOWUP",
    name: "Follow-up Visit",
    sortOrder: 3,
    repeatable: true,
    description:
      "PEP vaccine dose administration and follow-up tracking. Supports standard schedule (days 0, 3, 7, 14, 28).",
  },
} as const;

// ── TEI attributes ─────────────────────────────────────────────────────────

export type Dhis2TeiAttributeDef = {
  uid: string;
  name: string;
  shortName: string;
  valueType: string;
  searchable: boolean;
  mandatory: boolean;
};

export const TEI_ATTRIBUTES: Dhis2TeiAttributeDef[] = [
  {
    uid: "RADE_ATTR_FNAME",
    name: "First name",
    shortName: "First name",
    valueType: "TEXT",
    searchable: true,
    mandatory: false,
  },
  {
    uid: "RADE_ATTR_LNAME",
    name: "Last name",
    shortName: "Last name",
    valueType: "TEXT",
    searchable: true,
    mandatory: false,
  },
  {
    uid: "RADE_ATTR_DOB",
    name: "Date of birth",
    shortName: "DOB",
    valueType: "DATE",
    searchable: false,
    mandatory: false,
  },
  {
    uid: "RADE_ATTR_SEX",
    name: "Sex",
    shortName: "Sex",
    valueType: "TEXT",
    searchable: false,
    mandatory: false,
  },
  {
    uid: "RADE_ATTR_PHONE",
    name: "Phone number",
    shortName: "Phone",
    valueType: "PHONE_NUMBER",
    searchable: true,
    mandatory: false,
  },
  {
    uid: "RADE_ATTR_CASEID",
    name: "Case ID",
    shortName: "Case ID",
    valueType: "TEXT",
    searchable: true,
    mandatory: false,
  },
];

// ── Data element mapping types ─────────────────────────────────────────────

export type Dhis2DataElementDef = {
  uid: string;
  name: string;
  shortName: string;
  canonicalQuestionId: string;
  sectionId: string;
  classification: string;
  valueType: Dhis2ValueType;
  optionSetUid: string | null;
  programStageUid: string;
  compulsory: boolean;
  description: string;
};

export type Dhis2ValueType =
  | "BOOLEAN"
  | "TEXT"
  | "LONG_TEXT"
  | "DATE"
  | "DATETIME"
  | "NUMBER"
  | "INTEGER";

export type Dhis2OptionSetDef = {
  uid: string;
  name: string;
  valueType: "TEXT";
  options: Array<{ uid: string; code: string; name: string; sortOrder: number }>;
};

export type Dhis2MappingManifest = {
  generatedAt: string;
  schemaId: string;
  program: typeof DHIS2_PROGRAM;
  trackedEntityType: typeof DHIS2_TRACKED_ENTITY_TYPE;
  programStages: typeof DHIS2_PROGRAM_STAGES;
  teiAttributes: Dhis2TeiAttributeDef[];
  dataElements: Dhis2DataElementDef[];
  optionSets: Dhis2OptionSetDef[];
  assessmentFields: Dhis2DataElementDef[];
  followUpFields: Dhis2DataElementDef[];
};

// ── Value type mapping ─────────────────────────────────────────────────────

function mapValueType(responseType: string): { valueType: Dhis2ValueType; needsOptionSet: boolean } {
  switch (responseType) {
    case "binary_yn":
      return { valueType: "BOOLEAN", needsOptionSet: false };
    case "ternary_ynu":
      return { valueType: "TEXT", needsOptionSet: true };
    case "enum":
      return { valueType: "TEXT", needsOptionSet: true };
    case "count_enum":
      return { valueType: "TEXT", needsOptionSet: true };
    case "multiselect_any":
      // DHIS2 lacks native multiselect; encode as pipe-delimited TEXT
      return { valueType: "LONG_TEXT", needsOptionSet: false };
    case "datetime":
      return { valueType: "DATETIME", needsOptionSet: false };
    case "free_text":
      return { valueType: "LONG_TEXT", needsOptionSet: false };
    default:
      return { valueType: "TEXT", needsOptionSet: false };
  }
}

// ── Option sets for questions with constrained values ──────────────────────

const SHARED_OPTION_SETS: Dhis2OptionSetDef[] = [
  {
    uid: "RADE_OS_YNU",
    name: "Yes / No / Unknown",
    valueType: "TEXT",
    options: [
      { uid: "RADE_OPT_YES", code: "yes", name: "Yes", sortOrder: 1 },
      { uid: "RADE_OPT_NO", code: "no", name: "No", sortOrder: 2 },
      { uid: "RADE_OPT_UNK", code: "unknown", name: "Unknown", sortOrder: 3 },
    ],
  },
];

// Built dynamically per question during manifest generation
function buildOptionSetForQuestion(q: QuestionMeta): Dhis2OptionSetDef | null {
  if (q.response.type === "ternary_ynu") {
    // Reuse shared YNU option set
    return null;
  }
  if (
    (q.response.type === "enum" || q.response.type === "count_enum") &&
    q.response.option_values.length > 0
  ) {
    return {
      uid: `RADE_OS_${q.id.toUpperCase()}`,
      name: `Options for ${q.id}: ${q.text.slice(0, 60)}`,
      valueType: "TEXT",
      options: q.response.option_values.map((v, i) => ({
        uid: `RADE_OPT_${q.id.toUpperCase()}_${i}`,
        code: v,
        name: v.replace(/_/g, " "),
        sortOrder: i + 1,
      })),
    };
  }
  return null;
}

// ── Assessment stage fields (placeholder) ──────────────────────────────────

const ASSESSMENT_FIELDS: Dhis2DataElementDef[] = [
  {
    uid: "RADE_DE_ASSESS_STATUS",
    name: "Assessment status",
    shortName: "Assess status",
    canonicalQuestionId: "_assessment_status",
    sectionId: "assessment",
    classification: "assessment",
    valueType: "TEXT",
    optionSetUid: "RADE_OS_ASSESS_STATUS",
    programStageUid: DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    compulsory: false,
    description: "Current assessment status. TODO: Driven by canonical flow when finalized.",
  },
  {
    uid: "RADE_DE_RECOMMEND",
    name: "Recommendation code",
    shortName: "Recommend code",
    canonicalQuestionId: "_recommendation_code",
    sectionId: "assessment",
    classification: "assessment",
    valueType: "TEXT",
    optionSetUid: "RADE_OS_RECOMMEND",
    programStageUid: DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    compulsory: false,
    description: "Recommendation output. TODO: Placeholder until rabies flow is integrated.",
  },
  {
    uid: "RADE_DE_LOGIC_VER",
    name: "Decision logic version",
    shortName: "Logic version",
    canonicalQuestionId: "_decision_logic_version",
    sectionId: "assessment",
    classification: "assessment",
    valueType: "TEXT",
    optionSetUid: null,
    programStageUid: DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    compulsory: false,
    description: "Version of the decision logic that produced this assessment. TBD until flow is finalized.",
  },
  {
    uid: "RADE_DE_RISK_SIGNALS",
    name: "Risk signals",
    shortName: "Risk signals",
    canonicalQuestionId: "_risk_signals",
    sectionId: "assessment",
    classification: "assessment",
    valueType: "LONG_TEXT",
    optionSetUid: null,
    programStageUid: DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    compulsory: false,
    description: "Pipe-delimited risk signals detected from derived facts.",
  },
  {
    uid: "RADE_DE_FOLLOWUP_NEEDED",
    name: "Follow-up needed",
    shortName: "Follow-up needed",
    canonicalQuestionId: "_follow_up_needed",
    sectionId: "assessment",
    classification: "assessment",
    valueType: "TEXT",
    optionSetUid: "RADE_OS_YNU",
    programStageUid: DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    compulsory: false,
    description: "Whether follow-up is needed. Placeholder — manually determined until flow logic exists.",
  },
  {
    uid: "RADE_DE_ASSESS_NOTES",
    name: "Assessment notes",
    shortName: "Assess notes",
    canonicalQuestionId: "_assessment_notes",
    sectionId: "assessment",
    classification: "assessment",
    valueType: "LONG_TEXT",
    optionSetUid: null,
    programStageUid: DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    compulsory: false,
    description: "Free-text clinical notes for the assessment.",
  },
];

// ── Assessment option sets ─────────────────────────────────────────────────

const ASSESSMENT_OPTION_SETS: Dhis2OptionSetDef[] = [
  {
    uid: "RADE_OS_ASSESS_STATUS",
    name: "Assessment status",
    valueType: "TEXT",
    options: [
      { uid: "RADE_OPT_AS_PENDING", code: "flow_pending", name: "Flow pending", sortOrder: 1 },
      { uid: "RADE_OPT_AS_PLACEHOLDER", code: "placeholder_generated", name: "Placeholder generated", sortOrder: 2 },
      { uid: "RADE_OPT_AS_ASSESSED", code: "assessed", name: "Assessed", sortOrder: 3 },
      { uid: "RADE_OPT_AS_REVIEW", code: "manual_review", name: "Manual review required", sortOrder: 4 },
    ],
  },
  {
    uid: "RADE_OS_RECOMMEND",
    name: "Recommendation code",
    valueType: "TEXT",
    options: [
      { uid: "RADE_OPT_RC_PENDING", code: "flow_pending", name: "Flow pending", sortOrder: 1 },
      { uid: "RADE_OPT_RC_MANUAL", code: "manual_review_required", name: "Manual review required", sortOrder: 2 },
      { uid: "RADE_OPT_RC_INSUFF", code: "insufficient_logic", name: "Insufficient logic available", sortOrder: 3 },
      { uid: "RADE_OPT_RC_PEP", code: "pep_recommended", name: "PEP recommended", sortOrder: 4 },
      { uid: "RADE_OPT_RC_NOPEP", code: "no_pep", name: "No PEP", sortOrder: 5 },
      { uid: "RADE_OPT_RC_OBS", code: "observe_and_test", name: "Observe and test", sortOrder: 6 },
    ],
  },
];

// ── Follow-up stage fields ─────────────────────────────────────────────────

const FOLLOWUP_FIELDS: Dhis2DataElementDef[] = [
  {
    uid: "RADE_DE_FU_DATE",
    name: "Visit date",
    shortName: "Visit date",
    canonicalQuestionId: "_followup_visit_date",
    sectionId: "follow_up",
    classification: "follow_up",
    valueType: "DATE",
    optionSetUid: null,
    programStageUid: DHIS2_PROGRAM_STAGES.followUpVisit.uid,
    compulsory: true,
    description: "Date of the follow-up visit.",
  },
  {
    uid: "RADE_DE_FU_TYPE",
    name: "Visit type",
    shortName: "Visit type",
    canonicalQuestionId: "_followup_visit_type",
    sectionId: "follow_up",
    classification: "follow_up",
    valueType: "TEXT",
    optionSetUid: "RADE_OS_FU_TYPE",
    programStageUid: DHIS2_PROGRAM_STAGES.followUpVisit.uid,
    compulsory: false,
    description: "Type of follow-up visit.",
  },
  {
    uid: "RADE_DE_FU_DOSE",
    name: "Vaccine dose number",
    shortName: "Dose number",
    canonicalQuestionId: "_followup_dose_number",
    sectionId: "follow_up",
    classification: "follow_up",
    valueType: "INTEGER",
    optionSetUid: null,
    programStageUid: DHIS2_PROGRAM_STAGES.followUpVisit.uid,
    compulsory: false,
    description: "PEP vaccine dose number (1-5 for standard schedule).",
  },
  {
    uid: "RADE_DE_FU_RIG",
    name: "RIG administered",
    shortName: "RIG given",
    canonicalQuestionId: "_followup_rig_administered",
    sectionId: "follow_up",
    classification: "follow_up",
    valueType: "BOOLEAN",
    optionSetUid: null,
    programStageUid: DHIS2_PROGRAM_STAGES.followUpVisit.uid,
    compulsory: false,
    description: "Whether rabies immunoglobulin was administered at this visit.",
  },
  {
    uid: "RADE_DE_FU_OUTCOME",
    name: "Outcome status",
    shortName: "Outcome",
    canonicalQuestionId: "_followup_outcome_status",
    sectionId: "follow_up",
    classification: "follow_up",
    valueType: "TEXT",
    optionSetUid: "RADE_OS_FU_OUTCOME",
    programStageUid: DHIS2_PROGRAM_STAGES.followUpVisit.uid,
    compulsory: false,
    description: "Outcome status of the follow-up visit.",
  },
  {
    uid: "RADE_DE_FU_NOTES",
    name: "Follow-up notes",
    shortName: "FU notes",
    canonicalQuestionId: "_followup_notes",
    sectionId: "follow_up",
    classification: "follow_up",
    valueType: "LONG_TEXT",
    optionSetUid: null,
    programStageUid: DHIS2_PROGRAM_STAGES.followUpVisit.uid,
    compulsory: false,
    description: "Free-text notes for the follow-up visit.",
  },
];

const FOLLOWUP_OPTION_SETS: Dhis2OptionSetDef[] = [
  {
    uid: "RADE_OS_FU_TYPE",
    name: "Follow-up visit type",
    valueType: "TEXT",
    options: [
      { uid: "RADE_OPT_FT_DOSE", code: "vaccine_dose", name: "Vaccine dose", sortOrder: 1 },
      { uid: "RADE_OPT_FT_RIG", code: "rig_administration", name: "RIG administration", sortOrder: 2 },
      { uid: "RADE_OPT_FT_OBS", code: "observation_check", name: "Observation check", sortOrder: 3 },
      { uid: "RADE_OPT_FT_TEST", code: "test_result_review", name: "Test result review", sortOrder: 4 },
      { uid: "RADE_OPT_FT_CLOSE", code: "case_closure", name: "Case closure", sortOrder: 5 },
    ],
  },
  {
    uid: "RADE_OS_FU_OUTCOME",
    name: "Follow-up outcome",
    valueType: "TEXT",
    options: [
      { uid: "RADE_OPT_FO_SCHED", code: "on_schedule", name: "On schedule", sortOrder: 1 },
      { uid: "RADE_OPT_FO_DELAY", code: "delayed", name: "Delayed", sortOrder: 2 },
      { uid: "RADE_OPT_FO_COMP", code: "completed", name: "Completed", sortOrder: 3 },
      { uid: "RADE_OPT_FO_DISC", code: "discontinued", name: "Discontinued", sortOrder: 4 },
      { uid: "RADE_OPT_FO_LOST", code: "lost_to_followup", name: "Lost to follow-up", sortOrder: 5 },
    ],
  },
];

// ── Manifest builder ───────────────────────────────────────────────────────

export function generateDhis2Manifest(
  questionnaire?: Questionnaire,
): Dhis2MappingManifest {
  const q = questionnaire ?? buildQuestionnaire();

  const dataElements: Dhis2DataElementDef[] = [];
  const optionSets: Dhis2OptionSetDef[] = [...SHARED_OPTION_SETS];
  const seenOptionSets = new Set(optionSets.map((os) => os.uid));

  for (const question of q.questions) {
    const { valueType, needsOptionSet } = mapValueType(question.response.type);

    let optionSetUid: string | null = null;
    if (question.response.type === "ternary_ynu") {
      optionSetUid = "RADE_OS_YNU";
    } else if (needsOptionSet) {
      const os = buildOptionSetForQuestion(question);
      if (os && !seenOptionSets.has(os.uid)) {
        optionSets.push(os);
        seenOptionSets.add(os.uid);
      }
      optionSetUid = os?.uid ?? null;
    }

    dataElements.push({
      uid: `RADE_DE_${question.id.toUpperCase()}`,
      name: questionToDataElementName(question),
      shortName: `${question.id} ${question.text.slice(0, 40)}`,
      canonicalQuestionId: question.id,
      sectionId: question.section_id,
      classification: question.classification,
      valueType,
      optionSetUid,
      programStageUid: DHIS2_PROGRAM_STAGES.exposureIntake.uid,
      compulsory: question.classification === "core",
      description: question.text,
    });
  }

  // Add assessment and follow-up option sets
  for (const os of [...ASSESSMENT_OPTION_SETS, ...FOLLOWUP_OPTION_SETS]) {
    if (!seenOptionSets.has(os.uid)) {
      optionSets.push(os);
      seenOptionSets.add(os.uid);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    schemaId: q.schema_id,
    program: DHIS2_PROGRAM,
    trackedEntityType: DHIS2_TRACKED_ENTITY_TYPE,
    programStages: DHIS2_PROGRAM_STAGES,
    teiAttributes: TEI_ATTRIBUTES,
    dataElements,
    optionSets,
    assessmentFields: ASSESSMENT_FIELDS,
    followUpFields: FOLLOWUP_FIELDS,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function questionToDataElementName(q: QuestionMeta): string {
  // Produce a human-readable data element name from the question
  // Format: "RADE - <section short> - <question summary>"
  const sectionShort = q.section_id.replace(/_/g, " ");
  const textShort = q.text.length > 80 ? q.text.slice(0, 77) + "..." : q.text;
  return `RADE ${q.id} - ${textShort}`;
}

// ── Exports for use in adapter ─────────────────────────────────────────────

export function getDataElementUid(canonicalQuestionId: string): string {
  return `RADE_DE_${canonicalQuestionId.toUpperCase()}`;
}

export function getOptionSetUidForTernary(): string {
  return "RADE_OS_YNU";
}
