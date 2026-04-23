// ---------------------------------------------------------------------------
// rade-v2 — OpenEMR adapter scaffold
//
// Maps canonical intake payload + placeholder assessment into:
//   1. Intake summary for chart display
//   2. Chart-ready clinical note
//   3. Structured export payload (FHIR-friendly Encounter + QR)
//
// Based on OpenEMR FHIR R4 API analysis:
//   - POST /fhir/Encounter (intake visit container)
//   - POST /fhir/QuestionnaireResponse (structured answers)
//   - POST /fhir/Observation (denormalized key fields)
//
// This is a SCAFFOLD — not a live integration.
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";

export type { CanonicalCasePayload, PlaceholderAssessment };

// ── Types ──────────────────────────────────────────────────────────────────

export type OpenEmrOutput = {
  intake_summary: string;
  chart_note: string;
  fhir_encounter: Record<string, unknown>;
  fhir_questionnaire_response: Record<string, unknown>;
  fhir_observations: Array<Record<string, unknown>>;
};

// ── Builder ────────────────────────────────────────────────────────────────

export function buildOpenEmrOutput(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
  patientUuid: string = "placeholder-patient-uuid",
  encounterUuid: string = "placeholder-encounter-uuid",
  facilityId: string = "1",
): OpenEmrOutput {
  return {
    intake_summary: buildIntakeSummary(payload, assessment),
    chart_note: buildChartNote(payload, assessment),
    fhir_encounter: buildEncounter(patientUuid, encounterUuid, payload),
    fhir_questionnaire_response: buildQR(payload, patientUuid, encounterUuid),
    fhir_observations: buildObservations(payload, patientUuid, encounterUuid),
  };
}

// ── Intake summary ─────────────────────────────────────────────────────────

