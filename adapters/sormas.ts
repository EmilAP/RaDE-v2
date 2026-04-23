// ---------------------------------------------------------------------------
// rade-v2 — SORMAS adapter scaffold
//
// Maps canonical intake payload + placeholder assessment into a SORMAS
// CaseDataDto-compatible export structure.
//
// Based on SORMAS API analysis:
//   - Disease: RABIES in case classification
//   - EpiData.exposures[] for animal exposure context
//   - additionalDetails / externalData for rabies-specific fields
//   - PathogenTestDto for animal testing results
//
// SORMAS lacks native animal entity, bite categorization, and PEP tracking.
// Rabies-specific data goes into structured additionalDetails.
//
// This is a SCAFFOLD — not a live integration.
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload, NormalizedAnswer } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type SormasOutput = {
  case_data: SormasCaseExport;
  animal_exposure_detail: SormasAnimalExposureDetail;
  public_health_notes: string;
  placeholder_action_status: SormasActionStatus;
};

export type SormasCaseExport = {
  uuid: string;
  disease: string;
  caseClassification: string;
  person: {
    uuid: string;
    note: string;
  };
  reportDate: string;
  responsibleRegion: { uuid: string; note: string };
  responsibleDistrict: { uuid: string; note: string };
  epiData: {
    exposures: SormasExposure[];
    areaInfectedAnimals: string;
    contactWithSourceCaseKnown: string;
  };
  additionalDetails: string;
  externalData: Record<string, unknown>;
};

export type SormasExposure = {
  exposureType: string;
  exposureDate: string | null;
  exposureDetailsKnown: string;
  description: string;
  typeOfPlace: string;
};

export type SormasAnimalExposureDetail = {
  animal_type: string | null;
  animal_alive: string | null;
  animal_available: string | null;
  animal_tested: string | null;
  test_result: string | null;
  rabies_signs: string | null;
  animal_vaccinated: string | null;
  feral_or_wild: string | null;
  stray: string | null;
  bat_involved: boolean;
  note: string;
};

export type SormasActionStatus = {
  status: string;
  recommendation_code: string;
  todo: string[];
};

// ── Builder ────────────────────────────────────────────────────────────────

export function buildSormasOutput(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
): SormasOutput {
  const animalDetail = buildAnimalDetail(payload);
  const caseData = buildCaseData(payload, animalDetail);
  const notes = buildPublicHealthNotes(payload, assessment, animalDetail);
  const actionStatus: SormasActionStatus = {
    status: assessment.status,
    recommendation_code: assessment.recommendation_code,
    todo: [
      "TODO: Map to actual SORMAS region/district UUIDs",
      "TODO: Create person via SORMAS person API first",
      "TODO: Push case via POST /cases/pushWithPerson",
      "TODO: Consider PathogenTestDto for animal testing results",
      "TODO: Replace additionalDetails encoding once SORMAS rabies module exists",
    ],
  };

  return {
    case_data: caseData,
    animal_exposure_detail: animalDetail,
    public_health_notes: notes,
    placeholder_action_status: actionStatus,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────

function ans(payload: CanonicalCasePayload, qId: string): string | null {
  for (const sec of payload.sections) {
    for (const a of sec.answers) {
      if (a.question_id === qId && a.is_answered) return a.normalized_string;
    }
  }
  return null;
}

function factVal(payload: CanonicalCasePayload, factId: string): unknown {
  const df = payload.derived_facts.find((f) => f.fact_id === factId);
  return df?.value ?? null;
}

function buildAnimalDetail(payload: CanonicalCasePayload): SormasAnimalExposureDetail {
  return {
    animal_type: ans(payload, "c04"),
    animal_alive: ans(payload, "c14"),
    animal_available: ans(payload, "c25"),
    animal_tested: ans(payload, "c23"),
    test_result: ans(payload, "c24"),
    rabies_signs: ans(payload, "c18"),
    animal_vaccinated: ans(payload, "c26"),
    feral_or_wild: ans(payload, "c21"),
    stray: ans(payload, "c22"),
    bat_involved: factVal(payload, "df_bat_involved") === true,
    note: "SORMAS lacks native animal entity — this is structured externalData",
  };
}

function buildCaseData(
  payload: CanonicalCasePayload,
  animal: SormasAnimalExposureDetail,
): SormasCaseExport {
  const exposureDate = ans(payload, "c02");
  const location = ans(payload, "c03");
  const animalType = animal.animal_type ?? "unknown";

  const exposureDesc = [
    `Animal: ${animalType}`,
    animal.bat_involved ? "Bat exposure" : "",
    `Location: ${location ?? "not recorded"}`,
    `Signs: ${animal.rabies_signs ?? "not assessed"}`,
  ]
    .filter(Boolean)
    .join("; ");

  return {
    uuid: `rade-case-${payload.payload_id}`,
    disease: "RABIES",
    caseClassification: "SUSPECT",
    person: {
      uuid: "placeholder-person-uuid",
      note: "TODO: Create person in SORMAS first",
    },
    reportDate: payload.created_at,
    responsibleRegion: {
      uuid: "placeholder-region-uuid",
      note: "TODO: Map geographic location to SORMAS region",
    },
    responsibleDistrict: {
      uuid: "placeholder-district-uuid",
      note: "TODO: Map geographic location to SORMAS district",
    },
    epiData: {
      exposures: [
        {
          exposureType: "ANIMAL_CONTACT",
          exposureDate: exposureDate,
          exposureDetailsKnown: "YES",
          description: exposureDesc,
          typeOfPlace: "OTHER",
        },
      ],
      areaInfectedAnimals: "YES",
      contactWithSourceCaseKnown: "NO",
    },
    additionalDetails: [
      `RADE Intake ID: ${payload.payload_id}`,
      `Schema: ${payload.schema_id}`,
      `Animal: ${animalType}`,
      animal.animal_available
        ? `Animal available: ${animal.animal_available}`
        : "",
      animal.test_result ? `Test result: ${animal.test_result}` : "",
      `Answered: ${payload.intake_metadata.answered_count}/${payload.intake_metadata.question_count}`,
    ]
      .filter(Boolean)
      .join(". "),
    externalData: {
      rade_payload_id: payload.payload_id,
      rade_schema_id: payload.schema_id,
      animal_detail: animal,
      derived_facts: payload.derived_facts,
    },
  };
}

function buildPublicHealthNotes(
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
  animal: SormasAnimalExposureDetail,
): string {
  const lines = [
    "SORMAS Public Health Export — Rabies PEP Case",
    `Report Date: ${payload.created_at}`,
    `Classification: SUSPECT`,
    "",
    `Animal: ${animal.animal_type ?? "unknown"}`,
    `Available: ${animal.animal_available ?? "not recorded"}`,
    `Testing: ${animal.animal_tested ?? "not recorded"}`,
    `Result: ${animal.test_result ?? "N/A"}`,
    "",
    `Assessment: ${assessment.recommendation_code}`,
    `Status: ${assessment.status}`,
    "",
    "Note: Decision logic pending. Manual review required.",
  ];
  return lines.join("\n");
}
