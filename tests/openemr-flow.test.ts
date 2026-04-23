// ---------------------------------------------------------------------------
// rade-v2 — OpenEMR write flow tests
//
// Tests the submission orchestration with injected dependencies to verify:
//   1. Full success (encounter + vitals + SOAP note all succeed)
//   2. Partial success (encounter + vitals succeed, SOAP note 401)
//   3. Encounter failure (whole submission fails)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { runOpenEMRWriteFlow, type FlowDeps } from "../app/openemr-flow.js";
import { loadCanonicalIntake } from "../intake/loader.js";
import { buildQuestionnaire } from "../intake/questionnaire.js";
import { buildAnswerSet, Ans } from "../intake/answers.js";
import { buildCanonicalPayload } from "../intake/payload.js";
import { generatePlaceholderAssessment } from "../intake/assessment.js";

// ── Shared test fixtures ───────────────────────────────────────────────────

function buildTestPayload() {
  const result = loadCanonicalIntake();
  const q = buildQuestionnaire(result.data);
  const answers = buildAnswerSet([
    ["c01", Ans.no()],
    ["c04", Ans.enum("raccoon")],
    ["c12", Ans.multi(["bite_transdermal_or_bleeding"])],
  ]);
  const payload = buildCanonicalPayload(answers, q);
  const assessment = generatePlaceholderAssessment(payload);
  return { payload, assessment };
}

const soapNote = {
  subjective: "Patient bitten by raccoon",
  objective: "Bite wound on right hand",
  assessment: "Rabies exposure risk: moderate",
  plan: "Initiate PEP protocol",
};

// ── Stub deps ──────────────────────────────────────────────────────────────

function successDeps(): FlowDeps {
  return {
    createEncounter: async () => ({ uuid: "enc-uuid-123", encounter: "42" }),
    createVitals: async () => ({ id: "vitals-7" }),
    createSoapNote: async () => ({ id: "soap-99" }),
  };
}

function soapFailDeps(): FlowDeps {
  return {
    createEncounter: async () => ({ uuid: "enc-uuid-456", encounter: "43" }),
    createVitals: async () => ({ id: "vitals-8" }),
    createSoapNote: async () => {
      throw new Error("Create SOAP note failed (401): Unauthorized");
    },
  };
}

function encounterFailDeps(): FlowDeps {
  return {
    createEncounter: async () => {
      throw new Error("Create encounter failed (500): Internal Server Error");
    },
    createVitals: async () => ({ id: "vitals-never" }),
    createSoapNote: async () => ({ id: "soap-never" }),
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("OpenEMR write flow", () => {
  const { payload, assessment } = buildTestPayload();

  it("full success: encounter + vitals + SOAP note", async () => {
    const result = await runOpenEMRWriteFlow(
      "patient-uuid-1",
      "pid-1",
      payload,
      assessment,
      soapNote,
      successDeps(),
    );

    expect(result.openemr_submission_status).toBe("success");
    expect(result.medical_problem_created).toBe(true);
    expect(result.soap_note_created).toBe(true);
    expect(result.encounter).toEqual({ uuid: "enc-uuid-123", encounter: "42" });
    expect(result.vitals_id).toBe("vitals-7");
    expect(result.soap_note).toEqual({ id: "soap-99" });
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("partial success: encounter + vitals succeed, SOAP note 401", async () => {
    const result = await runOpenEMRWriteFlow(
      "patient-uuid-2",
      "pid-2",
      payload,
      assessment,
      soapNote,
      soapFailDeps(),
    );

    expect(result.openemr_submission_status).toBe("partial");
    expect(result.medical_problem_created).toBe(true);
    expect(result.soap_note_created).toBe(false);
    expect(result.encounter).toEqual({ uuid: "enc-uuid-456", encounter: "43" });
    expect(result.vitals_id).toBe("vitals-8");
    expect(result.soap_note).toBeUndefined();
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("SOAP note write failed");
    expect(result.warnings[0]).toContain("401");
    expect(result.errors).toEqual([]);
  });

  it("failure: encounter creation fails → whole submission fails", async () => {
    const result = await runOpenEMRWriteFlow(
      "patient-uuid-3",
      "pid-3",
      payload,
      assessment,
      soapNote,
      encounterFailDeps(),
    );

    expect(result.openemr_submission_status).toBe("failed");
    expect(result.medical_problem_created).toBe(false);
    expect(result.soap_note_created).toBe(false);
    expect(result.encounter).toBeUndefined();
    expect(result.vitals_id).toBeUndefined();
    expect(result.warnings).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Create encounter failed");
  });

  it("partial success without SOAP note param → no SOAP attempt", async () => {
    const result = await runOpenEMRWriteFlow(
      "patient-uuid-4",
      "pid-4",
      payload,
      assessment,
      undefined, // no SOAP note
      successDeps(),
    );

    expect(result.openemr_submission_status).toBe("partial");
    expect(result.medical_problem_created).toBe(true);
    expect(result.soap_note_created).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
