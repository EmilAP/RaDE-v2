// ---------------------------------------------------------------------------
// rade-v2 — OpenEMR Standard API write flow
//
// Orchestrates: canonical payload → Standard API payloads → create encounter
// + create vitals → return structured result.
//
// The encounter (medical problem) write is the required success condition.
// The SOAP note write is best-effort: a 401 or other failure is captured as
// a warning but does NOT fail the overall submission.
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload } from "../intake/payload.js";
import type { PlaceholderAssessment } from "../intake/assessment.js";
import { buildStandardApiPayload } from "../adapters/openemr.js";
import {
  createEncounter,
  createVitals,
  createSoapNote,
  type CreateEncounterResult,
  type CreateSoapNoteResult,
} from "./openemr-client.js";

// ── Result types ───────────────────────────────────────────────────────────

export type SubmissionResult = {
  openemr_submission_status: "success" | "partial" | "failed";
  medical_problem_created: boolean;
  soap_note_created: boolean;
  encounter?: CreateEncounterResult;
  vitals_id?: string;
  soap_note?: CreateSoapNoteResult;
  warnings: string[];
  errors: string[];
};

// ── Dependency injection for testability ────────────────────────────────────

export type FlowDeps = {
  createEncounter: typeof createEncounter;
  createVitals: typeof createVitals;
  createSoapNote: typeof createSoapNote;
};

const defaultDeps: FlowDeps = { createEncounter, createVitals, createSoapNote };

// ── Write flow ─────────────────────────────────────────────────────────────

export async function runOpenEMRWriteFlow(
  puuid: string,
  patientPid: string,
  payload: CanonicalCasePayload,
  assessment: PlaceholderAssessment,
  soapNote?: { subjective: string; objective: string; assessment: string; plan: string },
  deps: FlowDeps = defaultDeps,
): Promise<SubmissionResult> {
  const warnings: string[] = [];
  const errors: string[] = [];

  const apiPayload = buildStandardApiPayload(payload, assessment);

  // ── 1. Required: Create encounter (medical problem) ──────────────────
  let enc: CreateEncounterResult;
  try {
    enc = await deps.createEncounter(puuid, apiPayload.encounter_create);
  } catch (err) {
    return {
      openemr_submission_status: "failed",
      medical_problem_created: false,
      soap_note_created: false,
      warnings,
      errors: [String(err)],
    };
  }

  // ── 2. Required: Create vitals ───────────────────────────────────────
  let vitalsId: string | undefined;
  try {
    const vitals = await deps.createVitals(puuid, enc.uuid, apiPayload.vitals_create);
    vitalsId = vitals.id;
  } catch (err) {
    return {
      openemr_submission_status: "failed",
      medical_problem_created: false,
      soap_note_created: false,
      encounter: enc,
      warnings,
      errors: [String(err)],
    };
  }

  // ── 3. Best-effort: Create SOAP note ─────────────────────────────────
  let soapResult: CreateSoapNoteResult | undefined;
  if (soapNote) {
    try {
      const encounterId = enc.uuid || enc.encounter;
      soapResult = await deps.createSoapNote(patientPid, encounterId, soapNote);
    } catch (err) {
      const msg = String(err);
      warnings.push(`SOAP note write failed (non-fatal): ${msg}`);
    }
  }

  return {
    openemr_submission_status: soapResult ? "success" : "partial",
    medical_problem_created: true,
    soap_note_created: !!soapResult,
    encounter: enc,
    vitals_id: vitalsId,
    soap_note: soapResult,
    warnings,
    errors,
  };
}
