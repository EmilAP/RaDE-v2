// ---------------------------------------------------------------------------
// rade-v2 — DHIS2 adapter + mapping tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadCanonicalIntake,
  clearLoaderCache,
} from "../intake/loader.js";
import { buildQuestionnaire, type Questionnaire } from "../intake/questionnaire.js";
import { buildAnswerSet, Ans, type IntakeAnswerSet } from "../intake/answers.js";
import { buildCanonicalPayload, type CanonicalCasePayload } from "../intake/payload.js";
import {
  generatePlaceholderAssessment,
  type PlaceholderAssessment,
} from "../intake/assessment.js";

import {
  buildDhis2Output,
  buildFollowUpEvent,
  type Dhis2Output,
} from "../adapters/dhis2-tracker.js";

import {
  generateDhis2Manifest,
  DHIS2_PROGRAM,
  DHIS2_PROGRAM_STAGES,
  DHIS2_TRACKED_ENTITY_TYPE,
  TEI_ATTRIBUTES,
  getDataElementUid,
  type Dhis2MappingManifest,
} from "../manifests/dhis2-mapping.js";

// ── Helpers ────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTAKE_PATH = resolve(
  __dirname,
  "../data/canonical/canonical_rabies_intake_v2.json",
);

let questionnaire: Questionnaire;
let raccoonPayload: CanonicalCasePayload;
let raccoonAssessment: PlaceholderAssessment;
let raccoonDhis2: Dhis2Output;

function buildRaccoonBiteAnswers(): IntakeAnswerSet {
  return buildAnswerSet([
    ["c01", Ans.no()],
    ["c02", Ans.datetime("2026-04-05T10:30:00Z")],
    ["c03", Ans.text("Hamilton, Ontario, Canada")],
    ["c04", Ans.enum("raccoon")],
    ["c05", Ans.yes()],
    ["c12", Ans.multi(["bite_transdermal_or_bleeding"])],
    ["c13", Ans.multi(["upper_extremity"])],
    ["c14", Ans.ternary("unknown")],
    ["c15", Ans.no()],
    ["c16", Ans.no()],
    ["c17", Ans.yes()],
    ["c18", Ans.ternary("unknown")],
    ["c21", Ans.yes()],
    ["c25", Ans.ternary("no")],
    ["c29", Ans.ternary("no")],
    ["c37", Ans.ternary("no")],
    ["c44", Ans.ternary("no")],
  ]);
}

function buildMinimalAnswers(): IntakeAnswerSet {
  return buildAnswerSet([
    ["c03", Ans.text("Unknown")],
    ["c04", Ans.enum("dog")],
  ]);
}

