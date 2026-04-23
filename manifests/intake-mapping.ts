// ---------------------------------------------------------------------------
// rade-v2 — Mapping manifests
//
// Machine-readable manifests showing how each canonical intake question
// maps to payload fields, renderer usage, and platform adapter usage.
// ---------------------------------------------------------------------------

import type { Questionnaire, QuestionMeta } from "../intake/questionnaire.js";
import { buildQuestionnaire } from "../intake/questionnaire.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type IntakeToPayloadMapping = {
  canonical_question_id: string;
  section: string;
  classification: string;
  origin: string;
  payload_field: string;
  derived_fact_id: string | null;
  notes: string;
};

export type IntakeToRendererMapping = {
  canonical_question_id: string;
  section: string;
  classification: string;
  origin: string;
  clinician_renderer: string;
  public_health_renderer: string;
  patient_renderer: string;
  notes: string;
};

export type IntakeToPlatformMapping = {
  canonical_question_id: string;
  section: string;
  classification: string;
  origin: string;
  epic_fhir: string;
  openemr: string;
  sormas: string;
  dhis2: string;
  notes: string;
};

export type MappingManifest = {
  generated_at: string;
  schema_id: string;
  question_count: number;
  intake_to_payload: IntakeToPayloadMapping[];
  intake_to_renderer: IntakeToRendererMapping[];
  intake_to_platform: IntakeToPlatformMapping[];
};

// ── Derived fact mapping (question → derived fact id) ──────────────────────

const DERIVED_FACT_MAP: Record<string, string> = {
  c04: "df_is_mammal, df_bat_involved",
  c05: "df_bat_contact_ruled_out",
  c12: "df_has_relevant_exposure",
  c15: "df_high_priority_victim",
  c16: "df_high_priority_victim",
  c25: "df_animal_available",
  c29: "df_prior_vaccination",
  c37: "df_immunocompromised",
};

// ── Renderer usage markers ─────────────────────────────────────────────────
// These indicate which renderers consume each question's answer.

const CLINICIAN_USED = new Set([
  // All questions appear in clinician note section summaries
]);

const PH_EXPLICIT: Record<string, string> = {
  c01: "follow_up_fields.patient_started_pep",
  c02: "exposure_summary.exposure_date",
  c03: "exposure_summary.geographic_location",
  c04: "animal_summary.animal_type",
  c12: "exposure_summary.exposure_characteristics",
  c13: "exposure_summary.wound_site",
  c14: "animal_summary.animal_alive",
  c15: "follow_up_fields.high_priority_victim",
  c16: "follow_up_fields.high_priority_victim",
  c17: "exposure_summary.wound_washing_performed",
  c18: "animal_summary.animal_rabies_signs",
  c21: "animal_summary.animal_feral_or_wild",
  c22: "animal_summary.animal_stray",
  c23: "animal_summary.animal_tested",
  c24: "animal_summary.test_result",
  c25: "animal_summary.animal_available",
  c26: "animal_summary.animal_vaccinated",
  c29: "policy_fields.prior_vaccination",
  c30: "policy_fields.recent_pep",
  c37: "policy_fields.patient_immunocompromised",
  c44: "policy_fields.rig_availability_limited",
};

// ── SORMAS-explicit field usage ────────────────────────────────────────────

const SORMAS_EXPLICIT: Record<string, string> = {
  c02: "epiData.exposures[0].exposureDate",
  c03: "responsibleRegion (mapped), epiData description",
  c04: "externalData.animal_detail.animal_type",
  c14: "externalData.animal_detail.animal_alive",
  c18: "externalData.animal_detail.rabies_signs",
  c21: "externalData.animal_detail.feral_or_wild",
  c22: "externalData.animal_detail.stray",
  c23: "externalData.animal_detail.animal_tested",
  c24: "externalData.animal_detail.test_result",
  c25: "externalData.animal_detail.animal_available",
  c26: "externalData.animal_detail.animal_vaccinated",
};

// ── Builder ────────────────────────────────────────────────────────────────

export function generateMappingManifest(
  questionnaire?: Questionnaire,
): MappingManifest {
  const q = questionnaire ?? buildQuestionnaire();

  const payloadMappings = q.questions.map(buildPayloadMapping);
  const rendererMappings = q.questions.map(buildRendererMapping);
  const platformMappings = q.questions.map(buildPlatformMapping);

  return {
    generated_at: new Date().toISOString(),
    schema_id: q.schema_id,
    question_count: q.questions.length,
    intake_to_payload: payloadMappings,
    intake_to_renderer: rendererMappings,
    intake_to_platform: platformMappings,
  };
}

// ── Per-question mappers ───────────────────────────────────────────────────

function buildPayloadMapping(q: QuestionMeta): IntakeToPayloadMapping {
  const dfId = DERIVED_FACT_MAP[q.id] ?? null;
  return {
    canonical_question_id: q.id,
    section: q.section_id,
    classification: q.classification,
    origin: q.origin,
    payload_field: `sections.${q.section_id}.answers[${q.id}]`,
    derived_fact_id: dfId,
    notes: dfId
      ? `Feeds derived fact(s): ${dfId}`
      : "Stored in payload; awaits canonical flow for derived logic",
  };
}

function buildRendererMapping(q: QuestionMeta): IntakeToRendererMapping {
  const phField = PH_EXPLICIT[q.id];
  return {
    canonical_question_id: q.id,
    section: q.section_id,
    classification: q.classification,
    origin: q.origin,
    clinician_renderer: "section_summary (all questions)",
    public_health_renderer: phField ?? "not explicitly mapped",
    patient_renderer: "section_count_only",
    notes: phField
      ? `PH renderer: ${phField}`
      : "TODO: May be consumed by future flow-driven renderers",
  };
}

function buildPlatformMapping(q: QuestionMeta): IntakeToPlatformMapping {
  const sormasField = SORMAS_EXPLICIT[q.id];
  return {
    canonical_question_id: q.id,
    section: q.section_id,
    classification: q.classification,
    origin: q.origin,
    epic_fhir: `QuestionnaireResponse.item[linkId=${q.id}]`,
    openemr: `QuestionnaireResponse.item[linkId=${q.id}]`,
    sormas: sormasField ?? "additionalDetails / externalData (generic)",
    dhis2: `Event.dataValues[de-${q.id}]`,
    notes: sormasField
      ? `SORMAS explicit: ${sormasField}`
      : "Generic payload field; platform-specific mapping pending",
  };
}
