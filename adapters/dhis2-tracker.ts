// ---------------------------------------------------------------------------
// rade-v2 — DHIS2 Tracker adapter
//
// Maps canonical intake payload + placeholder assessment into DHIS2
// Tracker API-compatible import payloads.
//
// Program model:
//   Stage 1: Exposure Intake (non-repeatable) — all c01–c44 intake fields
//   Stage 2: Assessment & Disposition (repeatable) — placeholder assessment
//   Stage 3: Follow-up Visit (repeatable) — PEP schedule tracking
//
// All UIDs are placeholder identifiers (RADE_*). Replace with actual
// DHIS2-generated UIDs before deployment.
//
// Reference: POST /api/tracker with { trackedEntities, enrollments, events }
//            POST /api/tracker?importMode=VALIDATE for dry-run
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload, NormalizedAnswer } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";
import {
  DHIS2_PROGRAM,
  DHIS2_TRACKED_ENTITY_TYPE,
  DHIS2_PROGRAM_STAGES,
  TEI_ATTRIBUTES,
  getDataElementUid,
  generateDhis2Manifest,
  type Dhis2MappingManifest,
} from "../manifests/dhis2-mapping.js";

// ── Output types ───────────────────────────────────────────────────────────

export type Dhis2Output = {
  trackerPayload: Dhis2TrackerPayload;
  manifest: Dhis2MappingManifest;
  validationReport: Dhis2ValidationReport;
  notes: string[];
};

export type Dhis2TrackerPayload = {
  trackedEntities: Dhis2TrackedEntity[];
  enrollments: Dhis2Enrollment[];
  events: Dhis2Event[];
};

export type Dhis2TrackedEntity = {
  trackedEntity: string;
  trackedEntityType: string;
  orgUnit: string;
  attributes: Array<{ attribute: string; value: string }>;
};

export type Dhis2Enrollment = {
  enrollment: string;
  trackedEntity: string;
  program: string;
  orgUnit: string;
  enrolledAt: string;
  occurredAt: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
};

export type Dhis2Event = {
  event: string;
  program: string;
  programStage: string;
  trackedEntity: string;
  orgUnit: string;
  occurredAt: string;
  status: "ACTIVE" | "COMPLETED" | "SCHEDULE";
  dataValues: Dhis2DataValue[];
  notes?: Array<{ value: string }>;
};

export type Dhis2DataValue = {
  dataElement: string;
  value: string;
};

// ── Validation report ──────────────────────────────────────────────────────

export type Dhis2ValidationReport = {
  valid: boolean;
  placeholderUids: string[];
  missingRequiredFields: string[];
  warnings: string[];
  readyForValidateEndpoint: boolean;
};

// ── TEI demographic options ────────────────────────────────────────────────

export type TeiDemographics = {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  sex?: string;
  phone?: string;
};

// ── Builder ────────────────────────────────────────────────────────────────

export function buildDhis2Output(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
  orgUnitId: string = "PLACEHOLDER_ORG_UNIT",
  demographics?: TeiDemographics,
): Dhis2Output {
  const manifest = generateDhis2Manifest();

  const teiId = `RADE_TEI_${payload.payload_id}`;
  const enrollmentId = `RADE_ENROLL_${payload.payload_id}`;

  const trackedEntity = buildTrackedEntity(teiId, orgUnitId, demographics);
  const enrollment = buildEnrollment(enrollmentId, teiId, payload, orgUnitId);
  const intakeEvent = buildIntakeEvent(teiId, payload, orgUnitId);
  const assessmentEvent = buildAssessmentEvent(teiId, payload, assessment, orgUnitId);

  const trackerPayload: Dhis2TrackerPayload = {
    trackedEntities: [trackedEntity],
    enrollments: [enrollment],
    events: [intakeEvent, assessmentEvent],
  };

  const validationReport = validatePayload(trackerPayload, payload);

  const notes = buildNotes(payload, assessment, validationReport);

  return { trackerPayload, manifest, validationReport, notes };
}

// ── Tracked entity ─────────────────────────────────────────────────────────

function buildTrackedEntity(
  teiId: string,
  orgUnitId: string,
  demographics?: TeiDemographics,
): Dhis2TrackedEntity {
  const attributes: Array<{ attribute: string; value: string }> = [];

  if (demographics?.firstName) {
    attributes.push({ attribute: "RADE_ATTR_FNAME", value: demographics.firstName });
  }
  if (demographics?.lastName) {
    attributes.push({ attribute: "RADE_ATTR_LNAME", value: demographics.lastName });
  }
  if (demographics?.dateOfBirth) {
    attributes.push({ attribute: "RADE_ATTR_DOB", value: demographics.dateOfBirth });
  }
  if (demographics?.sex) {
    attributes.push({ attribute: "RADE_ATTR_SEX", value: demographics.sex });
  }
  if (demographics?.phone) {
    attributes.push({ attribute: "RADE_ATTR_PHONE", value: demographics.phone });
  }

  // Always add the case ID
  attributes.push({ attribute: "RADE_ATTR_CASEID", value: teiId });

  return {
    trackedEntity: teiId,
    trackedEntityType: DHIS2_TRACKED_ENTITY_TYPE.uid,
    orgUnit: orgUnitId,
    attributes,
  };
}

