// ---------------------------------------------------------------------------
// rade-v2 — Consult relay domain contracts
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload } from "../../intake/payload.js";
import type { AnswerValue } from "../../intake/answers.js";
import type { ConsultState } from "./state.js";

export type ActorRole =
  | "clinician_submitter"
  | "ph_reviewer"
  | "ph_supervisor"
  | "system";

export type ActorRef = {
  actor_id: string;
  role: ActorRole;
  display_name: string;
  organization_id?: string;
};

export const SYSTEM_ACTOR: ActorRef = {
  actor_id: "rade-system",
  role: "system",
  display_name: "RaDE System",
};

export type AutomationMode = "PH_REQUIRED" | "PH_OPTIONAL" | "AUTO_ALLOWED";

export type ProvenanceConfidence = "low" | "medium" | "high";

export type ProvenanceStatus = "confirmed" | "unconfirmed" | "missing";

export type SourceModality = "dictated" | "typed" | "clicked" | "inferred";

export type ProvenancedAnswer = {
  value: AnswerValue;
  source_modality: SourceModality;
  confidence: ProvenanceConfidence;
  status: ProvenanceStatus;
  captured_by: ActorRef;
  captured_at: string;
  last_confirmed_by?: ActorRef;
  last_confirmed_at?: string;
};

export type EngineDecisionStatus =
  | "not_implemented"
  | "advisory_only"
  | "partial_rules_applied";

export type EngineDecision = {
  decision_id: string;
  recorded_at: string;
  status: EngineDecisionStatus;
  advisory_summary: string;
  missing_critical_fields: string[];
  triggered_rules: string[];
};

export type ConsultBody = {
  schema_id: string;
  payload: CanonicalCasePayload;
  submitted_answers: Record<string, ProvenancedAnswer>;
  narrative_input?: string;
};

export type ClarificationRequest = {
  clarification_id: string;
  consult_id: string;
  requested_by: ActorRef;
  requested_at: string;
  target_question_ids: string[];
  freeform_question?: string;
  due_by?: string;
  resolver_snapshot: {
    missing_field_ids: string[];
    clarification_targets: string[];
    blocking_reasons: string[];
  };
};

export type ClarificationResponse = {
  response_id: string;
  clarification_id: string;
  responded_by: ActorRef;
  responded_at: string;
  answer_patches: Record<string, ProvenancedAnswer>;
  narrative_update?: string;
  idempotency_key: string;
};

export type ClarificationThread = {
  request: ClarificationRequest;
  response?: ClarificationResponse;
};

export type ConsultCorrection = {
  correction_id: string;
  corrected_by: ActorRef;
  corrected_at: string;
  answer_patches: Record<string, ProvenancedAnswer>;
  narrative_update?: string;
  note?: string;
  idempotency_key: string;
};

export type ConsultRecommendationCategory =
  | "no_action"
  | "observe_or_test"
  | "prophylaxis"
  | "expert_review"
  | "custom";

export type ConsultUrgency = "routine" | "important" | "urgent";

export type ConsultFollowUpTask = {
  task_id: string;
  label: string;
  priority: ConsultUrgency;
  task_type: string;
};

export type ConsultRecommendation = {
  recommendation_id: string;
  consult_id: string;
  authored_by: ActorRef;
  authored_at: string;
  returned_by?: ActorRef;
  returned_to_clinician_at?: string;
  acknowledged_by?: ActorRef;
  acknowledged_at?: string;
  category: ConsultRecommendationCategory;
  label: string;
  rationale: string;
  urgency: ConsultUrgency;
  follow_up_tasks: ConsultFollowUpTask[];
  escalation_required: boolean;
  signed_at: string;
  engine_decision_ref?: string;
  policy_overlays_applied: string[];
};

export type EscalationEvent = {
  escalation_id: string;
  requested_by: ActorRef;
  requested_at: string;
  reason: string;
};

export type CanonicalConsult = {
  consult_id: string;
  created_at: string;
  updated_at: string;
  module_id: "rabies";
  schema_version: string;
  automation_mode: AutomationMode;
  parties: {
    submitter: ActorRef;
    reviewer?: ActorRef;
    supervisor?: ActorRef;
  };
  body: ConsultBody;
  engine_decisions: EngineDecision[];
  clarifications: ClarificationThread[];
  corrections?: ConsultCorrection[];
  recommendation?: ConsultRecommendation;
  escalation_events: EscalationEvent[];
  current_state: ConsultState;
};

export type ArtifactBundle = {
  bundle_id: string;
  consult_id: string;
  generated_at: string;
  artifacts: Record<string, ConsultArtifact>;
};

export type ConsultArtifact = {
  artifact_name: string;
  content_type: string;
  format: "text" | "json";
  generated_at: string;
  body: unknown;
};

export type SubmitConsultCommand = {
  idempotency_key: string;
  consult_id?: string;
  submitter: ActorRef;
  submitted_answers: Record<string, ProvenancedAnswer>;
  narrative_input?: string;
  automation_mode?: AutomationMode;
  engine_decision?: EngineDecision;
};

export type RequestClarificationCommand = {
  idempotency_key: string;
  consult_id: string;
  requested_by: ActorRef;
  target_question_ids?: string[];
  freeform_question?: string;
  due_by?: string;
};

export type ProvideClarificationCommand = {
  idempotency_key: string;
  consult_id: string;
  clarification_id: string;
  responded_by: ActorRef;
  answer_patches: Record<string, ProvenancedAnswer>;
  narrative_update?: string;
};

export type CorrectConsultFactsCommand = {
  idempotency_key: string;
  consult_id: string;
  corrected_by: ActorRef;
  answer_patches: Record<string, ProvenancedAnswer>;
  narrative_update?: string;
  note?: string;
};

export type AuthorRecommendationCommand = {
  idempotency_key: string;
  consult_id: string;
  authored_by: ActorRef;
  category: ConsultRecommendationCategory;
  label: string;
  rationale: string;
  urgency: ConsultUrgency;
  follow_up_tasks?: ConsultFollowUpTask[];
  escalation_required?: boolean;
  policy_overlays_applied?: string[];
};

export type ReturnRecommendationCommand = {
  idempotency_key: string;
  consult_id: string;
  returned_by: ActorRef;
};

export type AcknowledgeRecommendationCommand = {
  idempotency_key: string;
  consult_id: string;
  acknowledged_by: ActorRef;
};

export function createInterimEngineDecision(input: {
  missing_critical_fields: string[];
  summary?: string;
  status?: EngineDecisionStatus;
}): EngineDecision {
  const now = new Date().toISOString();
  return {
    decision_id: `engine_stub_${Date.now()}`,
    recorded_at: now,
    status: input.status ?? "not_implemented",
    advisory_summary: input.summary ?? "PH review required",
    missing_critical_fields: input.missing_critical_fields,
    triggered_rules: [],
  };
}