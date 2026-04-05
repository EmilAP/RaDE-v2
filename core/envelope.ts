// ---------------------------------------------------------------------------
// rade-v2 — Case envelope: case builder, assessment mapper, envelope factory
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  AssessmentInput,
  Assessment,
  CaseEnvelope,
  ClinicalCase,
  EngineResult,
  FollowUpTask,
  RecommendationCategory,
  Urgency,
  WorkflowStatus,
} from "./types";
import { getRecommendationClass } from "./catalog";

// ── Category normalisation ────────────────────────────────────────────────

const CATEGORY_MAP: Record<string, RecommendationCategory> = {
  no_pep_likely: "no_action",
  observe_or_test_pathway: "observe_or_test",
  pep_recommended: "prophylaxis",
  urgent_local_expert_review: "expert_review",
};

// ── Case builder ──────────────────────────────────────────────────────────

export function buildCase(input: AssessmentInput): ClinicalCase {
  return {
    case_id: randomUUID(),
    created_at: new Date().toISOString(),
    patient: { age_years: input.patient_age_years },
    exposure: {
      country: input.country,
      subnational_unit: input.subnational_unit,
      animal_type: input.host_taxon_id,
      bat_involved: input.bat_involved,
      relevant_exposure: input.relevant_exposure,
      exposure_date: input.exposure_date,
    },
    animal_investigation: { animal_available: input.animal_available },
  };
}

// ── Assessment mapper ─────────────────────────────────────────────────────

export function buildAssessment(
  engineResult: EngineResult,
  clinicalCase: ClinicalCase,
): Assessment {
  const recClass = getRecommendationClass(engineResult.recommendation_class_id);
  const category: RecommendationCategory =
    CATEGORY_MAP[engineResult.recommendation_class_id] ?? "observe_or_test";

  return {
    assessment_id: engineResult.decision_id,
    case_id: clinicalCase.case_id,
    timestamp: engineResult.timestamp,
    recommendation: {
      category,
      label: recClass?.label ?? engineResult.recommendation_class_id,
      requires_public_health: category !== "no_action",
      requires_escalation: recClass?.requires_escalation ?? false,
      raw_class_id: engineResult.recommendation_class_id,
    },
    risk_snapshot: {
      overall_risk_tier: engineResult.risk_tier,
      confidence: engineResult.host_profile?.confidence ?? "low",
    },
    rationale: {
      summary: engineResult.audit_trail[engineResult.audit_trail.length - 1] ?? "",
      lines: engineResult.audit_trail,
    },
    key_factors: engineResult.key_drivers,
    follow_up_tasks: buildFollowUpTasks(category),
    provenance: {
      engine_version: "2.0.0",
      decision_id: engineResult.decision_id,
      timestamp: engineResult.timestamp,
    },
  };
}

// ── Follow-up tasks ───────────────────────────────────────────────────────

function buildFollowUpTasks(category: RecommendationCategory): FollowUpTask[] {
  const tasks: FollowUpTask[] = [];

  // Public health notification for any actionable finding
  if (category !== "no_action") {
    tasks.push({
      task_id: randomUUID(),
      label: "Notify public health authority",
      priority: "urgent",
      task_type: "public_health",
    });
  }

  switch (category) {
    case "prophylaxis":
      tasks.push({
        task_id: randomUUID(),
        label: "Initiate PEP protocol",
        priority: "urgent",
        task_type: "prophylaxis",
      });
      break;
    case "observe_or_test":
      tasks.push({
        task_id: randomUUID(),
        label: "Arrange animal observation or testing",
        priority: "important",
        task_type: "testing",
      });
      break;
    case "expert_review":
      tasks.push({
        task_id: randomUUID(),
        label: "Obtain specialist consultation",
        priority: "urgent",
        task_type: "expert_review",
      });
      break;
    case "no_action":
      tasks.push({
        task_id: randomUUID(),
        label: "Document assessment in chart",
        priority: "routine",
        task_type: "documentation",
      });
      break;
  }

  return tasks;
}

// ── Workflow status ───────────────────────────────────────────────────────

export function deriveStatus(assessment?: Assessment): WorkflowStatus {
  if (!assessment) return "intake";
  switch (assessment.recommendation.category) {
    case "no_action":
      return "completed";
    case "prophylaxis":
    case "observe_or_test":
    case "expert_review":
      return "action_required";
    default:
      return "assessed";
  }
}

// ── Envelope factory ──────────────────────────────────────────────────────

export function createEnvelope(
  clinicalCase: ClinicalCase,
  assessment: Assessment,
): CaseEnvelope {
  const now = new Date().toISOString();
  return {
    envelope_id: randomUUID(),
    schema_version: "0.1.0",
    module_id: "rabies",
    created_at: now,
    updated_at: now,
    case: clinicalCase,
    assessment,
    status: deriveStatus(assessment),
  };
}
