// ---------------------------------------------------------------------------
// rade-v2 — Intake answer model + validation
// ---------------------------------------------------------------------------

import type { Questionnaire, QuestionMeta } from "./questionnaire.js";

// ── Answer value types ─────────────────────────────────────────────────────

export type AnswerValue =
  | { kind: "binary"; value: "yes" | "no" }
  | { kind: "ternary"; value: "yes" | "no" | "unknown" }
  | { kind: "enum"; value: string }
  | { kind: "multiselect"; values: string[] }
  | { kind: "datetime"; value: string } // ISO-8601
  | { kind: "free_text"; value: string }
  | { kind: "count_enum"; value: string }
  | { kind: "unanswered" };

export type IntakeActorCapture = {
  actor_id: string;
  role: string;
  display_name: string;
  organization_id?: string;
};

export type SourceModality = "dictated" | "typed" | "clicked" | "inferred";

export type ProvenanceConfidence = "low" | "medium" | "high";

export type ProvenanceStatus = "confirmed" | "unconfirmed" | "missing";

export type AnswerProvenance = {
  source_modality: SourceModality;
  confidence: ProvenanceConfidence;
  status: ProvenanceStatus;
  captured_by: IntakeActorCapture;
  captured_at: string;
  last_confirmed_by?: IntakeActorCapture;
  last_confirmed_at?: string;
};

export type IntakeAnswer = {
  value: AnswerValue;
  provenance: AnswerProvenance;
};

export type IntakeAnswerInput = AnswerValue | IntakeAnswer;

// ── Answer set ─────────────────────────────────────────────────────────────

export type IntakeAnswerSet = Map<string, IntakeAnswer>;

const LEGACY_CAPTURED_BY: IntakeActorCapture = {
  actor_id: "rade-legacy-intake",
  role: "system",
  display_name: "RaDE Intake",
};

// ── Validation ─────────────────────────────────────────────────────────────

export type AnswerValidationIssue = {
  question_id: string;
  message: string;
};

export type AnswerValidationResult = {
  valid: boolean;
  issues: AnswerValidationIssue[];
  answered_count: number;
  unanswered_count: number;
  unanswered_ids: string[];
};

export function validateAnswers(
  answers: IntakeAnswerSet,
  questionnaire: Questionnaire,
): AnswerValidationResult {
  const issues: AnswerValidationIssue[] = [];
  const unanswered: string[] = [];
  let answered = 0;

  for (const q of questionnaire.questions) {
    const stored = answers.get(q.id);
    const ans = stored?.value;

    if (!ans || ans.kind === "unanswered") {
      unanswered.push(q.id);
      continue;
    }

    answered++;
    const qIssues = validateSingleAnswer(ans, q);
    issues.push(...qIssues);
  }

  // Check for answers to unknown question ids
  for (const [key] of answers) {
    if (!questionnaire.question_index.has(key)) {
      issues.push({
        question_id: key,
        message: `Answer provided for unknown question id: ${key}`,
      });
    }
  }

  return {
    valid: issues.length === 0,
    issues,
    answered_count: answered,
    unanswered_count: unanswered.length,
    unanswered_ids: unanswered,
  };
}

