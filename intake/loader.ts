// ---------------------------------------------------------------------------
// rade-v2 — Canonical intake loader + validator + metadata reporter
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Raw JSON shape ─────────────────────────────────────────────────────────

export type RawSourceMap = {
  who_ids: string[];
  on_ids: string[];
  who_text?: string;
  on_text?: string;
  who_source_phrase?: string;
  on_source_phrase?: string;
};

export type RawOption = string | { value: string; label: string };

export type RawItem = { value: string; label: string };

export type RawQuestion = {
  id: string;
  display_order: number;
  section: string;
  text: string;
  origin: string;
  type: string;
  response_type: string;
  options?: RawOption[];
  items?: RawItem[];
  source_map: RawSourceMap;
  source_phrase?: string;
  rationale?: string;
  footnote_refs?: string[] | Record<string, string[]>;
  inline_notes?: string[];
  redundancy_group?: string;
  group_id?: string;
  group_evaluation?: string;
};

export type RawSection = { id: string; title: string };

export type RawSource = {
  key: string;
  schema_id: string;
  title: string;
  question_count: number;
};

export type RawCanonicalIntake = {
  schema_id: string;
  title: string;
  version: string;
  description: string;
  sources: RawSource[];
  validation: Record<string, number>;
  sections: RawSection[];
  questions: RawQuestion[];
};

// ── Supported response types ───────────────────────────────────────────────

const SUPPORTED_RESPONSE_TYPES = new Set([
  "binary_yn",
  "ternary_ynu",
  "enum",
  "multiselect_any",
  "datetime",
  "free_text",
  "count_enum",
]);

// ── Validation issue ───────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning";

export type ValidationIssue = {
  severity: ValidationSeverity;
  path: string;
  message: string;
};

// ── Metadata report ────────────────────────────────────────────────────────

export type IntakeMetadataReport = {
  schema_id: string;
  file_path: string;
  question_count: number;
  section_count: number;
  response_type_summary: Record<string, number>;
  classification_summary: Record<string, number>;
  origin_summary: Record<string, number>;
  source_count: number;
  version: string;
};

// ── Validation result ──────────────────────────────────────────────────────

export type LoadResult = {
  valid: boolean;
  issues: ValidationIssue[];
  data: RawCanonicalIntake;
  metadata: IntakeMetadataReport;
};

// ── Loader ─────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = resolve(
  __dirname,
  "../data/canonical/canonical_rabies_intake_v2.json",
);

let cached: LoadResult | undefined;

export function loadCanonicalIntake(
  filePath: string = DEFAULT_PATH,
): LoadResult {
  if (cached && cached.metadata.file_path === filePath) return cached;

  const raw = readFileSync(filePath, "utf-8");
  const data: RawCanonicalIntake = JSON.parse(raw);
  const issues = validate(data, filePath);
  const metadata = buildMetadata(data, filePath);
  const result: LoadResult = {
    valid: issues.every((i) => i.severity !== "error"),
    issues,
    data,
    metadata,
  };
  cached = result;
  return result;
}

export function clearLoaderCache(): void {
  cached = undefined;
}

// ── Validation ─────────────────────────────────────────────────────────────

function validate(
  data: RawCanonicalIntake,
  filePath: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Top-level fields
  if (!data.schema_id) {
    issues.push({ severity: "error", path: "schema_id", message: "Missing schema_id" });
  }
  if (!Array.isArray(data.sections) || data.sections.length === 0) {
    issues.push({ severity: "error", path: "sections", message: "Missing or empty sections array" });
  }
  if (!Array.isArray(data.questions) || data.questions.length === 0) {
    issues.push({ severity: "error", path: "questions", message: "Missing or empty questions array" });
  }

  // Section id uniqueness
  const sectionIds = new Set<string>();
  for (const s of data.sections ?? []) {
    if (sectionIds.has(s.id)) {
      issues.push({ severity: "error", path: `sections/${s.id}`, message: `Duplicate section id: ${s.id}` });
    }
    sectionIds.add(s.id);
  }

  // Question validation
  const questionIds = new Set<string>();
  const displayOrders = new Set<number>();

  for (let i = 0; i < (data.questions ?? []).length; i++) {
    const q = data.questions[i];
    const qPath = `questions[${i}]/${q.id}`;

    // Duplicate id
    if (questionIds.has(q.id)) {
      issues.push({ severity: "error", path: qPath, message: `Duplicate question id: ${q.id}` });
    }
    questionIds.add(q.id);

    // Duplicate display_order
    if (displayOrders.has(q.display_order)) {
      issues.push({ severity: "error", path: qPath, message: `Duplicate display_order: ${q.display_order}` });
    }
    displayOrders.add(q.display_order);

    // Invalid section reference
    if (!sectionIds.has(q.section)) {
      issues.push({
        severity: "error",
        path: qPath,
        message: `Invalid section reference: ${q.section}`,
      });
    }

    // Unsupported response type
    if (!SUPPORTED_RESPONSE_TYPES.has(q.response_type)) {
      issues.push({
        severity: "error",
        path: qPath,
        message: `Unsupported response_type: ${q.response_type}`,
      });
    }

    // Malformed options
    if (q.response_type === "enum" || q.response_type === "count_enum") {
      if (!Array.isArray(q.options) || q.options.length === 0) {
        issues.push({
          severity: "error",
          path: qPath,
          message: `response_type '${q.response_type}' requires non-empty options array`,
        });
      }
    }

    // Malformed items for multiselect
    if (q.response_type === "multiselect_any") {
      if (!Array.isArray(q.items) || q.items.length === 0) {
        issues.push({
          severity: "error",
          path: qPath,
          message: "response_type 'multiselect_any' requires non-empty items array",
        });
      }
    }

    // Display order sequential check (warning — not error)
    if (q.display_order !== i + 1) {
      issues.push({
        severity: "warning",
        path: qPath,
        message: `display_order ${q.display_order} does not match array position ${i + 1}`,
      });
    }

    // Missing text
    if (!q.text || q.text.trim() === "") {
      issues.push({ severity: "error", path: qPath, message: "Missing question text" });
    }

    // Missing source_map
    if (!q.source_map) {
      issues.push({ severity: "warning", path: qPath, message: "Missing source_map" });
    }
  }

  return issues;
}

// ── Metadata builder ───────────────────────────────────────────────────────

function buildMetadata(
  data: RawCanonicalIntake,
  filePath: string,
): IntakeMetadataReport {
  const responseTypeSummary: Record<string, number> = {};
  const classificationSummary: Record<string, number> = {};
  const originSummary: Record<string, number> = {};

  for (const q of data.questions ?? []) {
    responseTypeSummary[q.response_type] =
      (responseTypeSummary[q.response_type] ?? 0) + 1;
    classificationSummary[q.type] =
      (classificationSummary[q.type] ?? 0) + 1;
    originSummary[q.origin] = (originSummary[q.origin] ?? 0) + 1;
  }

  return {
    schema_id: data.schema_id,
    file_path: filePath,
    question_count: (data.questions ?? []).length,
    section_count: (data.sections ?? []).length,
    response_type_summary: responseTypeSummary,
    classification_summary: classificationSummary,
    origin_summary: originSummary,
    source_count: (data.sources ?? []).length,
    version: data.version ?? "unknown",
  };
}
