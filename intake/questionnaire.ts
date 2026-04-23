// ---------------------------------------------------------------------------
// rade-v2 — Questionnaire model layer
//
// Clean internal representation of the canonical intake schema.
// No UI framework assumptions.
// ---------------------------------------------------------------------------

import type {
  RawCanonicalIntake,
  RawQuestion,
  RawSection,
  RawItem,
  RawOption,
} from "./loader.js";
import { loadCanonicalIntake } from "./loader.js";

// ── Public types ───────────────────────────────────────────────────────────

export type ResponseTypeMeta = {
  type: string;
  allows_multiple: boolean;
  allows_unknown: boolean;
  option_values: string[];
  items: Array<{ value: string; label: string }>;
};

export type QuestionMeta = {
  id: string;
  display_order: number;
  section_id: string;
  text: string;
  origin: string;
  classification: string; // core | policy | documentation
  response: ResponseTypeMeta;
  source_map: { who_ids: string[]; on_ids: string[] };
  redundancy_group: string | null;
  group_id: string | null;
  group_evaluation: string | null;
  footnote_refs: string[];
  inline_notes: string[];
};

export type SectionMeta = {
  id: string;
  title: string;
  question_ids: string[];
};

export type Questionnaire = {
  schema_id: string;
  title: string;
  version: string;
  sections: SectionMeta[];
  questions: QuestionMeta[];
  question_index: Map<string, QuestionMeta>;
  section_index: Map<string, SectionMeta>;
};

// ── Builder ────────────────────────────────────────────────────────────────

export function buildQuestionnaire(
  raw?: RawCanonicalIntake,
): Questionnaire {
  const data = raw ?? loadCanonicalIntake().data;

  const questions: QuestionMeta[] = data.questions.map(mapQuestion);
  const questionIndex = new Map<string, QuestionMeta>();
  for (const q of questions) questionIndex.set(q.id, q);

  const sectionIds = data.sections.map((s) => s.id);
  const sections: SectionMeta[] = data.sections.map((s) => ({
    id: s.id,
    title: s.title,
    question_ids: questions.filter((q) => q.section_id === s.id).map((q) => q.id),
  }));
  const sectionIndex = new Map<string, SectionMeta>();
  for (const s of sections) sectionIndex.set(s.id, s);

  return {
    schema_id: data.schema_id,
    title: data.title,
    version: data.version,
    sections,
    questions,
    question_index: questionIndex,
    section_index: sectionIndex,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function mapQuestion(raw: RawQuestion): QuestionMeta {
  return {
    id: raw.id,
    display_order: raw.display_order,
    section_id: raw.section,
    text: raw.text,
    origin: raw.origin,
    classification: raw.type,
    response: buildResponseMeta(raw),
    source_map: {
      who_ids: raw.source_map?.who_ids ?? [],
      on_ids: raw.source_map?.on_ids ?? [],
    },
    redundancy_group: raw.redundancy_group ?? null,
    group_id: raw.group_id ?? null,
    group_evaluation: raw.group_evaluation ?? null,
    footnote_refs: normalizeFootnotes(raw.footnote_refs),
    inline_notes: raw.inline_notes ?? [],
  };
}

function buildResponseMeta(raw: RawQuestion): ResponseTypeMeta {
  const t = raw.response_type;

  const allows_multiple = t === "multiselect_any";
  const allows_unknown =
    t === "ternary_ynu" || t === "count_enum" || t === "free_text";

  let option_values: string[] = [];
  let items: Array<{ value: string; label: string }> = [];
  if (t === "binary_yn") option_values = ["yes", "no"];
  else if (t === "ternary_ynu") option_values = ["yes", "no", "unknown"];
  else if ((t === "enum" || t === "count_enum") && Array.isArray(raw.options)) {
    option_values = raw.options.map(extractOptionValue);
  } else if (t === "multiselect_any" && Array.isArray(raw.items)) {
    option_values = raw.items.map((i) => i.value);
    items = raw.items.map((i) => ({ value: i.value, label: i.label }));
  }

  return { type: t, allows_multiple, allows_unknown, option_values, items };
}

function extractOptionValue(opt: RawOption): string {
  if (typeof opt === "string") return opt;
  return opt.value;
}

function normalizeFootnotes(
  refs: string[] | Record<string, string[]> | undefined,
): string[] {
  if (!refs) return [];
  if (Array.isArray(refs)) return refs;
  // Merge all values from {who: [...], on: [...]}
  return Object.values(refs).flat();
}

// ── Lookup helpers ─────────────────────────────────────────────────────────

export function getQuestion(
  q: Questionnaire,
  id: string,
): QuestionMeta | undefined {
  return q.question_index.get(id);
}

export function getSection(
  q: Questionnaire,
  id: string,
): SectionMeta | undefined {
  return q.section_index.get(id);
}

export function questionsBySection(
  q: Questionnaire,
  sectionId: string,
): QuestionMeta[] {
  const sec = q.section_index.get(sectionId);
  if (!sec) return [];
  return sec.question_ids
    .map((id) => q.question_index.get(id))
    .filter((x): x is QuestionMeta => !!x);
}

export function questionsByClassification(
  q: Questionnaire,
  classification: string,
): QuestionMeta[] {
  return q.questions.filter((qm) => qm.classification === classification);
}
