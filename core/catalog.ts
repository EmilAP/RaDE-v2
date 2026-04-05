// ---------------------------------------------------------------------------
// rade-v2 — Embedded rabies catalog (North America)
//
// Minimal seed data for the vertical slice. Covers NA wildlife multi-reservoir
// zone with key host profiles, zone policy, and recommendation classes.
// ---------------------------------------------------------------------------

import type {
  HostProfile,
  ZoneMapping,
  ZonePolicy,
  RecommendationClassDef,
} from "./types";

// ── Zone mappings ──────────────────────────────────────────────────────────

export const ZONE_MAPPINGS: ZoneMapping[] = [
  { country: "CA", subnational_unit: "*", epi_zone_id: "na_wildlife_multi_reservoir" },
  { country: "US", subnational_unit: "*", epi_zone_id: "na_wildlife_multi_reservoir" },
];

// ── Host profiles (NA zone) ───────────────────────────────────────────────

export const HOST_PROFILES: HostProfile[] = [
  { host_taxon_id: "raccoon", epi_zone_id: "na_wildlife_multi_reservoir", risk_tier: "moderate", pep_trigger_weight: "moderate", confidence: "high", role: "maintenance_reservoir" },
  { host_taxon_id: "bat",     epi_zone_id: "na_wildlife_multi_reservoir", risk_tier: "high",     pep_trigger_weight: "strong",   confidence: "high", role: "maintenance_reservoir" },
  { host_taxon_id: "skunk",   epi_zone_id: "na_wildlife_multi_reservoir", risk_tier: "high",     pep_trigger_weight: "strong",   confidence: "high", role: "maintenance_reservoir" },
  { host_taxon_id: "fox",     epi_zone_id: "na_wildlife_multi_reservoir", risk_tier: "moderate", pep_trigger_weight: "moderate",  confidence: "high", role: "frequent_spillover" },
  { host_taxon_id: "dog",     epi_zone_id: "na_wildlife_multi_reservoir", risk_tier: "low",      pep_trigger_weight: "moderate",  confidence: "high", role: "domestic_exposure_relevant" },
  { host_taxon_id: "cat",     epi_zone_id: "na_wildlife_multi_reservoir", risk_tier: "low",      pep_trigger_weight: "moderate",  confidence: "medium", role: "domestic_exposure_relevant" },
  { host_taxon_id: "small_rodent", epi_zone_id: "na_wildlife_multi_reservoir", risk_tier: "negligible", pep_trigger_weight: "weak", confidence: "high", role: "negligible_practical_host" },
];

// ── Zone policy ────────────────────────────────────────────────────────────

export const ZONE_POLICIES: ZonePolicy[] = [
  {
    epi_zone_id: "na_wildlife_multi_reservoir",
    rabies_testing_reliability: "high",
    animal_observation_reliability: "high",
    bat_policy_supersedes: true,
  },
];

// ── Recommendation classes (ranked) ────────────────────────────────────────

export const RECOMMENDATION_CLASSES: RecommendationClassDef[] = [
  { id: "no_pep_likely",              rank: 1, label: "No PEP Likely",           patient_label: "Rabies shots likely not needed",          requires_escalation: false },
  { id: "observe_or_test_pathway",    rank: 2, label: "Observe or Test Pathway", patient_label: "Animal observation or testing recommended", requires_escalation: false },
  { id: "pep_recommended",            rank: 3, label: "PEP Recommended",         patient_label: "Rabies treatment recommended",            requires_escalation: true },
  { id: "urgent_local_expert_review", rank: 4, label: "Urgent Expert Review",    patient_label: "Urgent expert consultation needed",       requires_escalation: true },
];

// ── Lookup helpers ─────────────────────────────────────────────────────────

export function resolveZone(country: string, subnational_unit: string): string {
  const explicit = ZONE_MAPPINGS.find(
    (m) => m.country === country && m.subnational_unit === subnational_unit,
  );
  if (explicit) return explicit.epi_zone_id;

  const wildcard = ZONE_MAPPINGS.find(
    (m) => m.country === country && m.subnational_unit === "*",
  );
  if (wildcard) return wildcard.epi_zone_id;

  return ZONE_MAPPINGS[0]?.epi_zone_id ?? "na_wildlife_multi_reservoir";
}

export function resolveHost(
  epi_zone_id: string,
  host_taxon_id: string,
): HostProfile | undefined {
  return HOST_PROFILES.find(
    (p) => p.epi_zone_id === epi_zone_id && p.host_taxon_id === host_taxon_id,
  );
}

export function resolvePolicy(epi_zone_id: string): ZonePolicy | undefined {
  return ZONE_POLICIES.find((p) => p.epi_zone_id === epi_zone_id);
}

export function getRecommendationClass(
  id: string,
): RecommendationClassDef | undefined {
  return RECOMMENDATION_CLASSES.find((r) => r.id === id);
}