function buildIntakeSummary(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): string {
  const lines: string[] = [
    "OpenEMR — Rabies PEP Intake Summary",
    `Date: ${payload.created_at}`,
    `Questions: ${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count}`,
    `Assessment: ${assessment.recommendation_code} (${assessment.status})`,
    "",
  ];

  for (const sec of payload.sections) {
    if (sec.answered_count === 0) continue;
    lines.push(`[${sec.section_title}]`);
    for (const a of sec.answers) {
      if (a.is_answered) lines.push(`  ${a.question_id}: ${a.normalized_string}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Chart note ─────────────────────────────────────────────────────────────

function buildChartNote(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): string {
  const lines: string[] = [
    "CLINICAL NOTE — Rabies PEP Intake",
    "⚠ Decision logic pending — not a final recommendation",
    "",
    `Intake Date: ${payload.created_at}`,
    `Completion: ${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count} questions answered`,
    "",
  ];

  // Key findings from derived facts
  if (payload.derived_facts.length > 0) {
    lines.push("Key Findings:");
    for (const df of payload.derived_facts) {
      lines.push(`  • ${df.derivation}: ${JSON.stringify(df.value)}`);
    }
    lines.push("");
  }

  if (assessment.risk_signals.length > 0) {
    lines.push("Risk Signals:");
    for (const sig of assessment.risk_signals) {
      lines.push(`  ⚠ ${sig}`);
    }
    lines.push("");
  }

  lines.push(`Assessment Status: ${assessment.status}`);
  lines.push(`Recommendation: ${assessment.recommendation_code}`);
  lines.push("");
  lines.push("Note: Final clinical recommendation pending canonical flow integration.");

  return lines.join("\n");
}

// ── FHIR Encounter ─────────────────────────────────────────────────────────
// Target: POST /fhir/Encounter on OpenEMR

function buildEncounter(
  patientUuid: string,
  encounterUuid: string,
  payload: CanonicalCasePayload,
): Record<string, unknown> {
  return {
    resourceType: "Encounter",
    id: encounterUuid,
    status: "in-progress",
    class: {
      system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      code: "AMB",
      display: "ambulatory",
    },
    type: [
      {
        coding: [
          {
            system: "urn:rade:encounter-type",
            code: "rabies-pep-intake",
            display: "Rabies Post-Exposure Prophylaxis Intake",
          },
        ],
      },
    ],
    subject: { reference: `Patient/${patientUuid}` },
    period: { start: payload.created_at },
    reasonCode: [
      { text: "Rabies post-exposure prophylaxis evaluation" },
    ],
  };
}

// ── FHIR QuestionnaireResponse ─────────────────────────────────────────────
// Target: POST /fhir/QuestionnaireResponse on OpenEMR

function buildQR(
  payload: CanonicalCasePayload,
  patientUuid: string,
  encounterUuid: string,
): Record<string, unknown> {
  const items: Array<Record<string, unknown>> = [];

  for (const sec of payload.sections) {
    for (const a of sec.answers) {
      if (!a.is_answered) continue;
      items.push({
        linkId: a.question_id,
        answer: [answerToFhir(a)],
      });
    }
  }

  return {
    resourceType: "QuestionnaireResponse",
    status: "completed",
    questionnaire: `Questionnaire/rade-rabies-intake-${payload.schema_id}`,
    subject: { reference: `Patient/${patientUuid}` },
    encounter: { reference: `Encounter/${encounterUuid}` },
    authored: payload.created_at,
    item: items,
  };
}

// ── FHIR Observations (denormalized key fields) ───────────────────────────
// Target: POST /fhir/Observation on OpenEMR — makes key fields queryable

function buildObservations(
  payload: CanonicalCasePayload,
  patientUuid: string,
  encounterUuid: string,
): Array<Record<string, unknown>> {
  return payload.derived_facts.map((df, idx) => ({
    resourceType: "Observation",
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
    subject: { reference: `Patient/${patientUuid}` },
    encounter: { reference: `Encounter/${encounterUuid}` },
    ...(typeof df.value === "boolean" ? { valueBoolean: df.value } : {}),
    ...(typeof df.value === "string" ? { valueString: df.value } : {}),
    effectiveDateTime: payload.created_at,
  }));
}

// ── Answer → FHIR helper ──────────────────────────────────────────────────

function answerToFhir(
  a: { raw_value: { kind: string; value?: string; values?: string[] }; normalized_string: string },
): Record<string, unknown> {
  const v = a.raw_value;
  if (v.kind === "datetime" && v.value) return { valueDateTime: v.value };
  if (v.kind === "binary" || v.kind === "ternary" || v.kind === "enum" || v.kind === "count_enum") {
    return { valueCoding: { code: v.value, display: v.value } };
  }
  return { valueString: a.normalized_string };
}

// ---------------------------------------------------------------------------
// OpenEMR Standard API payloads
//
// Maps canonical intake payload into payloads accepted by the OpenEMR
// Standard REST API:
//   - POST /api/patient/:puuid/encounter
//   - POST /api/patient/:puuid/encounter/:euuid/vital
// ---------------------------------------------------------------------------

export type StandardApiEncounterPayload = {
  date: string;
  onset_date: string;
  reason: string;
  class_code: string;
  pc_catid: string;
  facility_id: string;
  billing_facility: string;
  sensitivity: string;
  provider_id: string;
};

export type StandardApiVitalsPayload = {
  note: string;
  [key: string]: string;
};

export type OpenEmrStandardApiOutput = {
  encounter_create: StandardApiEncounterPayload;
  vitals_create: StandardApiVitalsPayload;
};

export function buildStandardApiPayload(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): OpenEmrStandardApiOutput {
  const today = new Date().toISOString().slice(0, 10);

  const reason = [
    `Rabies PEP Intake Assessment`,
    `Recommendation: ${assessment.recommendation_code}`,
    `Status: ${assessment.status}`,
    `${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count} questions answered`,
  ].join(" — ");

  const noteLines: string[] = [
    "RaDE Rabies PEP Intake — Structured Assessment",
    `Date: ${payload.created_at}`,
    `Recommendation: ${assessment.recommendation_code}`,
    `Status: ${assessment.status}`,
    "",
  ];

  if (assessment.risk_signals.length > 0) {
    noteLines.push("Risk Signals:");
    for (const sig of assessment.risk_signals) {
      noteLines.push(`  - ${sig}`);
    }
    noteLines.push("");
  }

  if (payload.derived_facts.length > 0) {
    noteLines.push("Derived Facts:");
    for (const df of payload.derived_facts) {
      noteLines.push(`  - ${df.derivation}: ${JSON.stringify(df.value)}`);
    }
    noteLines.push("");
  }

  for (const sec of payload.sections) {
    if (sec.answered_count === 0) continue;
    noteLines.push(`[${sec.section_title}]`);
    for (const a of sec.answers) {
      if (a.is_answered) {
        noteLines.push(`  ${a.question_id}: ${a.normalized_string}`);
      }
    }
    noteLines.push("");
  }

  return {
    encounter_create: {
      date: today,
      onset_date: today,
      reason,
      class_code: "AMB",
      pc_catid: "5",
      facility_id: "3",
      billing_facility: "3",
      sensitivity: "normal",
      provider_id: "1",
    },
    vitals_create: {
      note: noteLines.join("\n"),
    },
  };
}
