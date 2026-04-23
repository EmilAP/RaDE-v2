// ---------------------------------------------------------------------------
// rade-v2 — Intake v2 vertical slice tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ── Intake layer imports ───────────────────────────────────────────────────

import {
  loadCanonicalIntake,
  clearLoaderCache,
  type LoadResult,
} from "../intake/loader.js";

import {
  buildQuestionnaire,
  getQuestion,
  getSection,
  questionsBySection,
  questionsByClassification,
  type Questionnaire,
} from "../intake/questionnaire.js";

import {
  validateAnswers,
  buildAnswerSet,
  Ans,
  type IntakeAnswerSet,
} from "../intake/answers.js";

import {
  buildCanonicalPayload,
  type CanonicalCasePayload,
} from "../intake/payload.js";

import {
  generatePlaceholderAssessment,
  type PlaceholderAssessment,
} from "../intake/assessment.js";

// ── Renderer imports ───────────────────────────────────────────────────────

import { renderClinicianIntake } from "../renderers/clinician-v2.js";
import { renderPublicHealth } from "../renderers/public-health.js";
import { renderPatientSummary } from "../renderers/patient.js";

// ── Adapter imports ────────────────────────────────────────────────────────

import { buildEpicFhirOutput } from "../adapters/epic-fhir.js";
import { buildOpenEmrOutput } from "../adapters/openemr.js";
import { buildSormasOutput } from "../adapters/sormas.js";
import { buildDhis2Output } from "../adapters/dhis2.js";

// ── Manifest import ────────────────────────────────────────────────────────

import { generateMappingManifest } from "../manifests/intake-mapping.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTAKE_PATH = resolve(
  __dirname,
  "../data/canonical/canonical_rabies_intake_v2.json",
);

function buildRaccoonBiteFixture(): IntakeAnswerSet {
  return buildAnswerSet([
    ["c01", Ans.yes()],
    ["c02", Ans.datetime("2026-04-05T10:30:00Z")],
    ["c03", Ans.text("Ontario, Canada")],
    ["c04", Ans.enum("raccoon")],
    ["c05", Ans.yes()], // bat contact ruled out (N/A for raccoon but answered)
    ["c12", Ans.multi(["bite_transdermal_or_bleeding"])],
    ["c13", Ans.multi(["upper_extremity"])],
    ["c14", Ans.ternary("yes")],
    ["c15", Ans.no()], // victim <14
    ["c16", Ans.no()], // multiple/deep wounds
    ["c17", Ans.yes()], // wound washing
    ["c18", Ans.ternary("no")], // rabies signs
    ["c21", Ans.no()], // feral/wild
    ["c22", Ans.no()], // stray
    ["c25", Ans.ternary("yes")], // animal available
    ["c26", Ans.ternary("unknown")], // animal vaccinated
    ["c29", Ans.ternary("no")], // prior vaccination
    ["c37", Ans.ternary("no")], // immunocompromised
    ["c44", Ans.ternary("no")], // RIG limited
  ]);
}

function buildBatExposureFixture(): IntakeAnswerSet {
  return buildAnswerSet([
    ["c01", Ans.no()],
    ["c02", Ans.datetime("2026-04-04T08:00:00Z")],
    ["c03", Ans.text("Toronto, Ontario, Canada")],
    ["c04", Ans.enum("bat")],
    ["c05", Ans.no()], // bat contact NOT ruled out
    ["c06", Ans.ternary("yes")], // bat seen
    ["c07", Ans.ternary("no")], // bat available for testing
    ["c08", Ans.ternary("yes")], // history suggestive of bat
    ["c09", Ans.no()], // minimal contact
    ["c10", Ans.ternary("no")], // bat dead
    ["c11", Ans.ternary("no")], // bat desiccated
    ["c12", Ans.multi(["bite_transdermal_or_bleeding", "saliva_on_broken_skin"])],
    ["c13", Ans.multi(["hands", "face"])],
    ["c15", Ans.yes()], // victim <14
    ["c16", Ans.yes()], // multiple/deep wounds
    ["c17", Ans.yes()], // wound washing
    ["c18", Ans.ternary("unknown")],
    ["c25", Ans.ternary("no")], // animal not available
    ["c29", Ans.ternary("no")],
    ["c37", Ans.ternary("no")],
  ]);
}

