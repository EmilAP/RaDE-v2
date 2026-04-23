// ---------------------------------------------------------------------------
// rade-v2 — Epic / SMART-on-FHIR adapter scaffold
//
// Minimal adapter that maps the canonical intake payload + placeholder
// assessment into FHIR R4 resources suitable for Epic via SMART-on-FHIR.
//
// NOT a complete integration. Produces structural scaffolds only.
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload, NormalizedAnswer } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type FhirResource = {
  resourceType: string;
  id: string;
  [key: string]: unknown;
};

export type EpicFhirOutput = {
  launch_context_placeholder: {
    iss: string;
    launch: string;
    patient: string;
    note: string;
  };
  questionnaire: FhirResource;
  questionnaire_response: FhirResource;
  observations: FhirResource[];
  task: FhirResource;
  bundle: FhirResource;
};

// ── Builder ────────────────────────────────────────────────────────────────

export function buildEpicFhirOutput(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
  patientId: string = "placeholder-patient-id",
  encounterId: string = "placeholder-encounter-id",
): EpicFhirOutput {
  const questionnaire = buildQuestionnaire(payload);
  const qr = buildQuestionnaireResponse(payload, patientId, encounterId);
  const observations = buildObservations(payload, patientId, encounterId);
  const task = buildTask(assessment, patientId);
  const bundle = buildBundle(questionnaire, qr, observations, task);

  return {
    launch_context_placeholder: {
      iss: "https://fhir.epic.example.com/R4",
      launch: "placeholder-launch-token",
      patient: patientId,
      note: "SMART-on-FHIR launch context — replace with real Epic endpoint",
    },
    questionnaire,
    questionnaire_response: qr,
    observations,
    task,
    bundle,
  };
}

// ── FHIR Questionnaire ────────────────────────────────────────────────────

function buildQuestionnaire(payload: CanonicalCasePayload): FhirResource {
  const items = payload.sections.flatMap((sec) =>
    sec.answers.map((a) => ({
      linkId: a.question_id,
      text: a.question_id, // text from questionnaire model; placeholder here
      type: mapResponseTypeToFhir(a.response_type),
    })),
  );

  return {
    resourceType: "Questionnaire",
    id: `rade-rabies-intake-${payload.schema_id}`,
    status: "draft",
    title: "Rabies PEP Intake Questionnaire",
    subjectType: ["Patient"],
    item: items,
  };
}

// ── FHIR QuestionnaireResponse ─────────────────────────────────────────────

function buildQuestionnaireResponse(
  payload: CanonicalCasePayload,
  patientId: string,
  encounterId: string,
): FhirResource {
  const items: Array<Record<string, unknown>> = [];

  for (const sec of payload.sections) {
    for (const a of sec.answers) {
      if (!a.is_answered) continue;
      items.push({
        linkId: a.question_id,
        answer: [mapAnswerToFhir(a)],
      });
    }
  }

  return {
    resourceType: "QuestionnaireResponse",
    id: `rade-qr-${payload.payload_id}`,
    questionnaire: `Questionnaire/rade-rabies-intake-${payload.schema_id}`,
    status: "completed",
    subject: { reference: `Patient/${patientId}` },
    encounter: { reference: `Encounter/${encounterId}` },
    authored: payload.created_at,
    item: items,
  };
}

// ── Key Observations (denormalized for queryability) ───────────────────────

function buildObservations(
  payload: CanonicalCasePayload,
  patientId: string,
  encounterId: string,
): FhirResource[] {
  const obs: FhirResource[] = [];
  let idx = 0;

  for (const df of payload.derived_facts) {
    obs.push({
      resourceType: "Observation",
      id: `rade-obs-${idx++}`,
      status: "preliminary",
      category: [
        {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/observation-category",
              code: "survey",
            },
          ],
        },
      ],
      code: {
        coding: [
          {
            system: "urn:rade:derived-fact",
            code: df.fact_id,
            display: df.derivation,
          },
        ],
      },
      subject: { reference: `Patient/${patientId}` },
      encounter: { reference: `Encounter/${encounterId}` },
      valueBoolean: typeof df.value === "boolean" ? df.value : undefined,
      valueString: typeof df.value === "string" ? df.value : undefined,
      effectiveDateTime: payload.created_at,
    });
  }

  return obs;
}

// ── Task (placeholder for follow-up) ───────────────────────────────────────

function buildTask(
  assessment: PlaceholderAssessment,
  patientId: string,
): FhirResource {
  return {
    resourceType: "Task",
    id: `rade-task-${assessment.assessment_id}`,
    status: "requested",
    intent: "order",
    priority: "urgent",
    description: `Rabies PEP Intake: ${assessment.recommendation_code}`,
    for: { reference: `Patient/${patientId}` },
    authoredOn: assessment.created_at,
    note: [
      { text: assessment.rationale.summary },
      { text: "TODO: Replace with canonical flow output when available" },
    ],
  };
}

// ── Bundle ─────────────────────────────────────────────────────────────────

function buildBundle(
  questionnaire: FhirResource,
  qr: FhirResource,
  observations: FhirResource[],
  task: FhirResource,
): FhirResource {
  const entries = [questionnaire, qr, ...observations, task].map((r) => ({
    fullUrl: `urn:rade:${r.resourceType}/${r.id}`,
    resource: r,
  }));

  return {
    resourceType: "Bundle",
    id: `rade-bundle-${Date.now()}`,
    type: "collection",
    timestamp: new Date().toISOString(),
    entry: entries,
  };
}

// ── Response type mapping ──────────────────────────────────────────────────

function mapResponseTypeToFhir(rt: string): string {
  switch (rt) {
    case "binary_yn":
    case "ternary_ynu":
      return "choice";
    case "enum":
    case "count_enum":
      return "choice";
    case "multiselect_any":
      return "choice"; // with repeats
    case "datetime":
      return "dateTime";
    case "free_text":
      return "text";
    default:
      return "string";
  }
}

function mapAnswerToFhir(a: NormalizedAnswer): Record<string, unknown> {
  switch (a.raw_value.kind) {
    case "binary":
    case "ternary":
      return { valueCoding: { code: a.raw_value.value, display: a.raw_value.value } };
    case "enum":
    case "count_enum":
      return { valueCoding: { code: a.raw_value.value, display: a.raw_value.value } };
    case "multiselect":
      return { valueString: a.raw_value.values.join(", ") };
    case "datetime":
      return { valueDateTime: a.raw_value.value };
    case "free_text":
      return { valueString: a.raw_value.value };
    default:
      return { valueString: a.normalized_string };
  }
}
