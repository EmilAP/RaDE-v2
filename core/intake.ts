// ---------------------------------------------------------------------------
// rade-v2 — Intake wiring layer
//
// Maps flat checklist answers (keyed by canonical question ID) to the
// structured AssessmentInput consumed by the engine. Handles redundant
// questions, derived values, and normalisation.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssessmentInput } from "./types";

// ── Types ──────────────────────────────────────────────────────────────────

/** Flat dictionary: canonical question ID → answer value. */
export type IntakeAnswers = Record<
  string,
  string | string[] | undefined
>;

/** Minimal checklist shape for validation / reference. */
export type CanonicalChecklist = {
  schema_id: string;
  questions: Array<{
    id: string;
    text: string;
    type: string;
    response_type: string;
    origin: string;
    source_map: { who_ids: string[]; oph_ids: string[] };
  }>;
};

// ── Checklist loader ───────────────────────────────────────────────────────

const CHECKLIST_FILE = "canonical_rabies_intake_v1.json";

let _cached: CanonicalChecklist | undefined;

export function loadChecklist(): CanonicalChecklist {
  if (_cached) return _cached;
  const here = dirname(fileURLToPath(import.meta.url));
  const filePath = resolve(here, "..", "data", "canonical", CHECKLIST_FILE);
  _cached = JSON.parse(readFileSync(filePath, "utf-8")) as CanonicalChecklist;
  return _cached;
}

// ── Answer accessors ───────────────────────────────────────────────────────

function yn(answers: IntakeAnswers, id: string): boolean | undefined {
  const v = answers[id];
  if (v === "yes") return true;
  if (v === "no") return false;
  return undefined;
}

function str(answers: IntakeAnswers, id: string): string | undefined {
  const v = answers[id];
  return typeof v === "string" ? v : undefined;
}

function arr(answers: IntakeAnswers, id: string): string[] {
  const v = answers[id];
  return Array.isArray(v) ? v : [];
}

// ── Taxon normalisation ────────────────────────────────────────────────────

const MAMMAL_TYPE_TO_TAXON: Record<string, string | undefined> = {
  dog: "dog",
  cat: "cat",
  bat: "bat",
  raccoon: "raccoon",
  skunk: "skunk",
  fox: "fox",
  coyote: "fox",                 // closest catalog match
  livestock: "dog",              // domestic-exposure-relevant tier
  rodent: "small_rodent",
  rabbit_hare: "small_rodent",
  other_mammal: undefined,
  unknown: undefined,
};

// ── Mapping function ───────────────────────────────────────────────────────
//
// Canonical question → engine input field map:
//
//   c03  (geo location, "CA/ON")      → country, subnational_unit
//   c04  (is mammal) [merged]         → is_mammal
//   c05  (is rodent)                  → host_taxon_id = "small_rodent"
//   c06  (was bat)                    → bat_involved
//   c07  (mammal type enum)           → host_taxon_id
//   c08  (bat contact ruled out)      → bat_contact_ruled_out
//   c11  (history suggestive of bat)  → bat_involved = "unsure"
//   c15  (exposure type multiselect)  → relevant_exposure
//   c16  (WHO wound category)         → relevant_exposure (derived)
//   c19  (animal still alive)         → (cross-check)
//   c31  (animal available) [merged]  → animal_available
//   c02  (exposure date)              → exposure_date
// ---------------------------------------------------------------------------

export function mapAnswersToEngineInput(
  answers: IntakeAnswers,
): AssessmentInput {
  // ── Geography (c03) ────────────────────────────────────────────────────
  // Expected format: "COUNTRY/SUBNATIONAL_UNIT" e.g. "CA/ON"
  let country = "CA";
  let subnationalUnit = "ON";
  const geo = str(answers, "c03");
  if (geo) {
    const parts = geo.split("/").map((s) => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      country = parts[0];
      subnationalUnit = parts[1];
    }
  }

  // ── Species & host taxon ───────────────────────────────────────────────
  const isMammal = yn(answers, "c04");           // merged: WHO q01 + OPH q10
  const isRodent = yn(answers, "c05");            // WHO q02
  const isBatDirect = yn(answers, "c06");         // OPH q02
  const mammalType = str(answers, "c07");         // OPH q13

  // Derive host_taxon_id: explicit mammal type → rodent fallback → bat fallback
  let hostTaxonId: string | undefined;
  if (mammalType) {
    hostTaxonId = MAMMAL_TYPE_TO_TAXON[mammalType];
  }
  if (!hostTaxonId && isRodent === true) {
    hostTaxonId = "small_rodent";
  }
  if (!hostTaxonId && isBatDirect === true) {
    hostTaxonId = "bat";
  }

  // ── Bat pathway ────────────────────────────────────────────────────────
  const batHistorySuggestive = yn(answers, "c11"); // OPH q06

  let batInvolved: "yes" | "no" | "unsure";
  if (isBatDirect === true || mammalType === "bat") {
    batInvolved = "yes";
  } else if (batHistorySuggestive === true) {
    batInvolved = "unsure";
  } else if (isBatDirect === false) {
    batInvolved = "no";
  } else {
    batInvolved = "no";
  }

  // c08: "Can bat saliva exposure be ruled out?" yes → contact ruled out
  const batContactRuledOut = yn(answers, "c08");

  // ── Relevant exposure (c15 multiselect + c16 WHO category) ─────────────
  const exposureItems = arr(answers, "c15");      // OPH q11
  const whoCategory = str(answers, "c16");        // WHO q17

  let relevantExposure: boolean | undefined;
  if (exposureItems.length > 0) {
    relevantExposure = true;
  } else if (
    whoCategory === "category_II" ||
    whoCategory === "category_III"
  ) {
    relevantExposure = true;
  } else if (whoCategory === "category_I") {
    relevantExposure = false;
  }

  // ── Animal availability (c31 = merged: WHO q13 + OPH q12) ─────────────
  const animalAvailable = yn(answers, "c31");

  // ── Exposure date (c02) ────────────────────────────────────────────────
  const exposureDate = str(answers, "c02");

  return {
    country,
    subnational_unit: subnationalUnit,
    bat_involved: batInvolved,
    is_mammal: isMammal,
    relevant_exposure: relevantExposure,
    animal_available: animalAvailable,
    host_taxon_id: hostTaxonId,
    bat_contact_ruled_out: batContactRuledOut,
    exposure_date: exposureDate,
  };
}
