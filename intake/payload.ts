// ---------------------------------------------------------------------------
// rade-v2 — Canonical case payload builder
//
// Converts validated answers into a normalized canonical case payload.
// This is NOT the final decision envelope — it is the structured boundary
// that the future canonical flow engine will consume.
// ---------------------------------------------------------------------------

import type { Questionnaire, QuestionMeta, SectionMeta } from "./questionnaire.js";
import {
  type IntakeAnswerSet,
  type AnswerValue,
  type AnswerProvenance,
  getAnswerProvenance,
  getAnswerValue,
} from "./answers.js";

// ── Types ──────────────────────────────────────────────────────────────────

export type NormalizedAnswer = {
  question_id: string;
  display_order: number;
  section_id: string;
  classification: string;
  origin: string;
  response_type: string;
  raw_value: AnswerValue;
  normalized_string: string; // human-readable serialization
  is_answered: boolean;
  provenance: AnswerProvenance;
  source_modality: AnswerProvenance["source_modality"];
  confidence: AnswerProvenance["confidence"];
  status: AnswerProvenance["status"];
};

export type SectionPayload = {
  section_id: string;
  section_title: string;
  answers: NormalizedAnswer[];
  answered_count: number;
  unanswered_count: number;
};

export type ClassificationBucket = {
  classification: string;
  question_ids: string[];
  answered_ids: string[];
  unanswered_ids: string[];
};

export type SourceTrace = {
  question_id: string;
  who_ids: string[];
  on_ids: string[];
  origin: string;
  redundancy_group: string | null;
};

export type DerivedFact = {
  fact_id: string;
  value: unknown;
  source_question_ids: string[];
  derivation: string; // human-readable description
};

export type PlaceholderAssessmentArea = {
  status: "awaiting_canonical_flow";
  message: string;
  placeholder_recommendation: string;
};

export type CanonicalCasePayload = {
  payload_id: string;
  schema_id: string;
  created_at: string;
  intake_metadata: {
    schema_version: string;
    question_count: number;
    answered_count: number;
    unanswered_count: number;
  };
  sections: SectionPayload[];
  classification_buckets: ClassificationBucket[];
  source_traces: SourceTrace[];
  unresolved_fields: string[];
  derived_facts: DerivedFact[];
  assessment_placeholder: PlaceholderAssessmentArea;
};

// ── Builder ────────────────────────────────────────────────────────────────

export function buildCanonicalPayload(
  answers: IntakeAnswerSet,
  questionnaire: Questionnaire,
): CanonicalCasePayload {
  const now = new Date().toISOString();
  const payloadId = `payload_${Date.now()}`;

  // Build normalized answers
  const allNormalized: NormalizedAnswer[] = questionnaire.questions.map((q) => {
    const stored = answers.get(q.id);
    const ans = getAnswerValue(stored) ?? { kind: "unanswered" as const };
    const provenance = getAnswerProvenance(stored);
    return normalizeAnswer(q, ans, provenance);
  });

  // Group by section
  const sections = questionnaire.sections.map((sec) =>
    buildSectionPayload(sec, allNormalized),
  );

  // Classification buckets
  const classificationBuckets = buildClassificationBuckets(
    questionnaire.questions,
    answers,
  );

  // Source traces
  const sourceTraces = questionnaire.questions.map((q) => ({
    question_id: q.id,
    who_ids: q.source_map.who_ids,
    on_ids: q.source_map.on_ids,
    origin: q.origin,
    redundancy_group: q.redundancy_group,
  }));

  // Unresolved fields (unanswered core questions)
  const unresolved = allNormalized
    .filter((na) => na.classification === "core" && (na.status === "missing" || !na.is_answered))
    .map((na) => na.question_id);

  // Derived facts (obvious normalizations only)
  const derivedFacts = deriveFacts(answers, questionnaire);

  const answeredCount = allNormalized.filter((a) => a.is_answered).length;

  return {
    payload_id: payloadId,
    schema_id: questionnaire.schema_id,
    created_at: now,
    intake_metadata: {
      schema_version: questionnaire.version,
      question_count: questionnaire.questions.length,
      answered_count: answeredCount,
      unanswered_count: questionnaire.questions.length - answeredCount,
    },
    sections,
    classification_buckets: classificationBuckets,
    source_traces: sourceTraces,
    unresolved_fields: unresolved,
    derived_facts: derivedFacts,
    assessment_placeholder: {
      status: "awaiting_canonical_flow",
      message:
        "Canonical rabies decision flow is not yet finalized. This payload is ready for assessment once the flow is integrated.",
      placeholder_recommendation: "manual_review_required",
    },
  };
}

export function getNormalizedAnswer(
  payload: CanonicalCasePayload,
  questionId: string,
): NormalizedAnswer | undefined {
  for (const section of payload.sections) {
    const answer = section.answers.find((entry) => entry.question_id === questionId);
    if (answer) {
      return answer;
    }
  }

  return undefined;
}

// ── Internals ──────────────────────────────────────────────────────────────

function normalizeAnswer(
  q: QuestionMeta,
  ans: AnswerValue,
  provenance: AnswerProvenance,
): NormalizedAnswer {
  return {
    question_id: q.id,
    display_order: q.display_order,
    section_id: q.section_id,
    classification: q.classification,
    origin: q.origin,
    response_type: q.response.type,
    raw_value: ans,
    normalized_string: answerToString(ans),
    is_answered: ans.kind !== "unanswered",
    provenance,
    source_modality: provenance.source_modality,
    confidence: provenance.confidence,
    status: provenance.status,
  };
}