// ── Enrollment ─────────────────────────────────────────────────────────────

function buildEnrollment(
  enrollmentId: string,
  teiId: string,
  payload: CanonicalCasePayload,
  orgUnitId: string,
): Dhis2Enrollment {
  return {
    enrollment: enrollmentId,
    trackedEntity: teiId,
    program: DHIS2_PROGRAM.uid,
    orgUnit: orgUnitId,
    enrolledAt: payload.created_at,
    occurredAt: payload.created_at,
    status: "ACTIVE",
  };
}

// ── Stage 1: Exposure Intake event ─────────────────────────────────────────

function buildIntakeEvent(
  teiId: string,
  payload: CanonicalCasePayload,
  orgUnitId: string,
): Dhis2Event {
  const dataValues: Dhis2DataValue[] = [];

  for (const section of payload.sections) {
    for (const answer of section.answers) {
      if (!answer.is_answered) continue;

      dataValues.push({
        dataElement: getDataElementUid(answer.question_id),
        value: serializeAnswerForDhis2(answer),
      });
    }
  }

  return {
    event: `RADE_EVT_INTAKE_${payload.payload_id}`,
    program: DHIS2_PROGRAM.uid,
    programStage: DHIS2_PROGRAM_STAGES.exposureIntake.uid,
    trackedEntity: teiId,
    orgUnit: orgUnitId,
    occurredAt: payload.created_at,
    status: "COMPLETED",
    dataValues,
  };
}

// ── Stage 2: Assessment & Disposition event ────────────────────────────────

function buildAssessmentEvent(
  teiId: string,
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
  orgUnitId: string,
): Dhis2Event {
  const dataValues: Dhis2DataValue[] = [
    {
      dataElement: "RADE_DE_ASSESS_STATUS",
      value: assessment.status === "placeholder_assessment_generated"
        ? "flow_pending"
        : assessment.status,
    },
    {
      dataElement: "RADE_DE_RECOMMEND",
      value: assessment.recommendation_code,
    },
    {
      dataElement: "RADE_DE_LOGIC_VER",
      // TODO: Replace with actual version when canonical flow is finalized
      value: "TBD — canonical_rabies_flow not finalized",
    },
    {
      dataElement: "RADE_DE_RISK_SIGNALS",
      value: assessment.risk_signals.join("|"),
    },
    {
      dataElement: "RADE_DE_FOLLOWUP_NEEDED",
      // TODO: Derive from canonical flow when available
      value: assessment.risk_signals.length > 0 ? "yes" : "unknown",
    },
    {
      dataElement: "RADE_DE_ASSESS_NOTES",
      value: assessment.rationale.summary,
    },
  ];

  return {
    event: `RADE_EVT_ASSESS_${payload.payload_id}`,
    program: DHIS2_PROGRAM.uid,
    programStage: DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    trackedEntity: teiId,
    orgUnit: orgUnitId,
    occurredAt: payload.created_at,
    status: "ACTIVE",
    dataValues,
    notes: [
      { value: "Placeholder assessment — canonical rabies flow not yet finalized." },
      ...assessment.todo_markers.map((t) => ({ value: t })),
    ],
  };
}

// ── Follow-up event builder (for future use) ───────────────────────────────

export type FollowUpVisitInput = {
  visitDate: string;
  visitType: string;
  doseNumber?: number;
  rigAdministered?: boolean;
  outcomeStatus?: string;
  notes?: string;
};

export function buildFollowUpEvent(
  teiId: string,
  payloadId: string,
  orgUnitId: string,
  visit: FollowUpVisitInput,
  eventIndex: number,
): Dhis2Event {
  const dataValues: Dhis2DataValue[] = [
    { dataElement: "RADE_DE_FU_DATE", value: visit.visitDate },
    { dataElement: "RADE_DE_FU_TYPE", value: visit.visitType },
  ];

  if (visit.doseNumber != null) {
    dataValues.push({ dataElement: "RADE_DE_FU_DOSE", value: String(visit.doseNumber) });
  }
  if (visit.rigAdministered != null) {
    dataValues.push({ dataElement: "RADE_DE_FU_RIG", value: String(visit.rigAdministered) });
  }
  if (visit.outcomeStatus) {
    dataValues.push({ dataElement: "RADE_DE_FU_OUTCOME", value: visit.outcomeStatus });
  }
  if (visit.notes) {
    dataValues.push({ dataElement: "RADE_DE_FU_NOTES", value: visit.notes });
  }

  return {
    event: `RADE_EVT_FU_${payloadId}_${eventIndex}`,
    program: DHIS2_PROGRAM.uid,
    programStage: DHIS2_PROGRAM_STAGES.followUpVisit.uid,
    trackedEntity: teiId,
    orgUnit: orgUnitId,
    occurredAt: visit.visitDate,
    status: visit.outcomeStatus === "completed" ? "COMPLETED" : "ACTIVE",
    dataValues,
  };
}

