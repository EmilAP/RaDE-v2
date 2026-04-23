// ---------------------------------------------------------------------------
// rade-v2 — Centralized missing critical field resolver
// ---------------------------------------------------------------------------

import {
  buildQuestionnaire,
  getQuestion,
} from "../../intake/questionnaire.js";
import { loadCanonicalIntake } from "../../intake/loader.js";
import { getNormalizedAnswer } from "../../intake/payload.js";
import type { CanonicalConsult } from "./types.js";

export type MissingCriticalField = {
  question_id: string;
  question_text: string;
  reason: string;
  severity: "blocking" | "non_blocking";
};

export type MissingCriticalFieldResolution = {
  missing_field_ids: string[];
  missing_fields: MissingCriticalField[];
  blocking_field_ids: string[];
  blocking_fields: MissingCriticalField[];
  non_blocking_field_ids: string[];
  non_blocking_fields: MissingCriticalField[];
  clarification_targets: string[];
  blocking_reasons: string[];
};

const BLOCKING_FIELD_RULES = [
  {
    question_id: "c04",
    reason: "Species identification is required to route rabies review correctly.",
  },
  {
    question_id: "c12",
    reason: "Exposure type is required to understand whether a meaningful rabies exposure occurred.",
  },
  {
    question_id: "c02",
    reason: "Exposure timing is required to assess urgency and follow-up windows.",
  },
  {
    question_id: "c03",
    reason: "Exposure location is required for jurisdiction and epidemiology context.",
  },
  {
    question_id: "c25",
    reason: "Animal availability drives observation, testing, and PH follow-up planning.",
  },
  {
    question_id: "c18",
    reason: "Animal health status is required to judge whether rabies-compatible behavior is present.",
  },
] as const;

const NON_BLOCKING_FIELD_RULES = [
  {
    question_id: "c01",
    reason: "Knowing whether PEP has already started improves review handoff but does not block consult intake.",
  },
  {
    question_id: "c14",
    reason: "Whether the animal is still alive is useful follow-up context for PH review.",
  },
  {
    question_id: "c23",
    reason: "Rabies testing status improves follow-up planning but is not required to open review.",
  },
] as const;

export class MissingCriticalFieldResolver {
  private readonly questionnaire = buildQuestionnaire(loadCanonicalIntake().data);

  resolve(consult: CanonicalConsult): MissingCriticalFieldResolution {
    const blocking = BLOCKING_FIELD_RULES
      .filter((rule) => this.isMissing(consult, rule.question_id))
      .map((rule) => this.buildField(rule.question_id, rule.reason, "blocking"));

    const nonBlocking = NON_BLOCKING_FIELD_RULES
      .filter((rule) => this.isMissing(consult, rule.question_id))
      .map((rule) => this.buildField(rule.question_id, rule.reason, "non_blocking"));

    const species = this.getEnumValue(consult, "c04");
    if ((species === "bat" || species === "unknown") && this.isMissing(consult, "c05")) {
      blocking.push(
        this.buildField(
          "c05",
          "Bat exposure cannot be safely reviewed until the bat-specific exposure context is documented.",
          "blocking",
        ),
      );
    }

    const animalTestStatus = this.getEnumValue(consult, "c23") ?? this.getTernaryValue(consult, "c23");
    if (
      (animalTestStatus === "yes" || animalTestStatus === "pending" || animalTestStatus === "inconclusive") &&
      this.isMissing(consult, "c24")
    ) {
      nonBlocking.push(
        this.buildField(
          "c24",
          "If rabies testing is underway or reported, the current result should be captured for PH follow-up.",
          "non_blocking",
        ),
      );
    }

    const missing = [...blocking, ...nonBlocking];

    return {
      missing_field_ids: missing.map((field) => field.question_id),
      missing_fields: missing,
      blocking_field_ids: blocking.map((field) => field.question_id),
      blocking_fields: blocking,
      non_blocking_field_ids: nonBlocking.map((field) => field.question_id),
      non_blocking_fields: nonBlocking,
      clarification_targets: [...blocking, ...nonBlocking].map((field) => field.question_id),
      blocking_reasons:
        blocking.length > 0 ? ["critical_intake_fields_missing"] : [],
    };
  }

  private buildField(
    questionId: string,
    reason: string,
    severity: MissingCriticalField["severity"],
  ): MissingCriticalField {
    const question = getQuestion(this.questionnaire, questionId);
    return {
      question_id: questionId,
      question_text: question?.text ?? questionId,
      reason,
      severity,
    } satisfies MissingCriticalField;
  }

  private isMissing(consult: CanonicalConsult, questionId: string): boolean {
    const answer = getNormalizedAnswer(consult.body.payload, questionId);
    if (!answer) {
      return true;
    }

    return answer.status !== "confirmed" || answer.raw_value.kind === "unanswered";
  }

  private getEnumValue(consult: CanonicalConsult, questionId: string): string | undefined {
    const answer = getNormalizedAnswer(consult.body.payload, questionId);
    if (!answer) {
      return undefined;
    }

    if (answer.raw_value.kind === "enum" || answer.raw_value.kind === "count_enum") {
      return answer.raw_value.value;
    }

    return undefined;
  }

  private getTernaryValue(consult: CanonicalConsult, questionId: string): string | undefined {
    const answer = getNormalizedAnswer(consult.body.payload, questionId);
    if (!answer) {
      return undefined;
    }

    if (answer.raw_value.kind === "ternary" || answer.raw_value.kind === "binary") {
      return answer.raw_value.value;
    }

    return undefined;
  }
}

export function createMissingCriticalFieldResolver(): MissingCriticalFieldResolver {
  return new MissingCriticalFieldResolver();
}