function answerToString(ans: AnswerValue): string {
  switch (ans.kind) {
    case "binary":
    case "ternary":
    case "enum":
    case "count_enum":
    case "datetime":
    case "free_text":
      return ans.value;
    case "multiselect":
      return ans.values.join(", ");
    case "unanswered":
      return "[unanswered]";
  }
}

function buildSectionPayload(
  sec: SectionMeta,
  all: NormalizedAnswer[],
): SectionPayload {
  const sectionAnswers = all.filter((a) => a.section_id === sec.id);
  return {
    section_id: sec.id,
    section_title: sec.title,
    answers: sectionAnswers,
    answered_count: sectionAnswers.filter((a) => a.is_answered).length,
    unanswered_count: sectionAnswers.filter((a) => !a.is_answered).length,
  };
}

function buildClassificationBuckets(
  questions: QuestionMeta[],
  answers: IntakeAnswerSet,
): ClassificationBucket[] {
  const map = new Map<string, ClassificationBucket>();

  for (const q of questions) {
    let bucket = map.get(q.classification);
    if (!bucket) {
      bucket = {
        classification: q.classification,
        question_ids: [],
        answered_ids: [],
        unanswered_ids: [],
      };
      map.set(q.classification, bucket);
    }
    bucket.question_ids.push(q.id);
    const ans = getAnswerValue(answers.get(q.id));
    if (ans && ans.kind !== "unanswered") {
      bucket.answered_ids.push(q.id);
    } else {
      bucket.unanswered_ids.push(q.id);
    }
  }

  return [...map.values()];
}

// ── Derived facts (obvious normalizations ONLY) ────────────────────────────
// NOTE: Final derived facts will be determined by the canonical flow.
// These are only safe, mechanical derivations.

function deriveFacts(
  answers: IntakeAnswerSet,
  q: Questionnaire,
): DerivedFact[] {
  const facts: DerivedFact[] = [];

  // df_is_mammal — from c04 animal type
  const c04 = getAnswerValue(answers.get("c04"));
  if (c04 && c04.kind === "enum") {
    facts.push({
      fact_id: "df_is_mammal",
      value: c04.value !== "non_mammal",
      source_question_ids: ["c04"],
      derivation: "Animal type is not 'non_mammal' → is_mammal = true",
    });
  }

  // df_bat_involved — from c04
  if (c04 && c04.kind === "enum") {
    facts.push({
      fact_id: "df_bat_involved",
      value: c04.value === "bat",
      source_question_ids: ["c04"],
      derivation: "Animal type is 'bat' → bat_involved",
    });
  }

  // df_has_relevant_exposure — from c12 multiselect (any selected = relevant)
  const c12 = getAnswerValue(answers.get("c12"));
  if (c12 && c12.kind === "multiselect") {
    facts.push({
      fact_id: "df_has_relevant_exposure",
      value: c12.values.length > 0,
      source_question_ids: ["c12"],
      derivation: "Any exposure characteristic selected → relevant exposure",
    });
  }

  // df_bat_contact_ruled_out — from c05
  const c05 = getAnswerValue(answers.get("c05"));
  if (c05 && (c05.kind === "binary" || c05.kind === "ternary")) {
    facts.push({
      fact_id: "df_bat_contact_ruled_out",
      value: c05.value === "yes",
      source_question_ids: ["c05"],
      derivation: "Bat saliva exposure can be ruled out",
    });
  }

  // df_animal_available — from c25
  const c25 = getAnswerValue(answers.get("c25"));
  if (c25 && (c25.kind === "ternary" || c25.kind === "binary")) {
    facts.push({
      fact_id: "df_animal_available",
      value: c25.value === "yes",
      source_question_ids: ["c25"],
      derivation: "Animal is available for investigation/quarantine/testing",
    });
  }

  // df_high_priority_victim — from c15, c16 (any yes)
  const c15 = getAnswerValue(answers.get("c15"));
  const c16 = getAnswerValue(answers.get("c16"));
  const hp15 = c15 && c15.kind === "binary" && c15.value === "yes";
  const hp16 = c16 && c16.kind === "binary" && c16.value === "yes";
  if (c15 || c16) {
    facts.push({
      fact_id: "df_high_priority_victim",
      value: hp15 || hp16,
      source_question_ids: ["c15", "c16"],
      derivation: "Victim <14 years or multiple/deep wounds → high priority",
    });
  }

  // df_prior_vaccination — from c29
  const c29 = getAnswerValue(answers.get("c29"));
  if (c29 && (c29.kind === "ternary" || c29.kind === "binary")) {
    facts.push({
      fact_id: "df_prior_vaccination",
      value: c29.value === "yes",
      source_question_ids: ["c29"],
      derivation: "Patient has prior rabies vaccination",
    });
  }

  // df_immunocompromised — from c37
  const c37 = getAnswerValue(answers.get("c37"));
  if (c37 && (c37.kind === "ternary" || c37.kind === "binary")) {
    facts.push({
      fact_id: "df_immunocompromised",
      value: c37.value === "yes",
      source_question_ids: ["c37"],
      derivation: "Patient currently immunocompromised",
    });
  }

  // TODO: Additional derived facts will be determined by the canonical flow
  // The following intake fields await flow-defined derivation logic:
  // - WHO wound category (II vs III) from c12 items
  // - Exposure timing urgency from c02
  // - Animal clinical risk composite from c18/c19/c20
  // - Prior vaccination regimen modification from c29-c36
  // - Resource constraint adjustments from c44

  return facts;
}