// ── Answer serialization ───────────────────────────────────────────────────

function serializeAnswerForDhis2(answer: NormalizedAnswer): string {
  const raw = answer.raw_value;
  switch (raw.kind) {
    case "binary":
      // DHIS2 BOOLEAN expects "true" / "false"
      return raw.value === "yes" ? "true" : "false";
    case "ternary":
      return raw.value; // "yes" | "no" | "unknown" → matches option set
    case "enum":
    case "count_enum":
      return raw.value;
    case "multiselect":
      return raw.values.join("|"); // pipe-delimited for DHIS2
    case "datetime":
      return raw.value;
    case "free_text":
      return raw.value;
    default:
      return answer.normalized_string;
  }
}

// ── Validation ─────────────────────────────────────────────────────────────

function validatePayload(
  tracker: Dhis2TrackerPayload,
  payload: CanonicalCasePayload,
): Dhis2ValidationReport {
  const placeholderUids: string[] = [];
  const missingRequired: string[] = [];
  const warnings: string[] = [];

  // Check for placeholder UIDs
  const allUidFields = [
    tracker.trackedEntities[0]?.trackedEntityType,
    tracker.trackedEntities[0]?.orgUnit,
    tracker.enrollments[0]?.program,
    ...tracker.events.map((e) => e.programStage),
    ...tracker.events.map((e) => e.orgUnit),
  ];

  for (const uid of allUidFields) {
    if (uid && (uid.startsWith("RADE_") || uid.startsWith("PLACEHOLDER_"))) {
      if (!placeholderUids.includes(uid)) {
        placeholderUids.push(uid);
      }
    }
  }

  // Check data element UIDs
  for (const event of tracker.events) {
    for (const dv of event.dataValues) {
      if (dv.dataElement.startsWith("RADE_DE_")) {
        if (!placeholderUids.includes(dv.dataElement)) {
          placeholderUids.push(dv.dataElement);
        }
      }
    }
  }

  // Check for missing required intake fields (core classification)
  if (payload.unresolved_fields.length > 0) {
    missingRequired.push(
      ...payload.unresolved_fields.map((f) => `Core question ${f} is unanswered`),
    );
  }

  // Warnings
  if (tracker.trackedEntities[0]?.orgUnit === "PLACEHOLDER_ORG_UNIT") {
    warnings.push("orgUnit is placeholder — must be set to a real DHIS2 org unit UID");
  }
  if (placeholderUids.length > 0) {
    warnings.push(
      `${placeholderUids.length} placeholder UID(s) must be replaced with real DHIS2 UIDs before import`,
    );
  }

  const hasAnyPlaceholder = placeholderUids.length > 0;

  return {
    valid: !hasAnyPlaceholder && missingRequired.length === 0,
    placeholderUids,
    missingRequiredFields: missingRequired,
    warnings,
    readyForValidateEndpoint: !hasAnyPlaceholder,
  };
}

// ── Notes builder ──────────────────────────────────────────────────────────

function buildNotes(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
  validation: Dhis2ValidationReport,
): string[] {
  const notes: string[] = [];

  notes.push("--- DHIS2 Export Notes ---");
  notes.push(`Payload: ${payload.payload_id}`);
  notes.push(`Questions answered: ${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count}`);
  notes.push(`Assessment status: ${assessment.status} (${assessment.recommendation_code})`);

  if (validation.placeholderUids.length > 0) {
    notes.push("");
    notes.push("REQUIRED BEFORE IMPORT:");
    notes.push("  Replace all RADE_* placeholder UIDs with real DHIS2-generated UIDs.");
    notes.push("  Replace PLACEHOLDER_ORG_UNIT with a real org unit UID.");
    notes.push("  Use POST /api/tracker?importMode=VALIDATE to test before live import.");
  }

  notes.push("");
  notes.push("PLACEHOLDER AREAS (awaiting canonical rabies flow):");
  notes.push("  - Assessment status: flow_pending");
  notes.push("  - Recommendation code: " + assessment.recommendation_code);
  notes.push("  - Decision logic version: TBD");
  notes.push("  - Follow-up determination: manual until flow is integrated");

  if (assessment.risk_signals.length > 0) {
    notes.push("");
    notes.push("RISK SIGNALS DETECTED:");
    for (const sig of assessment.risk_signals) {
      notes.push(`  - ${sig}`);
    }
  }

  return notes;
}