function validateSingleAnswer(
  ans: AnswerValue,
  q: QuestionMeta,
): AnswerValidationIssue[] {
  const issues: AnswerValidationIssue[] = [];
  const rt = q.response.type;

  switch (ans.kind) {
    case "binary":
      if (rt !== "binary_yn") {
        issues.push({ question_id: q.id, message: `Expected response_type '${rt}', got binary answer` });
      }
      break;

    case "ternary":
      if (rt !== "ternary_ynu") {
        issues.push({ question_id: q.id, message: `Expected response_type '${rt}', got ternary answer` });
      }
      break;

    case "enum":
      if (rt !== "enum" && rt !== "count_enum") {
        issues.push({ question_id: q.id, message: `Expected response_type '${rt}', got enum answer` });
      } else if (
        q.response.option_values.length > 0 &&
        !q.response.option_values.includes(ans.value)
      ) {
        issues.push({
          question_id: q.id,
          message: `Invalid enum value '${ans.value}'. Allowed: ${q.response.option_values.join(", ")}`,
        });
      }
      break;

    case "count_enum":
      if (rt !== "count_enum") {
        issues.push({ question_id: q.id, message: `Expected response_type '${rt}', got count_enum answer` });
      } else if (
        q.response.option_values.length > 0 &&
        !q.response.option_values.includes(ans.value)
      ) {
        issues.push({
          question_id: q.id,
          message: `Invalid count_enum value '${ans.value}'. Allowed: ${q.response.option_values.join(", ")}`,
        });
      }
      break;

    case "multiselect":
      if (rt !== "multiselect_any") {
        issues.push({ question_id: q.id, message: `Expected response_type '${rt}', got multiselect answer` });
      } else if (q.response.option_values.length > 0) {
        for (const v of ans.values) {
          if (!q.response.option_values.includes(v)) {
            issues.push({
              question_id: q.id,
              message: `Invalid multiselect value '${v}'. Allowed: ${q.response.option_values.join(", ")}`,
            });
          }
        }
      }
      break;

    case "datetime":
      if (rt !== "datetime") {
        issues.push({ question_id: q.id, message: `Expected response_type '${rt}', got datetime answer` });
      }
      break;

    case "free_text":
      if (rt !== "free_text") {
        issues.push({ question_id: q.id, message: `Expected response_type '${rt}', got free_text answer` });
      }
      break;
  }

  return issues;
}

// ── Convenience constructors ───────────────────────────────────────────────

export const Ans = {
  yes: (): AnswerValue => ({ kind: "binary", value: "yes" }),
  no: (): AnswerValue => ({ kind: "binary", value: "no" }),
  ternary: (v: "yes" | "no" | "unknown"): AnswerValue => ({ kind: "ternary", value: v }),
  enum: (v: string): AnswerValue => ({ kind: "enum", value: v }),
  countEnum: (v: string): AnswerValue => ({ kind: "count_enum", value: v }),
  multi: (vs: string[]): AnswerValue => ({ kind: "multiselect", values: vs }),
  datetime: (v: string): AnswerValue => ({ kind: "datetime", value: v }),
  text: (v: string): AnswerValue => ({ kind: "free_text", value: v }),
  unanswered: (): AnswerValue => ({ kind: "unanswered" }),
} as const;

export function withProvenance(
  value: AnswerValue,
  overrides: Partial<AnswerProvenance> = {},
): IntakeAnswer {
  const capturedAt = overrides.captured_at ?? new Date().toISOString();
  const capturedBy = overrides.captured_by ?? LEGACY_CAPTURED_BY;
  const status = overrides.status ?? (value.kind === "unanswered" ? "missing" : "confirmed");
  const lastConfirmedBy = overrides.last_confirmed_by ?? (status === "missing" ? undefined : capturedBy);
  const lastConfirmedAt = overrides.last_confirmed_at ?? (status === "missing" ? undefined : capturedAt);

  return {
    value,
    provenance: {
      source_modality: overrides.source_modality ?? "clicked",
      confidence: overrides.confidence ?? (value.kind === "unanswered" ? "low" : "high"),
      status,
      captured_by: capturedBy,
      captured_at: capturedAt,
      last_confirmed_by: lastConfirmedBy,
      last_confirmed_at: lastConfirmedAt,
    },
  };
}

export function getAnswerValue(answer: IntakeAnswerInput | undefined): AnswerValue | undefined {
  if (!answer) return undefined;
  return isIntakeAnswer(answer) ? answer.value : answer;
}

export function getAnswerProvenance(answer: IntakeAnswerInput | undefined): AnswerProvenance {
  return isIntakeAnswer(answer)
    ? answer.provenance
    : withProvenance(answer ?? Ans.unanswered()).provenance;
}

function isIntakeAnswer(answer: IntakeAnswerInput | undefined): answer is IntakeAnswer {
  return typeof answer === "object" && answer !== null && "value" in answer && "provenance" in answer;
}

// ── Build from flat record (convenience for tests / examples) ──────────────

export function buildAnswerSet(
  entries: Array<[string, IntakeAnswerInput]>,
): IntakeAnswerSet {
  return new Map(
    entries.map(([questionId, answer]) => [
      questionId,
      isIntakeAnswer(answer) ? answer : withProvenance(answer),
    ]),
  );
}