function buildMinimalFixture(): IntakeAnswerSet {
  return buildAnswerSet([
    ["c03", Ans.text("Unknown")],
    ["c04", Ans.enum("dog")],
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. LOADER + VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe("Canonical Intake Loader + Validator", () => {
  beforeEach(() => clearLoaderCache());

  it("loads the canonical intake v2 JSON", () => {
    const result = loadCanonicalIntake(INTAKE_PATH);
    expect(result.valid).toBe(true);
    expect(result.data.schema_id).toBe("canonical_rabies_intake_v2");
  });

  it("reports metadata correctly", () => {
    const result = loadCanonicalIntake(INTAKE_PATH);
    expect(result.metadata.question_count).toBe(44);
    expect(result.metadata.section_count).toBe(14);
    expect(result.metadata.source_count).toBe(2);
    expect(result.metadata.schema_id).toBe("canonical_rabies_intake_v2");
  });

  it("detects no duplicate question ids", () => {
    const result = loadCanonicalIntake(INTAKE_PATH);
    const dupIssues = result.issues.filter(
      (i) => i.message.includes("Duplicate question id"),
    );
    expect(dupIssues).toHaveLength(0);
  });

  it("detects no invalid section references", () => {
    const result = loadCanonicalIntake(INTAKE_PATH);
    const badSec = result.issues.filter(
      (i) => i.message.includes("Invalid section reference"),
    );
    expect(badSec).toHaveLength(0);
  });

  it("detects no unsupported response types", () => {
    const result = loadCanonicalIntake(INTAKE_PATH);
    const badRt = result.issues.filter(
      (i) => i.message.includes("Unsupported response_type"),
    );
    expect(badRt).toHaveLength(0);
  });

  it("provides response type summary", () => {
    const result = loadCanonicalIntake(INTAKE_PATH);
    expect(result.metadata.response_type_summary).toHaveProperty("binary_yn");
    expect(result.metadata.response_type_summary).toHaveProperty("ternary_ynu");
    expect(result.metadata.response_type_summary).toHaveProperty("enum");
  });

  it("provides classification summary", () => {
    const result = loadCanonicalIntake(INTAKE_PATH);
    expect(result.metadata.classification_summary).toHaveProperty("core");
  });

  it("caches on repeated loads", () => {
    const r1 = loadCanonicalIntake(INTAKE_PATH);
    const r2 = loadCanonicalIntake(INTAKE_PATH);
    expect(r1).toBe(r2); // same reference
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. QUESTIONNAIRE MODEL
// ═══════════════════════════════════════════════════════════════════════════

describe("Questionnaire Model", () => {
  let q: Questionnaire;

  beforeEach(() => {
    clearLoaderCache();
    const result = loadCanonicalIntake(INTAKE_PATH);
    q = buildQuestionnaire(result.data);
  });

  it("builds a questionnaire with all sections", () => {
    expect(q.sections).toHaveLength(14);
  });

  it("builds a questionnaire with all questions", () => {
    expect(q.questions).toHaveLength(44);
  });

  it("supports question lookup by id", () => {
    const c01 = getQuestion(q, "c01");
    expect(c01).toBeDefined();
    expect(c01!.section_id).toBe("intake_status");
  });

  it("supports section lookup by id", () => {
    const sec = getSection(q, "exposure_context");
    expect(sec).toBeDefined();
    expect(sec!.question_ids.length).toBeGreaterThan(0);
  });

  it("supports questions by section", () => {
    const qs = questionsBySection(q, "bat_exposure_assessment");
    expect(qs.length).toBeGreaterThan(0);
    for (const qm of qs) {
      expect(qm.section_id).toBe("bat_exposure_assessment");
    }
  });

  it("supports questions by classification", () => {
    const core = questionsByClassification(q, "core");
    expect(core.length).toBeGreaterThan(0);
    for (const qm of core) {
      expect(qm.classification).toBe("core");
    }
  });

  it("exposes response type metadata", () => {
    const c04 = getQuestion(q, "c04");
    expect(c04!.response.type).toBe("enum");
    expect(c04!.response.option_values).toContain("bat");
    expect(c04!.response.option_values).toContain("raccoon");
  });

  it("exposes source_map", () => {
    const c01 = getQuestion(q, "c01");
    expect(c01!.source_map.on_ids).toContain("q01");
  });

  it("exposes redundancy_group for merged questions", () => {
    const c18 = getQuestion(q, "c18");
    expect(c18!.redundancy_group).toBe("animal_rabies_signs");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. ANSWER VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe("Answer Validation", () => {
  let q: Questionnaire;

  beforeEach(() => {
    clearLoaderCache();
    q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
  });

  it("validates a correct raccoon bite fixture", () => {
    const answers = buildRaccoonBiteFixture();
    const result = validateAnswers(answers, q);
    expect(result.valid).toBe(true);
    expect(result.answered_count).toBeGreaterThan(0);
  });

  it("validates a correct bat exposure fixture", () => {
    const answers = buildBatExposureFixture();
    const result = validateAnswers(answers, q);
    expect(result.valid).toBe(true);
  });

  it("validates minimal fixture with unanswered questions", () => {
    const answers = buildMinimalFixture();
    const result = validateAnswers(answers, q);
    expect(result.valid).toBe(true); // unanswered is allowed
    expect(result.unanswered_count).toBeGreaterThan(0);
  });

  it("detects invalid enum value", () => {
    const answers = buildAnswerSet([
      ["c04", Ans.enum("unicorn")],
    ]);
    const result = validateAnswers(answers, q);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("Invalid enum value"))).toBe(true);
  });

  it("detects type mismatch (binary answer to ternary question)", () => {
    // c14 (animal alive) expects ternary_ynu
    const answers = buildAnswerSet([
      ["c14", Ans.yes()], // binary, but c14 expects ternary
    ]);
    const result = validateAnswers(answers, q);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("ternary_ynu"))).toBe(true);
  });

  it("detects answer for unknown question id", () => {
    const answers = buildAnswerSet([
      ["c99", Ans.yes()],
    ]);
    const result = validateAnswers(answers, q);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes("unknown question id"))).toBe(true);
  });

  it("reports unanswered question ids", () => {
    const answers = buildMinimalFixture();
    const result = validateAnswers(answers, q);
    expect(result.unanswered_ids).toContain("c01");
    expect(result.unanswered_ids).not.toContain("c04");
  });

  it("detects invalid multiselect value", () => {
    const answers = buildAnswerSet([
      ["c12", Ans.multi(["fake_exposure_type"])],
    ]);
    const result = validateAnswers(answers, q);
    expect(result.valid).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PAYLOAD BUILDING
// ═══════════════════════════════════════════════════════════════════════════

describe("Canonical Case Payload Builder", () => {
  let q: Questionnaire;
  let payload: CanonicalCasePayload;

  beforeEach(() => {
    clearLoaderCache();
    q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const answers = buildRaccoonBiteFixture();
    payload = buildCanonicalPayload(answers, q);
  });

  it("produces a payload with correct schema_id", () => {
    expect(payload.schema_id).toBe("canonical_rabies_intake_v2");
  });

  it("includes intake metadata", () => {
    expect(payload.intake_metadata.question_count).toBe(44);
    expect(payload.intake_metadata.answered_count).toBeGreaterThan(10);
  });

  it("includes all sections", () => {
    expect(payload.sections).toHaveLength(14);
  });

  it("includes classification buckets", () => {
    expect(payload.classification_buckets.length).toBeGreaterThan(0);
    const core = payload.classification_buckets.find(
      (b) => b.classification === "core",
    );
    expect(core).toBeDefined();
    expect(core!.question_ids.length).toBeGreaterThan(0);
  });

  it("includes source traces", () => {
    expect(payload.source_traces).toHaveLength(44);
    const first = payload.source_traces[0];
    expect(first).toHaveProperty("question_id");
    expect(first).toHaveProperty("who_ids");
    expect(first).toHaveProperty("on_ids");
  });

  it("includes derived facts", () => {
    expect(payload.derived_facts.length).toBeGreaterThan(0);
    const isMammal = payload.derived_facts.find(
      (df) => df.fact_id === "df_is_mammal",
    );
    expect(isMammal).toBeDefined();
    expect(isMammal!.value).toBe(true); // raccoon is a mammal
  });

  it("marks unresolved fields for unanswered core questions", () => {
    expect(payload.unresolved_fields.length).toBeGreaterThan(0);
  });

  it("includes assessment placeholder", () => {
    expect(payload.assessment_placeholder.status).toBe("awaiting_canonical_flow");
    expect(payload.assessment_placeholder.placeholder_recommendation).toBe(
      "manual_review_required",
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. PLACEHOLDER ASSESSMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("Placeholder Assessment", () => {
  let assessment: PlaceholderAssessment;

  beforeEach(() => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    assessment = generatePlaceholderAssessment(payload);
  });

  it("has placeholder_assessment_generated status", () => {
    expect(assessment.status).toBe("placeholder_assessment_generated");
  });

  it("has a recommendation code", () => {
    expect(["manual_review_required", "rabies_flow_pending", "insufficient_logic_available"]).toContain(
      assessment.recommendation_code,
    );
  });

  it("includes rationale with flow dependency", () => {
    expect(assessment.rationale.flow_dependency).toContain("not yet finalized");
  });

  it("includes TODO markers", () => {
    expect(assessment.todo_markers.length).toBeGreaterThan(0);
    expect(assessment.todo_markers[0]).toContain("TODO");
  });

  it("includes derived facts snapshot", () => {
    expect(assessment.derived_facts_snapshot.length).toBeGreaterThan(0);
  });

  it("reports risk signals for bat exposure", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildBatExposureFixture(), q);
    const a = generatePlaceholderAssessment(payload);
    expect(a.risk_signals).toContain("bat_exposure_detected");
    expect(a.risk_signals).toContain("relevant_exposure_present");
    expect(a.risk_signals).toContain("high_priority_victim");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. RENDERERS
// ═══════════════════════════════════════════════════════════════════════════

describe("Clinician Renderer", () => {
  it("produces a note draft and structured summary", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    const assessment = generatePlaceholderAssessment(payload);
    const output = renderClinicianIntake(payload, assessment);

    expect(output.note_draft).toContain("RABIES PEP INTAKE");
    expect(output.note_draft).toContain("DECISION LOGIC PENDING");
    expect(output.structured_summary.schema_id).toBe("canonical_rabies_intake_v2");
    expect(output.structured_summary.sections.length).toBeGreaterThan(0);
  });
});

describe("Public Health Renderer", () => {
  it("produces a report and structured data", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    const assessment = generatePlaceholderAssessment(payload);
    const output = renderPublicHealth(payload, assessment);

    expect(output.report_text).toContain("PUBLIC HEALTH FIELD REPORT");
    expect(output.structured.animal_summary.animal_type).toBe("raccoon");
    expect(output.structured.exposure_summary.exposure_date).toBeTruthy();
  });
});

describe("Patient Renderer", () => {
  it("produces a non-diagnostic summary", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    const assessment = generatePlaceholderAssessment(payload);
    const output = renderPatientSummary(payload, assessment);

    expect(output.text).toContain("NOT a diagnosis");
    expect(output.text).toContain("healthcare provider will review");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. ADAPTER SCAFFOLDS
// ═══════════════════════════════════════════════════════════════════════════

describe("Epic / SMART-on-FHIR Adapter", () => {
  it("produces a FHIR bundle with expected resources", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    const assessment = generatePlaceholderAssessment(payload);
    const output = buildEpicFhirOutput(payload, assessment);

    expect(output.bundle.resourceType).toBe("Bundle");
    expect(output.questionnaire.resourceType).toBe("Questionnaire");
    expect(output.questionnaire_response.resourceType).toBe("QuestionnaireResponse");
    expect(output.task.resourceType).toBe("Task");
    expect(output.observations.length).toBeGreaterThan(0);
    expect(output.launch_context_placeholder.iss).toContain("epic");
  });
});

describe("OpenEMR Adapter", () => {
  it("produces intake summary, chart note, and FHIR payloads", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    const assessment = generatePlaceholderAssessment(payload);
    const output = buildOpenEmrOutput(payload, assessment);

    expect(output.intake_summary).toContain("OpenEMR");
    expect(output.chart_note).toContain("CLINICAL NOTE");
    expect(output.fhir_encounter).toHaveProperty("resourceType", "Encounter");
    expect(output.fhir_questionnaire_response).toHaveProperty(
      "resourceType",
      "QuestionnaireResponse",
    );
    expect(output.fhir_observations.length).toBeGreaterThan(0);
  });
});

describe("SORMAS Adapter", () => {
  it("produces case export with exposure data", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    const assessment = generatePlaceholderAssessment(payload);
    const output = buildSormasOutput(payload, assessment);

    expect(output.case_data.disease).toBe("RABIES");
    expect(output.case_data.caseClassification).toBe("SUSPECT");
    expect(output.case_data.epiData.exposures).toHaveLength(1);
    expect(output.case_data.epiData.exposures[0].exposureType).toBe("ANIMAL_CONTACT");
    expect(output.animal_exposure_detail.animal_type).toBe("raccoon");
    expect(output.public_health_notes).toContain("SORMAS");
  });
});

describe("DHIS2 Adapter", () => {
  it("produces tracker payload with events and data elements", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const payload = buildCanonicalPayload(buildRaccoonBiteFixture(), q);
    const assessment = generatePlaceholderAssessment(payload);
    const output = buildDhis2Output(payload, assessment);

    expect(output.trackerPayload.trackedEntities).toHaveLength(1);
    expect(output.trackerPayload.enrollments).toHaveLength(1);
    expect(output.trackerPayload.events.length).toBeGreaterThan(0);
    expect(output.manifest.dataElements.length).toBe(44);
    expect(output.manifest.program.name).toBe("Animal Exposure Intake and Follow-up");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. MAPPING MANIFEST
// ═══════════════════════════════════════════════════════════════════════════

describe("Mapping Manifest", () => {
  it("generates manifests for all questions", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const manifest = generateMappingManifest(q);

    expect(manifest.question_count).toBe(44);
    expect(manifest.intake_to_payload).toHaveLength(44);
    expect(manifest.intake_to_renderer).toHaveLength(44);
    expect(manifest.intake_to_platform).toHaveLength(44);
  });

  it("shows derived fact mapping for c04", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const manifest = generateMappingManifest(q);
    const c04 = manifest.intake_to_payload.find(
      (m) => m.canonical_question_id === "c04",
    );
    expect(c04!.derived_fact_id).toContain("df_is_mammal");
  });

  it("shows platform mapping for all adapters", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const manifest = generateMappingManifest(q);
    const first = manifest.intake_to_platform[0];
    expect(first).toHaveProperty("epic_fhir");
    expect(first).toHaveProperty("openemr");
    expect(first).toHaveProperty("sormas");
    expect(first).toHaveProperty("dhis2");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. END-TO-END FIXTURES
// ═══════════════════════════════════════════════════════════════════════════

describe("End-to-End: Raccoon bite", () => {
  it("runs the full pipeline from intake to all outputs", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const answers = buildRaccoonBiteFixture();

    // Validate
    const validation = validateAnswers(answers, q);
    expect(validation.valid).toBe(true);

    // Build payload
    const payload = buildCanonicalPayload(answers, q);
    expect(payload.schema_id).toBe("canonical_rabies_intake_v2");

    // Generate assessment
    const assessment = generatePlaceholderAssessment(payload);
    expect(assessment.status).toBe("placeholder_assessment_generated");

    // Renderers
    const clinician = renderClinicianIntake(payload, assessment);
    expect(clinician.note_draft.length).toBeGreaterThan(100);

    const ph = renderPublicHealth(payload, assessment);
    expect(ph.structured.animal_summary.animal_type).toBe("raccoon");

    const patient = renderPatientSummary(payload, assessment);
    expect(patient.text).toContain("NOT a diagnosis");

    // Adapters
    const epic = buildEpicFhirOutput(payload, assessment);
    expect(epic.bundle.resourceType).toBe("Bundle");

    const openemr = buildOpenEmrOutput(payload, assessment);
    expect(openemr.fhir_encounter).toHaveProperty("resourceType");

    const sormas = buildSormasOutput(payload, assessment);
    expect(sormas.case_data.disease).toBe("RABIES");

    const dhis2 = buildDhis2Output(payload, assessment);
    expect(dhis2.trackerPayload.events.length).toBeGreaterThan(0);
  });
});

describe("End-to-End: Bat exposure", () => {
  it("runs the full pipeline with bat-specific risk signals", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const answers = buildBatExposureFixture();

    const validation = validateAnswers(answers, q);
    expect(validation.valid).toBe(true);

    const payload = buildCanonicalPayload(answers, q);
    const assessment = generatePlaceholderAssessment(payload);

    // Bat signals should be detected
    expect(assessment.risk_signals).toContain("bat_exposure_detected");
    expect(assessment.risk_signals).toContain("high_priority_victim");

    // All adapters should render
    const epic = buildEpicFhirOutput(payload, assessment);
    expect((epic.bundle as Record<string, unknown>).entry).toBeDefined();

    const sormas = buildSormasOutput(payload, assessment);
    expect(sormas.animal_exposure_detail.bat_involved).toBe(true);

    const dhis2 = buildDhis2Output(payload, assessment);
    expect(dhis2.trackerPayload.events.length).toBeGreaterThan(0);
  });
});

describe("End-to-End: Minimal intake", () => {
  it("handles minimal answers gracefully", () => {
    clearLoaderCache();
    const q = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
    const answers = buildMinimalFixture();

    const validation = validateAnswers(answers, q);
    expect(validation.valid).toBe(true);
    expect(validation.unanswered_count).toBeGreaterThan(40);

    const payload = buildCanonicalPayload(answers, q);
    expect(payload.unresolved_fields.length).toBeGreaterThan(30);

    const assessment = generatePlaceholderAssessment(payload);
    expect(["manual_review_required", "insufficient_logic_available"]).toContain(
      assessment.recommendation_code,
    );

    // All adapters should still produce valid output
    const epic = buildEpicFhirOutput(payload, assessment);
    expect(epic.bundle.resourceType).toBe("Bundle");

    const openemr = buildOpenEmrOutput(payload, assessment);
    expect(openemr.chart_note).toContain("Decision logic pending");

    const sormas = buildSormasOutput(payload, assessment);
    expect(sormas.case_data.disease).toBe("RABIES");

    const dhis2 = buildDhis2Output(payload, assessment);
    expect(dhis2.manifest.program.uid).toBe("RADE_PROG_001");
  });
});
