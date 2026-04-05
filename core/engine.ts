// ---------------------------------------------------------------------------
// rade-v2 — Rabies decision engine
//
// Simplified implementation of the rabies exposure risk assessment.
// Resolves geography → host risk → policy, then evaluates clinical rules
// in priority order. Each rule is a direct conditional matching the original
// dynamic_resolution_rules but expressed as clean TypeScript.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  AssessmentInput,
  EngineResult,
  HostProfile,
  RiskTier,
  ZonePolicy,
} from "./types";
import { resolveZone, resolveHost, resolvePolicy } from "./catalog";

export function runEngine(input: AssessmentInput): EngineResult {
  const audit: string[] = [];
  const drivers: string[] = [];
  const flags: string[] = [];
  const triggered: string[] = [];
  const decisionId = randomUUID();
  const timestamp = new Date().toISOString();

  // ── 1. Resolve geography ────────────────────────────────────────────────
  const epiZone = resolveZone(input.country, input.subnational_unit);
  audit.push(`Zone: ${epiZone} (${input.country}/${input.subnational_unit})`);

  // ── 2. Early exits ──────────────────────────────────────────────────────
  // Rule priority 120: non-mammal or no relevant exposure → no PEP
  if (input.is_mammal === false) {
    triggered.push("non_mammal_exit");
    audit.push("Non-mammal exposure: PEP not indicated");
    drivers.push("non_mammal");
    return result({ decisionId, timestamp, epiZone, rec: "no_pep_likely", risk: "negligible", audit, drivers, flags, triggered });
  }

  if (input.relevant_exposure === false) {
    triggered.push("no_exposure_exit");
    audit.push("No relevant exposure identified");
    drivers.push("no_relevant_exposure");
    return result({ decisionId, timestamp, epiZone, rec: "no_pep_likely", risk: "negligible", audit, drivers, flags, triggered });
  }

  // ── 3. Resolve host risk ────────────────────────────────────────────────
  const isBat = input.bat_involved === "yes" || input.bat_involved === "unsure";
  const effectiveHostTaxon = input.host_taxon_id ?? (isBat ? "bat" : undefined);
  const host = effectiveHostTaxon
    ? resolveHost(epiZone, effectiveHostTaxon)
    : undefined;

  if (host) {
    drivers.push(`host_risk_tier_${host.risk_tier}`);
    audit.push(
      `Host ${host.host_taxon_id}: risk=${host.risk_tier}, trigger=${host.pep_trigger_weight}, confidence=${host.confidence}`,
    );
  } else if (effectiveHostTaxon) {
    flags.push("unknown_host_profile");
    audit.push(`Host ${effectiveHostTaxon}: no profile found in zone ${epiZone}`);
  }

  // ── 4. Resolve zone policy ──────────────────────────────────────────────
  const policy = resolvePolicy(epiZone);
  if (policy) {
    audit.push(
      `Policy: testing=${policy.rabies_testing_reliability}, bat_supersedes=${policy.bat_policy_supersedes}`,
    );
  }

  // ── 5. Conflict detection ───────────────────────────────────────────────
  const hasConflict =
    (effectiveHostTaxon !== undefined && !host) ||
    host?.confidence === "low";
  if (hasConflict) flags.push("low_confidence_or_conflict");

  // ── 6. Rule evaluation (priority descending) ────────────────────────────

  // Priority 110: low confidence / conflict → expert review
  // (evaluated later — only fires if no higher-priority rule stops first)

  // Priority 108: bat contact ruled out → no PEP
  if (isBat && input.bat_contact_ruled_out === true) {
    triggered.push("bat_contact_ruled_out");
    audit.push("Bat contact ruled out: PEP not indicated");
    return result({ decisionId, timestamp, epiZone, host, rec: "no_pep_likely", risk: host?.risk_tier ?? "indeterminate", audit, drivers, flags, triggered });
  }

  // Priority 105: bat + policy supersedes → PEP
  if (isBat && input.bat_contact_ruled_out !== true && policy?.bat_policy_supersedes) {
    triggered.push("bat_policy_supersedes");
    drivers.push("bat_pathway_signal");
    audit.push("Jurisdictional bat policy: PEP recommended regardless of bat availability");
    return result({ decisionId, timestamp, epiZone, host, rec: "pep_recommended", risk: host?.risk_tier ?? "high", audit, drivers, flags, triggered });
  }

  // Priority 102: bat available + reliable testing → observe/test
  if (
    isBat &&
    input.animal_available === true &&
    policy &&
    (policy.rabies_testing_reliability === "high" ||
      policy.rabies_testing_reliability === "medium")
  ) {
    triggered.push("bat_testing_pathway");
    drivers.push("bat_pathway_signal");
    audit.push("Bat available for testing with reliable infrastructure");
    return result({ decisionId, timestamp, epiZone, host, rec: "observe_or_test_pathway", risk: host?.risk_tier ?? "high", audit, drivers, flags, triggered });
  }

  // Priority 100: strong trigger + animal unavailable → PEP
  if (host?.pep_trigger_weight === "strong" && input.animal_available === false) {
    triggered.push("strong_trigger_unavailable");
    drivers.push("animal_unavailable_strong_trigger");
    audit.push(`Strong trigger host (${host.host_taxon_id}) unavailable: PEP recommended`);
    return result({ decisionId, timestamp, epiZone, host, rec: "pep_recommended", risk: host.risk_tier, audit, drivers, flags, triggered });
  }

  // Priority 90: negligible risk + no conflict → no PEP
  if (host?.risk_tier === "negligible" && !hasConflict) {
    triggered.push("negligible_no_conflict");
    audit.push(`Negligible host risk (${host.host_taxon_id}) with no conflicting data`);
    return result({ decisionId, timestamp, epiZone, host, rec: "no_pep_likely", risk: "negligible", audit, drivers, flags, triggered });
  }

  // Priority 80: animal available → observe/test
  if (input.animal_available === true) {
    triggered.push("animal_available_observe");
    drivers.push("animal_available");
    audit.push("Animal available for observation/testing");
    return result({ decisionId, timestamp, epiZone, host, rec: "observe_or_test_pathway", risk: host?.risk_tier ?? "indeterminate", audit, drivers, flags, triggered });
  }

  // Priority 70: strong trigger → PEP
  if (host?.pep_trigger_weight === "strong") {
    triggered.push("strong_trigger_default");
    drivers.push("host_profile_strong_trigger");
    audit.push(`Strong trigger host (${host.host_taxon_id}): PEP recommended`);
    return result({ decisionId, timestamp, epiZone, host, rec: "pep_recommended", risk: host.risk_tier, audit, drivers, flags, triggered });
  }

  // Priority 110 (deferred): conflict escalation → expert review
  if (hasConflict) {
    triggered.push("conflict_escalation");
    audit.push("Insufficient data or conflicting signals: expert review recommended");
    return result({ decisionId, timestamp, epiZone, host, rec: "urgent_local_expert_review", risk: host?.risk_tier ?? "indeterminate", audit, drivers, flags, triggered });
  }

  // ── 7. Default: observe/test ────────────────────────────────────────────
  triggered.push("default_observe_or_test");
  audit.push("Default pathway: observe or test");
  return result({ decisionId, timestamp, epiZone, host, rec: "observe_or_test_pathway", risk: host?.risk_tier ?? "indeterminate", audit, drivers, flags, triggered });
}

// ── Result builder ─────────────────────────────────────────────────────────

type ResultArgs = {
  decisionId: string;
  timestamp: string;
  epiZone: string;
  host?: HostProfile;
  rec: string;
  risk: RiskTier;
  audit: string[];
  drivers: string[];
  flags: string[];
  triggered: string[];
};

function result(r: ResultArgs): EngineResult {
  return {
    decision_id: r.decisionId,
    timestamp: r.timestamp,
    recommendation_class_id: r.rec,
    risk_tier: r.risk,
    epi_zone_id: r.epiZone,
    host_profile: r.host,
    triggered_rules: r.triggered,
    confidence_flags: r.flags,
    key_drivers: r.drivers,
    audit_trail: r.audit,
  };
}