beforeEach(() => {
  clearLoaderCache();
  questionnaire = buildQuestionnaire(loadCanonicalIntake(INTAKE_PATH).data);
  const answers = buildRaccoonBiteAnswers();
  raccoonPayload = buildCanonicalPayload(answers, questionnaire);
  raccoonAssessment = generatePlaceholderAssessment(raccoonPayload);
  raccoonDhis2 = buildDhis2Output(raccoonPayload, raccoonAssessment);
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. MAPPING MANIFEST
// ═══════════════════════════════════════════════════════════════════════════

describe("DHIS2 Mapping Manifest", () => {
  it("generates a manifest with all canonical questions", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    expect(manifest.dataElements.length).toBe(questionnaire.questions.length);
  });

  it("maps program metadata correctly", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    expect(manifest.program.uid).toBe("RADE_PROG_001");
    expect(manifest.program.programType).toBe("WITH_REGISTRATION");
    expect(manifest.trackedEntityType.uid).toBe("RADE_TET_PERSON");
  });

  it("defines 3 program stages", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    const stages = manifest.programStages;
    expect(stages.exposureIntake.uid).toBe("RADE_PS_INTAKE");
    expect(stages.assessmentDisposition.uid).toBe("RADE_PS_ASSESS");
    expect(stages.followUpVisit.uid).toBe("RADE_PS_FOLLOWUP");
  });

  it("marks exposure intake as non-repeatable and follow-up as repeatable", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    expect(manifest.programStages.exposureIntake.repeatable).toBe(false);
    expect(manifest.programStages.assessmentDisposition.repeatable).toBe(true);
    expect(manifest.programStages.followUpVisit.repeatable).toBe(true);
  });

  it("assigns all intake data elements to the intake stage", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    for (const de of manifest.dataElements) {
      expect(de.programStageUid).toBe(DHIS2_PROGRAM_STAGES.exposureIntake.uid);
    }
  });

  it("creates option sets for ternary questions", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    const ynu = manifest.optionSets.find((os) => os.uid === "RADE_OS_YNU");
    expect(ynu).toBeDefined();
    expect(ynu!.options).toHaveLength(3);
    expect(ynu!.options.map((o) => o.code)).toEqual(["yes", "no", "unknown"]);
  });

  it("creates option sets for enum questions with defined options", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    // c04 has enum options
    const c04De = manifest.dataElements.find((de) => de.canonicalQuestionId === "c04");
    expect(c04De).toBeDefined();
    if (c04De?.optionSetUid) {
      const os = manifest.optionSets.find((o) => o.uid === c04De.optionSetUid);
      expect(os).toBeDefined();
      expect(os!.options.length).toBeGreaterThan(0);
    }
  });

  it("generates data element UIDs from question IDs", () => {
    expect(getDataElementUid("c01")).toBe("RADE_DE_C01");
    expect(getDataElementUid("c44")).toBe("RADE_DE_C44");
  });

  it("includes TEI attributes", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    expect(manifest.teiAttributes.length).toBe(TEI_ATTRIBUTES.length);
    expect(manifest.teiAttributes.find((a) => a.uid === "RADE_ATTR_FNAME")).toBeDefined();
    expect(manifest.teiAttributes.find((a) => a.uid === "RADE_ATTR_CASEID")).toBeDefined();
  });

  it("includes assessment fields", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    expect(manifest.assessmentFields.length).toBeGreaterThan(0);
    const statusField = manifest.assessmentFields.find(
      (f) => f.uid === "RADE_DE_ASSESS_STATUS",
    );
    expect(statusField).toBeDefined();
    expect(statusField!.programStageUid).toBe(DHIS2_PROGRAM_STAGES.assessmentDisposition.uid);
  });

  it("includes follow-up fields", () => {
    const manifest = generateDhis2Manifest(questionnaire);
    expect(manifest.followUpFields.length).toBeGreaterThan(0);
    const doseField = manifest.followUpFields.find(
      (f) => f.uid === "RADE_DE_FU_DOSE",
    );
    expect(doseField).toBeDefined();
    expect(doseField!.programStageUid).toBe(DHIS2_PROGRAM_STAGES.followUpVisit.uid);
  });

  it("maps value types correctly", () => {
    const manifest = generateDhis2Manifest(questionnaire);

    // binary_yn → BOOLEAN
    const c01 = manifest.dataElements.find((de) => de.canonicalQuestionId === "c01");
    expect(c01?.valueType).toBe("BOOLEAN");

    // ternary_ynu → TEXT (with option set)
    const c14 = manifest.dataElements.find((de) => de.canonicalQuestionId === "c14");
    expect(c14?.valueType).toBe("TEXT");
    expect(c14?.optionSetUid).toBe("RADE_OS_YNU");

    // multiselect_any → LONG_TEXT
    const c12 = manifest.dataElements.find((de) => de.canonicalQuestionId === "c12");
    expect(c12?.valueType).toBe("LONG_TEXT");

    // datetime → DATETIME
    const c02 = manifest.dataElements.find((de) => de.canonicalQuestionId === "c02");
    expect(c02?.valueType).toBe("DATETIME");

    // free_text → LONG_TEXT
    const c03 = manifest.dataElements.find((de) => de.canonicalQuestionId === "c03");
    expect(c03?.valueType).toBe("LONG_TEXT");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. TRACKER PAYLOAD GENERATION
// ═══════════════════════════════════════════════════════════════════════════

describe("DHIS2 Tracker Payload", () => {
  it("produces a valid tracker payload structure", () => {
    const tp = raccoonDhis2.trackerPayload;
    expect(tp.trackedEntities).toHaveLength(1);
    expect(tp.enrollments).toHaveLength(1);
    expect(tp.events.length).toBeGreaterThanOrEqual(2);
  });

  it("sets tracked entity type and org unit", () => {
    const tei = raccoonDhis2.trackerPayload.trackedEntities[0];
    expect(tei.trackedEntityType).toBe(DHIS2_TRACKED_ENTITY_TYPE.uid);
    expect(tei.orgUnit).toBe("PLACEHOLDER_ORG_UNIT");
  });

  it("links enrollment to tracked entity and program", () => {
    const enr = raccoonDhis2.trackerPayload.enrollments[0];
    const tei = raccoonDhis2.trackerPayload.trackedEntities[0];
    expect(enr.trackedEntity).toBe(tei.trackedEntity);
    expect(enr.program).toBe(DHIS2_PROGRAM.uid);
    expect(enr.status).toBe("ACTIVE");
  });

  it("creates an intake event with data values", () => {
    const intakeEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.exposureIntake.uid,
    );
    expect(intakeEvent).toBeDefined();
    expect(intakeEvent!.dataValues.length).toBeGreaterThan(0);
    expect(intakeEvent!.status).toBe("COMPLETED");
  });

  it("creates an assessment event with placeholder fields", () => {
    const assessEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    );
    expect(assessEvent).toBeDefined();
    expect(assessEvent!.status).toBe("ACTIVE");

    const statusDv = assessEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_ASSESS_STATUS",
    );
    expect(statusDv).toBeDefined();
    expect(statusDv!.value).toBe("flow_pending");

    const recommendDv = assessEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_RECOMMEND",
    );
    expect(recommendDv).toBeDefined();
  });

  it("includes assessment notes about placeholder status", () => {
    const assessEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    );
    expect(assessEvent?.notes).toBeDefined();
    expect(assessEvent!.notes!.length).toBeGreaterThan(0);
    expect(assessEvent!.notes![0].value).toContain("Placeholder");
  });

  it("serializes binary answers as boolean strings", () => {
    const intakeEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.exposureIntake.uid,
    );
    // c01 is binary_yn "no" → should be "false"
    const c01Dv = intakeEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_C01",
    );
    expect(c01Dv).toBeDefined();
    expect(c01Dv!.value).toBe("false");
  });

  it("serializes multiselect answers as pipe-delimited", () => {
    const intakeEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.exposureIntake.uid,
    );
    const c12Dv = intakeEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_C12",
    );
    expect(c12Dv).toBeDefined();
    // Single value, no pipe needed
    expect(c12Dv!.value).toBe("bite_transdermal_or_bleeding");
  });

  it("serializes datetime answers as ISO strings", () => {
    const intakeEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.exposureIntake.uid,
    );
    const c02Dv = intakeEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_C02",
    );
    expect(c02Dv).toBeDefined();
    expect(c02Dv!.value).toBe("2026-04-05T10:30:00Z");
  });

  it("skips unanswered questions in data values", () => {
    const intakeEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.exposureIntake.uid,
    );
    // c24 is not answered in the raccoon fixture
    const c24Dv = intakeEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_C24",
    );
    expect(c24Dv).toBeUndefined();
  });

  it("includes demographics in TEI attributes when provided", () => {
    const output = buildDhis2Output(raccoonPayload, raccoonAssessment, "OU_TEST", {
      firstName: "Jane",
      lastName: "Doe",
      dateOfBirth: "1992-03-15",
    });
    const attrs = output.trackerPayload.trackedEntities[0].attributes;
    expect(attrs.find((a) => a.attribute === "RADE_ATTR_FNAME")?.value).toBe("Jane");
    expect(attrs.find((a) => a.attribute === "RADE_ATTR_LNAME")?.value).toBe("Doe");
    expect(attrs.find((a) => a.attribute === "RADE_ATTR_DOB")?.value).toBe("1992-03-15");
  });

  it("always includes case ID in TEI attributes", () => {
    const attrs = raccoonDhis2.trackerPayload.trackedEntities[0].attributes;
    const caseId = attrs.find((a) => a.attribute === "RADE_ATTR_CASEID");
    expect(caseId).toBeDefined();
    expect(caseId!.value).toContain("RADE_TEI_");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FOLLOW-UP EVENTS
// ═══════════════════════════════════════════════════════════════════════════

describe("DHIS2 Follow-up Events", () => {
  it("builds a follow-up event with correct structure", () => {
    const evt = buildFollowUpEvent(
      "RADE_TEI_test",
      "test_payload",
      "OU_TEST",
      {
        visitDate: "2026-04-05",
        visitType: "vaccine_dose",
        doseNumber: 1,
        rigAdministered: true,
        outcomeStatus: "on_schedule",
        notes: "Day 0 dose",
      },
      0,
    );

    expect(evt.programStage).toBe(DHIS2_PROGRAM_STAGES.followUpVisit.uid);
    expect(evt.trackedEntity).toBe("RADE_TEI_test");
    expect(evt.status).toBe("ACTIVE");
    expect(evt.dataValues.length).toBe(6); // date, type, dose, rig, outcome, notes
  });

  it("sets status to COMPLETED when outcome is completed", () => {
    const evt = buildFollowUpEvent(
      "RADE_TEI_test",
      "test_payload",
      "OU_TEST",
      {
        visitDate: "2026-05-03",
        visitType: "case_closure",
        outcomeStatus: "completed",
      },
      4,
    );

    expect(evt.status).toBe("COMPLETED");
  });

  it("handles minimal follow-up input", () => {
    const evt = buildFollowUpEvent(
      "RADE_TEI_test",
      "test_payload",
      "OU_TEST",
      {
        visitDate: "2026-04-08",
        visitType: "vaccine_dose",
      },
      1,
    );

    expect(evt.dataValues.length).toBe(2); // date + type only
  });

  it("generates unique event IDs per index", () => {
    const evt0 = buildFollowUpEvent("t", "p", "o", { visitDate: "2026-04-05", visitType: "vaccine_dose" }, 0);
    const evt1 = buildFollowUpEvent("t", "p", "o", { visitDate: "2026-04-08", visitType: "vaccine_dose" }, 1);
    expect(evt0.event).not.toBe(evt1.event);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. VALIDATION REPORT
// ═══════════════════════════════════════════════════════════════════════════

describe("DHIS2 Validation Report", () => {
  it("flags placeholder UIDs", () => {
    const vr = raccoonDhis2.validationReport;
    expect(vr.placeholderUids.length).toBeGreaterThan(0);
    expect(vr.valid).toBe(false);
    expect(vr.readyForValidateEndpoint).toBe(false);
  });

  it("lists placeholder org unit in warnings", () => {
    const vr = raccoonDhis2.validationReport;
    expect(vr.warnings.some((w) => w.includes("orgUnit"))).toBe(true);
  });

  it("identifies unresolved core fields as missing", () => {
    // Minimal answers → many unanswered core questions
    const minimal = buildMinimalAnswers();
    const minPayload = buildCanonicalPayload(minimal, questionnaire);
    const minAssessment = generatePlaceholderAssessment(minPayload);
    const minDhis2 = buildDhis2Output(minPayload, minAssessment);

    expect(minDhis2.validationReport.missingRequiredFields.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. PLACEHOLDER ASSESSMENT IN DHIS2
// ═══════════════════════════════════════════════════════════════════════════

describe("Placeholder Assessment in DHIS2 Output", () => {
  it("represents assessment status as flow_pending", () => {
    const assessEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    );
    const statusDv = assessEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_ASSESS_STATUS",
    );
    expect(statusDv!.value).toBe("flow_pending");
  });

  it("includes decision logic version as TBD", () => {
    const assessEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    );
    const logicDv = assessEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_LOGIC_VER",
    );
    expect(logicDv!.value).toContain("TBD");
  });

  it("derives follow-up-needed from risk signals", () => {
    const assessEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    );
    const fuDv = assessEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_FOLLOWUP_NEEDED",
    );
    expect(fuDv).toBeDefined();
    // raccoon bite should have risk signals → "yes"
    expect(["yes", "unknown"]).toContain(fuDv!.value);
  });

  it("carries risk signals as pipe-delimited string", () => {
    const assessEvent = raccoonDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.assessmentDisposition.uid,
    );
    const sigDv = assessEvent!.dataValues.find(
      (dv) => dv.dataElement === "RADE_DE_RISK_SIGNALS",
    );
    expect(sigDv).toBeDefined();
    // Should be pipe-delimited if multiple signals
    if (raccoonAssessment.risk_signals.length > 1) {
      expect(sigDv!.value).toContain("|");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. NOTES AND METADATA
// ═══════════════════════════════════════════════════════════════════════════

describe("DHIS2 Output Notes", () => {
  it("includes export notes", () => {
    expect(raccoonDhis2.notes.length).toBeGreaterThan(0);
  });

  it("mentions placeholder UID replacement", () => {
    expect(raccoonDhis2.notes.some((n) => n.includes("RADE_*"))).toBe(true);
  });

  it("mentions VALIDATE endpoint", () => {
    expect(
      raccoonDhis2.notes.some((n) => n.includes("VALIDATE")),
    ).toBe(true);
  });

  it("mentions placeholder assessment areas", () => {
    expect(
      raccoonDhis2.notes.some((n) => n.includes("flow_pending")),
    ).toBe(true);
  });

  it("includes mapping manifest in output", () => {
    expect(raccoonDhis2.manifest).toBeDefined();
    expect(raccoonDhis2.manifest.program.uid).toBe(DHIS2_PROGRAM.uid);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. MINIMAL CASE (sparse answers)
// ═══════════════════════════════════════════════════════════════════════════

describe("DHIS2 Output with Minimal Answers", () => {
  it("produces valid structure even with 2 answers", () => {
    const minimal = buildMinimalAnswers();
    const minPayload = buildCanonicalPayload(minimal, questionnaire);
    const minAssessment = generatePlaceholderAssessment(minPayload);
    const minDhis2 = buildDhis2Output(minPayload, minAssessment);

    expect(minDhis2.trackerPayload.trackedEntities).toHaveLength(1);
    expect(minDhis2.trackerPayload.enrollments).toHaveLength(1);
    expect(minDhis2.trackerPayload.events.length).toBeGreaterThanOrEqual(2);

    // Only 2 answered → 2 data values in intake event
    const intakeEvent = minDhis2.trackerPayload.events.find(
      (e) => e.programStage === DHIS2_PROGRAM_STAGES.exposureIntake.uid,
    );
    expect(intakeEvent!.dataValues.length).toBe(2);
  });
});
