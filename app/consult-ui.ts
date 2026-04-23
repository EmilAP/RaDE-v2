import type { AuditEvent } from "../core/consult/audit.js";
import type { ConsultView } from "../core/consult/service.js";
import type { CanonicalConsult } from "../core/consult/types.js";
import { loadCanonicalIntake } from "../intake/loader.js";
import { getNormalizedAnswer } from "../intake/payload.js";
import { buildQuestionnaire, getQuestion } from "../intake/questionnaire.js";

export type ConsultKeyFacts = {
  species: string;
  exposure_type: string;
  location: string;
  exposure_date: string;
};

export type WorkflowTimelineEntry = {
  label: string;
  at?: string;
  complete: boolean;
};

export type ConsultSummarySnapshot = {
  key_facts: ConsultKeyFacts;
  latest_action: string;
  pending_clarifications: number;
  blocking_missing_labels: string[];
  non_blocking_missing_labels: string[];
};

export type FactReviewItem = {
  question_id: string;
  question_text: string;
  value: string;
  badges: string[];
};

export type FactReviewSection = {
  title: string;
  items: FactReviewItem[];
};

export type FactReviewSnapshot = {
  sections: FactReviewSection[];
  latest_correction?: {
    corrected_at: string;
    corrected_by: string;
    corrected_question_labels: string[];
    note?: string;
  };
  pending_clarification_labels: string[];
};

const questionnaire = buildQuestionnaire(loadCanonicalIntake().data);

export const CONSULT_FACT_REVIEW_SECTIONS: Array<{ title: string; question_ids: string[] }> = [
  { title: "Exposure", question_ids: ["c12", "c05"] },
  { title: "Animal / source", question_ids: ["c04", "c14", "c18", "c23", "c24", "c25"] },
  { title: "Timing / location", question_ids: ["c02", "c03"] },
  { title: "Patient factors", question_ids: ["c01"] },
];

const DRIVING_FACT_IDS = new Set(["c02", "c03", "c04", "c12"]);

const TIMELINE_STEPS: Array<{ eventType: AuditEvent["event_type"]; label: string }> = [
  { eventType: "consult_submitted", label: "Submitted" },
  { eventType: "clarification_requested", label: "Clarification requested" },
  { eventType: "clarification_responded", label: "Clarification answered" },
  { eventType: "consult_facts_corrected", label: "Facts corrected" },
  { eventType: "recommendation_returned", label: "Recommendation returned" },
  { eventType: "recommendation_acknowledged", label: "Acknowledged" },
];

export function buildConsultSummarySnapshot(view: ConsultView): ConsultSummarySnapshot {
  const consult = view.consult;
  const latestEvent = view.audit_events.at(-1);
  return {
    key_facts: getConsultKeyFacts(consult),
    latest_action: latestEvent
      ? describeAuditEvent(latestEvent)
      : describeLatestAction(consult.current_state),
    pending_clarifications: consult.clarifications.filter((thread) => !thread.response).length,
    blocking_missing_labels: view.missing_critical_fields.blocking_fields.map(
      (field) => `${field.question_id}: ${field.question_text}`,
    ),
    non_blocking_missing_labels: view.missing_critical_fields.non_blocking_fields.map(
      (field) => `${field.question_id}: ${field.question_text}`,
    ),
  };
}

