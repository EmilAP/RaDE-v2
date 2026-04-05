// ---------------------------------------------------------------------------
// rade-v2 — All domain types
// ---------------------------------------------------------------------------

// ── Input ──────────────────────────────────────────────────────────────────

export type AssessmentInput = {
  country: string;
  subnational_unit: string;
  bat_involved: "yes" | "no" | "unsure";
  is_mammal?: boolean;
  relevant_exposure?: boolean;
  animal_available?: boolean;
  host_taxon_id?: string;
  bat_contact_ruled_out?: boolean;
  patient_age_years?: number;
  exposure_date?: string;
};

// ── Catalog data ───────────────────────────────────────────────────────────

export type RiskTier =
  | "negligible"
  | "low"
  | "moderate"
  | "high"
  | "indeterminate";

export type TriggerWeight = "weak" | "moderate" | "strong" | "context_dependent";
export type Confidence = "low" | "medium" | "high";

export type HostProfile = {
  host_taxon_id: string;
  epi_zone_id: string;
  risk_tier: RiskTier;
  pep_trigger_weight: TriggerWeight;
  confidence: Confidence;
  role: string;
};

export type ZoneMapping = {
  country: string;
  subnational_unit: string; // "*" = wildcard
  epi_zone_id: string;
};

export type ZonePolicy = {
  epi_zone_id: string;
  rabies_testing_reliability: Confidence;
  animal_observation_reliability: Confidence;
  bat_policy_supersedes: boolean;
};

export type RecommendationClassDef = {
  id: string;
  rank: number;
  label: string;
  patient_label: string;
  requires_escalation: boolean;
};

// ── Engine output ──────────────────────────────────────────────────────────

export type EngineResult = {
  decision_id: string;
  timestamp: string;
  recommendation_class_id: string;
  risk_tier: RiskTier;
  epi_zone_id: string;
  host_profile?: HostProfile;
  triggered_rules: string[];
  confidence_flags: string[];
  key_drivers: string[];
  audit_trail: string[];
};

// ── Assessment ─────────────────────────────────────────────────────────────

export type RecommendationCategory =
  | "no_action"
  | "observe_or_test"
  | "prophylaxis"
  | "expert_review";

export type Urgency = "routine" | "important" | "urgent";

export type FollowUpTask = {
  task_id: string;
  label: string;
  priority: Urgency;
  task_type: string;
};

export type Assessment = {
  assessment_id: string;
  case_id: string;
  timestamp: string;
  recommendation: {
    category: RecommendationCategory;
    label: string;
    requires_public_health: boolean;
    requires_escalation: boolean;
    raw_class_id: string;
  };
  risk_snapshot: {
    overall_risk_tier: RiskTier;
    confidence: string;
  };
  rationale: {
    summary: string;
    lines: string[];
  };
  key_factors: string[];
  follow_up_tasks: FollowUpTask[];
  provenance: {
    engine_version: string;
    decision_id: string;
    timestamp: string;
  };
};

// ── Case ───────────────────────────────────────────────────────────────────

export type ClinicalCase = {
  case_id: string;
  created_at: string;
  patient: { age_years?: number };
  exposure: {
    country: string;
    subnational_unit: string;
    animal_type?: string;
    bat_involved?: string;
    relevant_exposure?: boolean;
    exposure_date?: string;
  };
  animal_investigation: { animal_available?: boolean };
};

// ── Envelope ───────────────────────────────────────────────────────────────

export type WorkflowStatus =
  | "intake"
  | "assessed"
  | "action_required"
  | "completed";

export type CaseEnvelope = {
  envelope_id: string;
  schema_version: "0.1.0";
  module_id: "rabies";
  created_at: string;
  updated_at: string;
  case: ClinicalCase;
  assessment?: Assessment;
  status: WorkflowStatus;
};

// ── Clinician renderer output ──────────────────────────────────────────────

export type ClinicianSummary = {
  recommendation_category: RecommendationCategory;
  risk_tier: RiskTier;
  urgency: Urgency;
  requires_public_health: boolean;
  key_factors: string[];
  action_items: string[];
};

// ── FHIR output ────────────────────────────────────────────────────────────

export type FhirResource = {
  resourceType: string;
  id: string;
  [key: string]: unknown;
};

export type FhirBundleEntry = {
  fullUrl: string;
  resource: FhirResource;
};

export type FhirBundle = {
  resourceType: "Bundle";
  type: "collection";
  id: string;
  timestamp: string;
  entry: FhirBundleEntry[];
};

export type CdsCard = {
  summary: string;
  detail: string;
  indicator: "info" | "warning" | "critical";
  source: { label: string };
};