export function buildFactReviewSnapshot(view: ConsultView): FactReviewSnapshot {
  const consult = view.consult;
  const blockingIds = new Set(view.missing_critical_fields.blocking_field_ids);
  const nonBlockingIds = new Set(view.missing_critical_fields.non_blocking_field_ids);
  const latestCorrection = consult.corrections?.at(-1);
  const latestCorrectionIds = new Set(
    latestCorrection ? Object.keys(latestCorrection.answer_patches) : [],
  );
  const pendingClarificationIds = new Set(
    consult.clarifications
      .filter((thread) => !thread.response)
      .flatMap((thread) => thread.request.target_question_ids),
  );

  return {
    sections: CONSULT_FACT_REVIEW_SECTIONS.map((section) => ({
      title: section.title,
      items: section.question_ids.map((questionId) => {
        const question = getQuestion(questionnaire, questionId);
        const answer = getNormalizedAnswer(consult.body.payload, questionId);
        const badges: string[] = [];

        if (DRIVING_FACT_IDS.has(questionId)) {
          badges.push("Driving fact");
        }
        if (!answer || !answer.is_answered || answer.status === "missing") {
          badges.push("Missing");
        }
        if (blockingIds.has(questionId)) {
          badges.push("Blocking gap");
        } else if (nonBlockingIds.has(questionId)) {
          badges.push("Follow-up gap");
        }
        if (pendingClarificationIds.has(questionId)) {
          badges.push("Clarification requested");
        }
        if (latestCorrectionIds.has(questionId)) {
          badges.push("Recently corrected");
        }
        if (answer?.status === "unconfirmed") {
          badges.push("Unconfirmed");
        }
        if (answer?.source_modality === "inferred") {
          badges.push("Inferred");
        }
        if (answer && answer.confidence !== "high") {
          badges.push(`${capitalize(answer.confidence)} confidence`);
        }

        return {
          question_id: questionId,
          question_text: question?.text ?? questionId,
          value:
            !answer || !answer.is_answered || answer.status === "missing"
              ? "Not recorded"
              : answer.normalized_string,
          badges,
        } satisfies FactReviewItem;
      }),
    })),
    latest_correction: latestCorrection
      ? {
          corrected_at: latestCorrection.corrected_at,
          corrected_by: latestCorrection.corrected_by.display_name,
          corrected_question_labels: Object.keys(latestCorrection.answer_patches).map(
            (questionId) => getQuestion(questionnaire, questionId)?.text ?? questionId,
          ),
          note: latestCorrection.note,
        }
      : undefined,
    pending_clarification_labels: [...pendingClarificationIds].map(
      (questionId) => getQuestion(questionnaire, questionId)?.text ?? questionId,
    ),
  };
}

export function buildWorkflowTimeline(auditEvents: AuditEvent[]): WorkflowTimelineEntry[] {
  return TIMELINE_STEPS.map((step) => {
    const matchingEvent = [...auditEvents]
      .reverse()
      .find((event) => event.event_type === step.eventType);

    return {
      label: step.label,
      at: matchingEvent?.at,
      complete: !!matchingEvent,
    } satisfies WorkflowTimelineEntry;
  });
}

export function describeLatestAction(state: CanonicalConsult["current_state"]): string {
  switch (state) {
    case "AWAITING_PH_REVIEW":
      return "Awaiting PH review";
    case "CLARIFICATION_REQUESTED":
      return "Clarification requested";
    case "CLARIFICATION_PROVIDED":
      return "Clarification answered and returned for PH review";
    case "RECOMMENDATION_AUTHORED":
      return "Recommendation authored by public health";
    case "RECOMMENDATION_RETURNED":
      return "Recommendation returned to clinician";
    case "ACKNOWLEDGED":
      return "Recommendation acknowledged";
    case "CLOSED":
      return "Consult closed";
    case "SUBMITTED":
      return "Consult submitted";
    case "DRAFT":
      return "Draft consult";
    case "CANCELLED":
      return "Consult cancelled";
    default:
      return String(state).replaceAll("_", " ").toLowerCase();
  }
}

export function describeAuditEvent(event: AuditEvent): string {
  switch (event.event_type) {
    case "consult_submitted":
      return "Consult submitted";
    case "consult_ready_for_review":
      return "Ready for PH review";
    case "consult_facts_corrected":
      return "Consult facts corrected";
    case "clarification_requested":
      return "Clarification requested";
    case "clarification_responded":
      return "Clarification answered";
    case "recommendation_authored":
      return "Recommendation authored by public health";
    case "recommendation_returned":
      return "Recommendation returned to clinician";
    case "recommendation_acknowledged":
      return "Recommendation acknowledged";
    case "consult_closed":
      return "Consult closed";
    case "engine_decision_recorded":
      return "Engine advisory recorded";
    case "escalation_requested":
      return "Escalation requested";
    default:
      return String(event.event_type).replaceAll("_", " ");
  }
}

export function getConsultKeyFacts(consult: CanonicalConsult): ConsultKeyFacts {
  return {
    species: getAnswerText(consult, "c04", "Not recorded"),
    exposure_type: getAnswerText(consult, "c12", "Not recorded"),
    location: getAnswerText(consult, "c03", "Not recorded"),
    exposure_date: getAnswerText(consult, "c02", "Not recorded"),
  };
}

function getAnswerText(
  consult: CanonicalConsult,
  questionId: string,
  fallback: string,
): string {
  const answer = getNormalizedAnswer(consult.body.payload, questionId);
  if (!answer || !answer.is_answered) {
    return fallback;
  }

  return answer.normalized_string;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}