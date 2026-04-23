// ---------------------------------------------------------------------------
// rade-v2 — Intake routes (Hono)
//
// GET  /intake              → serve intake form HTML
// GET  /intake/questions    → canonical questionnaire as JSON
// GET  /intake/patients     → list OpenEMR test patients
// POST /intake/submit       → process answers → create consult (+ optional OpenEMR)
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadCanonicalIntake } from "../intake/loader.js";
import { buildQuestionnaire, type Questionnaire } from "../intake/questionnaire.js";
import {
  buildAnswerSet,
  withProvenance,
  Ans,
  type IntakeActorCapture,
  type IntakeAnswerSet,
} from "../intake/answers.js";
import { buildCanonicalPayload } from "../intake/payload.js";
import { generatePlaceholderAssessment } from "../intake/assessment.js";
import { renderClinicianIntake } from "../renderers/clinician-v2.js";
import { renderPublicHealth } from "../renderers/public-health.js";
import type { ActorRef, ProvenancedAnswer } from "../core/consult/types.js";
import { getConsultService, getConsultTransformRegistry } from "./consult-runtime.js";
import { renderConsultStatusPage } from "./consult-status-page.js";
import { listPatients } from "./openemr-client.js";
import { runOpenEMRWriteFlow } from "./openemr-flow.js";

// ── Questionnaire loader ───────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const INTAKE_PATH = resolve(
  __dirname,
  "../data/canonical/canonical_rabies_intake_v2.json",
);

function getQuestionnaire(): Questionnaire {
  const result = loadCanonicalIntake(INTAKE_PATH);
  if (!result.valid) throw new Error("Canonical intake failed validation");
  return buildQuestionnaire(result.data);
}

// ── Routes ─────────────────────────────────────────────────────────────────

const intake = new Hono();
const consultService = getConsultService();
const registry = getConsultTransformRegistry();

const BAT_SPECIFIC_QUESTION_IDS = ["c05", "c06", "c07", "c08", "c09", "c10", "c11"];

// Serve questionnaire structure as JSON for the form to consume
intake.get("/questions", (c) => {
  const q = getQuestionnaire();
  return c.json({
    schema_id: q.schema_id,
    sections: q.sections.map((s) => ({
      id: s.id,
      title: s.title,
      questions: s.question_ids.map((qid) => {
        const qm = q.questions.find((x) => x.id === qid)!;
        return {
          id: qm.id,
          text: qm.text,
          section_id: qm.section_id,
          response_type: qm.response.type,
          options: qm.response.option_values,
          items: qm.response.items,
          classification: qm.classification,
        };
      }),
    })),
  });
});

// List available patients from OpenEMR
intake.get("/patients", async (c) => {
  try {
    const patients = await listPatients();
    return c.json({ patients });
  } catch (err) {
    const detail = String(err);
    const error = detail.includes("401") || detail.includes("Token request failed")
      ? "OpenEMR authentication failed"
      : "Could not reach OpenEMR";
    return c.json(
      { error, detail },
      502,
    );
  }
});

// Process intake submission → create consult and optionally project to OpenEMR
intake.post("/submit", async (c) => {
  const body = await c.req.json<{
    patient_uuid?: string;
    patient_pid?: string;
    answers: Record<string, unknown>;
    narrative_input?: string;
    idempotency_key?: string;
  }>();

  if (!body.answers) {
    return c.json({ error: "Required: answers" }, 400);
  }

  const intakeConstraintWarnings = getIntakeConstraintWarnings(body.answers);
  if (intakeConstraintWarnings.length > 0) {
    return c.json(
      {
        error: "Intake answers contain contradictory exposure context.",
        warnings: intakeConstraintWarnings,
      },
      400,
    );
  }

  const clinicianActor = createClinicianActor();

  // 1. Map raw form answers into IntakeAnswerSet
  const q = getQuestionnaire();
  const answerSet = mapFormAnswers(body.answers, q, clinicianActor);

  // 2. Run canonical pipeline
  const payload = buildCanonicalPayload(answerSet, q);
  const consultView = consultService.submitConsult({
    idempotency_key: body.idempotency_key ?? randomUUID(),
    submitter: {
      actor_id: clinicianActor.actor_id,
      role: "clinician_submitter",
      display_name: clinicianActor.display_name,
      organization_id: clinicianActor.organization_id,
    },
    submitted_answers: buildSubmittedAnswerRecord(answerSet),
    narrative_input: body.narrative_input,
  });
  const assessment = generatePlaceholderAssessment(payload);
  const clinician = renderClinicianIntake(payload, assessment);
  const ph = renderPublicHealth(payload, assessment);

  // 3. Build SOAP note from clinician output
  const soapNote = buildSoapFromClinicianOutput(clinician.note_draft, payload, assessment);

  // 4. Optionally project to OpenEMR when a patient is selected
  const openemrResult = body.patient_uuid && body.patient_pid
    ? await runOpenEMRWriteFlow(
        body.patient_uuid,
        body.patient_pid,
        payload,
        assessment,
        soapNote,
      )
    : null;

  return c.json({
    consult: {
      consult_id: consultView.consult.consult_id,
      current_state: consultView.consult.current_state,
      automation_mode: consultView.consult.automation_mode,
      status_url: `/intake/consults/${consultView.consult.consult_id}/status`,
    },
    automation_resolution: consultView.automation_resolution,
    openemr: openemrResult,
    openemr_projection_status: openemrResult ? openemrResult.openemr_submission_status : "skipped",
    payload_summary: {
      schema_id: payload.schema_id,
      answered: payload.intake_metadata.answered_count,
      total: payload.intake_metadata.question_count,
      derived_facts: payload.derived_facts.length,
      risk_signals: assessment.risk_signals,
      recommendation: assessment.recommendation_code,
    },
    soap_note: soapNote,
    clinician_note: clinician.note_draft,
    public_health_report: ph.report_text,
    artifacts: registry.list(),
  });
});

intake.get("/consults/:consultId/status", (c) => {
  try {
    const view = consultService.getConsult(c.req.param("consultId"));
    return c.html(renderConsultStatusPage({
      view,
      artifacts: registry.list(),
    }));
  } catch (error) {
    return c.html(`<!DOCTYPE html><html><body><p>${String(error)}</p></body></html>`, 404);
  }
});

// Serve the intake form HTML
intake.get("/", (c) => {
  return c.html(INTAKE_HTML);
});

export default intake;

export function getIntakeConstraintWarnings(rawAnswers: Record<string, unknown>): string[] {
  const warnings: string[] = [];
  const species = typeof rawAnswers.c04 === "string" ? rawAnswers.c04 : undefined;

  if (species && species !== "bat" && species !== "unknown") {
    const answeredBatQuestions = BAT_SPECIFIC_QUESTION_IDS.filter((questionId) => {
      const value = rawAnswers[questionId];
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && value !== "";
    });

    if (answeredBatQuestions.length > 0) {
      warnings.push(
        "Bat-specific exposure questions cannot be answered when the selected species is a clear non-bat exposure. Review the species selection or clear the bat section.",
      );
    }
  }

  return warnings;
}

// ── Form answer mapping ────────────────────────────────────────────────────
// Maps { c01: "yes", c04: "raccoon", c12: ["bite_transdermal_or_bleeding"] }
// into IntakeAnswerSet using the Ans constructors.

function mapFormAnswers(
  raw: Record<string, unknown>,
  q: Questionnaire,
  actor: IntakeCapturedActor,
): IntakeAnswerSet {
  const entries: Array<[string, ReturnType<typeof withProvenance>]> = [];

  for (const [qid, value] of Object.entries(raw)) {
    if (value === null || value === undefined || value === "") continue;

    const qm = q.questions.find((x) => x.id === qid);
    if (!qm) continue;

    const rt = qm.response.type;
    const capturedAt = new Date().toISOString();
    const sourceModality = rt === "free_text" || rt === "datetime" ? "typed" : "clicked";

    if (rt === "binary_yn") {
      entries.push([qid, withProvenance(value === "yes" ? Ans.yes() : Ans.no(), {
        source_modality: sourceModality,
        captured_by: actor,
        captured_at: capturedAt,
        last_confirmed_by: actor,
        last_confirmed_at: capturedAt,
      })]);
    } else if (rt === "ternary_ynu") {
      entries.push([qid, withProvenance(Ans.ternary(value as "yes" | "no" | "unknown"), {
        source_modality: sourceModality,
        captured_by: actor,
        captured_at: capturedAt,
        last_confirmed_by: actor,
        last_confirmed_at: capturedAt,
      })]);
    } else if (rt === "enum" || rt === "count_enum") {
      entries.push([qid, withProvenance(
        rt === "count_enum" ? Ans.countEnum(value as string) : Ans.enum(value as string),
        {
          source_modality: sourceModality,
          captured_by: actor,
          captured_at: capturedAt,
          last_confirmed_by: actor,
          last_confirmed_at: capturedAt,
        },
      )]);
    } else if (rt === "multiselect_any") {
      const vals = Array.isArray(value) ? value as string[] : [value as string];
      entries.push([qid, withProvenance(Ans.multi(vals), {
        source_modality: sourceModality,
        captured_by: actor,
        captured_at: capturedAt,
        last_confirmed_by: actor,
        last_confirmed_at: capturedAt,
      })]);
    } else if (rt === "datetime") {
      entries.push([qid, withProvenance(Ans.datetime(value as string), {
        source_modality: sourceModality,
        captured_by: actor,
        captured_at: capturedAt,
        last_confirmed_by: actor,
        last_confirmed_at: capturedAt,
      })]);
    } else if (rt === "free_text") {
      entries.push([qid, withProvenance(Ans.text(value as string), {
        source_modality: sourceModality,
        captured_by: actor,
        captured_at: capturedAt,
        last_confirmed_by: actor,
        last_confirmed_at: capturedAt,
      })]);
    }
  }

  return buildAnswerSet(entries);
}

function buildSubmittedAnswerRecord(
  answerSet: IntakeAnswerSet,
): Record<string, ProvenancedAnswer> {
  return Object.fromEntries(
    [...answerSet.entries()].map(([questionId, answer]) => [
      questionId,
      {
        value: answer.value,
        source_modality: answer.provenance.source_modality,
        confidence: answer.provenance.confidence,
        status: answer.provenance.status,
        captured_by: toActorRef(answer.provenance.captured_by),
        captured_at: answer.provenance.captured_at,
        last_confirmed_by: answer.provenance.last_confirmed_by
          ? toActorRef(answer.provenance.last_confirmed_by)
          : undefined,
        last_confirmed_at: answer.provenance.last_confirmed_at,
      },
    ]),
  );
}

type IntakeCapturedActor = IntakeActorCapture & ActorRef;

function createClinicianActor(): IntakeCapturedActor {
  return {
    actor_id: "intake-clinician",
    role: "clinician_submitter",
    display_name: "Clinician Submitter",
  };
}

function toActorRef(actor: IntakeActorCapture): ActorRef {
  return {
    actor_id: actor.actor_id,
    role: coerceActorRole(actor.role),
    display_name: actor.display_name,
    organization_id: actor.organization_id,
  };
}

function coerceActorRole(role: string): ActorRef["role"] {
  switch (role) {
    case "ph_reviewer":
    case "ph_supervisor":
    case "system":
      return role;
    case "clinician_submitter":
    default:
      return "clinician_submitter";
  }
}

// ── SOAP note builder ──────────────────────────────────────────────────────

function buildSoapFromClinicianOutput(
  noteDraft: string,
  payload: ReturnType<typeof buildCanonicalPayload>,
  assessment: ReturnType<typeof generatePlaceholderAssessment>,
): { subjective: string; objective: string; assessment: string; plan: string } {
  // Subjective: patient-reported exposure history
  const exposureAnswers = payload.sections
    .filter((s) => ["exposure_context", "exposure_characteristics", "exposure_timing"].includes(s.section_id))
    .flatMap((s) => s.answers.filter((a) => a.is_answered))
    .map((a) => `${a.question_id}: ${a.normalized_string}`)
    .join("\n");

  const subjective = [
    "Rabies PEP Intake — Patient-reported exposure history:",
    exposureAnswers || "(no exposure details provided)",
  ].join("\n");

  // Objective: animal / wound / clinical findings
  const objectiveAnswers = payload.sections
    .filter((s) =>
      ["animal_species", "bat_exposure_assessment", "wound_management",
       "animal_clinical_features", "animal_testing", "animal_availability_observation",
       "high_priority_features"].includes(s.section_id),
    )
    .flatMap((s) => s.answers.filter((a) => a.is_answered))
    .map((a) => `${a.question_id}: ${a.normalized_string}`)
    .join("\n");

  const derived = payload.derived_facts
    .map((df) => `• ${df.derivation}: ${JSON.stringify(df.value)}`)
    .join("\n");

  const objective = [
    "Findings from intake assessment:",
    objectiveAnswers || "(no objective findings)",
    "",
    "Derived facts:",
    derived || "(none)",
  ].join("\n");

  // Assessment: risk signals + placeholder status
  const assessmentText = [
    `Status: ${assessment.status}`,
    `Recommendation: ${assessment.recommendation_code}`,
    "",
    assessment.risk_signals.length > 0
      ? "Risk signals:\n" + assessment.risk_signals.map((s) => `• ${s}`).join("\n")
      : "No risk signals identified.",
    "",
    "⚠ Decision logic pending — manual clinical review required.",
  ].join("\n");

  // Plan
  const plan = [
    "1. Complete clinical assessment — canonical decision flow pending.",
    "2. Review derived risk factors and animal exposure details.",
    assessment.unanswered_critical_questions.length > 0
      ? `3. Obtain answers to: ${assessment.unanswered_critical_questions.join(", ")}`
      : "3. All critical questions answered.",
    "4. Determine PEP recommendation per institutional protocol.",
  ].join("\n");

  return { subjective, objective, assessment: assessmentText, plan };
}

// ── Inline HTML ────────────────────────────────────────────────────────────
// Self-contained intake form. Fetches /intake/questions on load,
// renders sections dynamically, submits to /intake/submit.

export const INTAKE_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RADE — Rabies PEP Intake</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #1a1a1a; line-height: 1.5; }
    .container { max-width: 800px; margin: 0 auto; padding: 20px; }
    h1 { font-size: 1.5rem; margin-bottom: 4px; }
    .subtitle { color: #666; font-size: 0.9rem; margin-bottom: 20px; }
    .warning { background: #fff3cd; border: 1px solid #ffc107; border-radius: 6px; padding: 12px; margin-bottom: 20px; font-size: 0.85rem; }
    .warning strong { color: #856404; }

    .patient-bar { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .patient-bar label { font-weight: 600; font-size: 0.9rem; white-space: nowrap; }
    .patient-bar select { flex: 1; min-width: 200px; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem; }
    .patient-bar .status { font-size: 0.8rem; color: #666; }

    .section { background: #fff; border: 1px solid #ddd; border-radius: 6px; margin-bottom: 16px; overflow: hidden; }
    .section-header { background: #e8f4fd; padding: 10px 16px; font-weight: 600; font-size: 0.95rem; border-bottom: 1px solid #ddd; cursor: pointer; display: flex; justify-content: space-between; }
    .section-header:hover { background: #d4ecfa; }
    .section-body { padding: 12px 16px; }
    .section-body.collapsed { display: none; }

    .question { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #f0f0f0; }
    .question:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .q-label { font-weight: 500; font-size: 0.9rem; margin-bottom: 6px; display: flex; gap: 6px; }
    .q-id { color: #888; font-size: 0.75rem; font-weight: 400; }
    .q-class { font-size: 0.7rem; padding: 1px 6px; border-radius: 3px; background: #e0e0e0; color: #555; }
    .q-class.core { background: #c8e6c9; color: #2e7d32; }

    .q-input { margin-top: 4px; }
    .q-input select, .q-input input[type="text"], .q-input input[type="datetime-local"] {
      width: 100%; max-width: 400px; padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.9rem;
    }
    .radio-group { display: flex; gap: 16px; flex-wrap: wrap; }
    .radio-group label { display: flex; align-items: center; gap: 4px; font-size: 0.9rem; cursor: pointer; }
    .checkbox-group label { display: block; margin-bottom: 4px; font-size: 0.9rem; cursor: pointer; }
    .checkbox-group label input { margin-right: 6px; }

    .actions { margin-top: 20px; display: flex; gap: 12px; }
    .btn { padding: 10px 24px; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
    .btn-primary { background: #1976d2; color: #fff; }
    .btn-primary:hover { background: #1565c0; }
    .btn-primary:disabled { background: #90caf9; cursor: not-allowed; }
    .btn-secondary { background: #e0e0e0; color: #333; }

    .result { margin-top: 20px; background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 16px; }
    .result h2 { font-size: 1.1rem; margin-bottom: 8px; }
    .result pre { background: #f8f8f8; padding: 12px; border-radius: 4px; font-size: 0.8rem; overflow-x: auto; white-space: pre-wrap; word-break: break-word; max-height: 500px; overflow-y: auto; }
    .result .success { color: #2e7d32; font-weight: 600; }
    .result .failure { color: #c62828; font-weight: 600; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #ccc; border-top-color: #1976d2; border-radius: 50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1>RADE — Rabies PEP Intake</h1>
    <p class="subtitle">Canonical intake questionnaire → consult relay with optional downstream projections</p>

    <div class="warning">
      <strong>⚠ Not a diagnostic tool.</strong> Decision logic is pending.
      This intake creates a consult for PH review and can optionally project to downstream systems.
    </div>

    <div class="patient-bar">
      <label for="patient-select">Patient (optional for OpenEMR):</label>
      <select id="patient-select"><option value="">Loading patients…</option></select>
      <span class="status" id="patient-status"></span>
    </div>

    <form id="intake-form">
      <div id="sections-container">Loading questionnaire…</div>
      <div class="section">
        <div class="section-header"><span>Clinical narrative</span><span>optional</span></div>
        <div class="section-body">
          <label class="q-label" for="narrative-input">Typed or dictated note</label>
          <textarea id="narrative-input" placeholder="Optional narrative context for public health review" style="width:100%;min-height:100px;padding:8px;border:1px solid #ccc;border-radius:4px;"></textarea>
        </div>
      </div>
      <div class="actions">
        <button type="submit" class="btn btn-primary" id="submit-btn" disabled>Submit consult</button>
        <button type="button" class="btn btn-secondary" onclick="clearForm()">Clear</button>
      </div>
    </form>

    <div id="result" class="result" style="display:none"></div>
  </div>

  <script>
    let questionnaire = null;
    const batSpecificQuestionIds = ${JSON.stringify(BAT_SPECIFIC_QUESTION_IDS)};

    // ── Load patients ──────────────────────────────────────────────
    async function loadPatients() {
      const sel = document.getElementById('patient-select');
      const st = document.getElementById('patient-status');
      try {
        const res = await fetch('/intake/patients');
        const data = await res.json();
        if (data.error) {
          sel.innerHTML = '<option value="">⚠ ' + esc(data.error) + '</option>';
          st.textContent = data.detail || data.error;
          return;
        }
        sel.innerHTML = '<option value="">— Select patient —</option>';
        for (const p of data.patients) {
          const opt = document.createElement('option');
          opt.value = p.uuid;
          opt.dataset.pid = p.pid;
          opt.textContent = p.fname + ' ' + p.lname + ' (pid: ' + p.pid + ')';
          sel.appendChild(opt);
        }
        st.textContent = data.patients.length + ' patients available';
      } catch (e) {
        sel.innerHTML = '<option value="">⚠ Could not load</option>';
        st.textContent = 'Is OpenEMR running? ' + e.message;
      }
    }

    // ── Load questionnaire ─────────────────────────────────────────
    async function loadQuestionnaire() {
      try {
        const res = await fetch('/intake/questions');
        questionnaire = await res.json();
        renderForm(questionnaire);
        document.getElementById('submit-btn').disabled = false;
      } catch (e) {
        document.getElementById('sections-container').innerHTML =
          '<p style="color:red">Failed to load questionnaire: ' + e.message + '</p>';
      }
    }

    // ── Render form from questionnaire JSON ────────────────────────
    function renderForm(q) {
      const container = document.getElementById('sections-container');
      container.innerHTML = '';

      for (const sec of q.sections) {
        if (sec.questions.length === 0) continue;
        const div = document.createElement('div');
        div.className = 'section';
        div.innerHTML =
          '<div class="section-header" onclick="this.nextElementSibling.classList.toggle(\\\'collapsed\\\')">' +
          '<span>' + esc(sec.title) + '</span><span>' + sec.questions.length + ' questions</span></div>' +
          '<div class="section-body">' +
          sec.questions.map(renderQuestion).join('') +
          '</div>';
        container.appendChild(div);
      }
    }

    function renderQuestion(q) {
      const classTag = '<span class="q-class ' + (q.classification === 'core' ? 'core' : '') + '">' + esc(q.classification) + '</span>';
      let input = '';

      if (q.response_type === 'binary_yn') {
        input = radioGroup(q.id, [['yes','Yes'],['no','No']]);
      } else if (q.response_type === 'ternary_ynu') {
        input = radioGroup(q.id, [['yes','Yes'],['no','No'],['unknown','Unknown']]);
      } else if (q.response_type === 'enum' || q.response_type === 'count_enum') {
        input = '<select name="' + q.id + '"><option value="">— select —</option>' +
          (q.options||[]).map(o => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('') +
          '</select>';
      } else if (q.response_type === 'multiselect_any') {
        const items = q.items && q.items.length ? q.items : (q.options||[]).map(o => ({value:o,label:o}));
        input = '<div class="checkbox-group">' +
          items.map(it => {
            const val = typeof it === 'string' ? it : it.value;
            const lbl = typeof it === 'string' ? it : (it.label || it.value);
            return '<label><input type="checkbox" name="' + q.id + '" value="' + esc(val) + '"> ' + esc(lbl) + '</label>';
          }).join('') + '</div>';
      } else if (q.response_type === 'datetime') {
        input = '<input type="datetime-local" name="' + q.id + '">';
      } else if (q.response_type === 'free_text') {
        input = '<input type="text" name="' + q.id + '" placeholder="Type here…">';
      }

      return '<div class="question">' +
        '<div class="q-label"><span class="q-id">' + q.id + '</span> ' + esc(q.text) + ' ' + classTag + '</div>' +
        '<div class="q-input">' + input + '</div></div>';
    }

    function radioGroup(name, options) {
      return '<div class="radio-group">' +
        options.map(([v,l]) => '<label><input type="radio" name="' + name + '" value="' + v + '"> ' + l + '</label>').join('') +
        '</div>';
    }

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function updateBatQuestionVisibility() {
      const speciesInput = document.querySelector('[name="c04"]');
      const species = speciesInput ? speciesInput.value : '';
      const hideBatQuestions = !!species && species !== 'bat' && species !== 'unknown';

      for (const questionId of batSpecificQuestionIds) {
        const container = document.querySelector('.question[data-question-id="' + questionId + '"]');
        if (!container) continue;

        container.style.display = hideBatQuestions ? 'none' : '';

        for (const input of container.querySelectorAll('input, select, textarea')) {
          input.disabled = hideBatQuestions;
          if (hideBatQuestions) {
            if (input.type === 'checkbox' || input.type === 'radio') {
              input.checked = false;
            } else {
              input.value = '';
            }
          }
        }
      }
    }

    function getConstraintWarnings(answers) {
      const warnings = [];
      const species = typeof answers.c04 === 'string' ? answers.c04 : '';
      if (species && species !== 'bat' && species !== 'unknown') {
        const answeredBatQuestions = batSpecificQuestionIds.filter((questionId) => {
          const value = answers[questionId];
          return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
        });
        if (answeredBatQuestions.length > 0) {
          warnings.push('Bat-specific exposure questions cannot be answered for a clear non-bat species.');
        }
      }
      return warnings;
    }

    // ── Collect form answers ───────────────────────────────────────
    function collectAnswers() {
      const answers = {};
      if (!questionnaire) return answers;

      for (const sec of questionnaire.sections) {
        for (const q of sec.questions) {
          if (q.response_type === 'multiselect_any') {
            const checked = [...document.querySelectorAll('input[name="' + q.id + '"]:checked')].map(el => el.value);
            if (checked.length > 0) answers[q.id] = checked;
          } else if (q.response_type === 'binary_yn' || q.response_type === 'ternary_ynu') {
            const sel = document.querySelector('input[name="' + q.id + '"]:checked');
            if (sel) answers[q.id] = sel.value;
          } else {
            const el = document.querySelector('[name="' + q.id + '"]');
            if (el && el.value) answers[q.id] = el.value;
          }
        }
      }
      return answers;
    }

    // ── Submit ─────────────────────────────────────────────────────
    document.getElementById('intake-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('submit-btn');
      const patientSelect = document.getElementById('patient-select');
      const patientUuid = patientSelect.value;
      const patientPid = patientSelect.options[patientSelect.selectedIndex]?.dataset?.pid || '';

      const answers = collectAnswers();
      if (Object.keys(answers).length === 0) { alert('Answer at least one question'); return; }
      const warnings = getConstraintWarnings(answers);
      if (warnings.length > 0) { alert(warnings.join('\n')); return; }
      const narrativeInput = document.getElementById('narrative-input').value;

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Submitting…';

      const resultDiv = document.getElementById('result');
      resultDiv.style.display = 'block';
      resultDiv.innerHTML = '<p>Submitting consult…</p>';

      try {
        const res = await fetch('/intake/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patient_uuid: patientUuid || undefined,
            patient_pid: patientPid || undefined,
            answers,
            narrative_input: narrativeInput,
            idempotency_key: globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
          }),
        });
        const data = await res.json();

        if (!res.ok) {
          const problems = (data.warnings || []).join('\n') || data.error || 'Submission failed';
          resultDiv.innerHTML = '<p class="failure">' + esc(problems) + '</p>';
          return;
        }

        let html = '<h2>Consult submitted</h2>';
        html += '<p class="success">✓ Consult submitted for public health review.</p>';
        html += '<p>The clinician status page is the home for this consult.</p>';
        if (data.consult?.status_url) {
          html += '<p><a href="' + esc(data.consult.status_url) + '"><strong>Go to clinician status page</strong></a></p>';
        }
        html += '<p><strong>Consult ID:</strong> <code>' + esc(data.consult?.consult_id || '—') + '</code></p>';
        html += '<p><strong>Workflow state:</strong> ' + esc(data.consult?.current_state || '—') + '</p>';
        html += '<p><strong>Automation mode:</strong> ' + esc(data.consult?.automation_mode || '—') + '</p>';

        const openemrStatus = data.openemr_projection_status;
        if (openemrStatus === 'success') {
          html += '<p class="success">✓ OpenEMR projection completed</p>';
        } else if (openemrStatus === 'partial') {
          html += '<p style="color:#e65100;font-weight:600">⚠ OpenEMR projection partially completed</p>';
        } else if (openemrStatus === 'failed') {
          html += '<p class="failure">✗ OpenEMR projection failed</p>';
        } else {
          html += '<p>OpenEMR projection skipped. No patient was selected.</p>';
        }
        if (data.openemr?.encounter) {
          html += '<p>Encounter UUID: <code>' + esc(data.openemr.encounter.uuid || '—') + '</code></p>';
        }
        if (data.openemr?.soap_note) {
          html += '<p>SOAP Note ID: <code>' + esc(data.openemr.soap_note.id || '—') + '</code></p>';
        }
        if (data.openemr?.warnings?.length) {
          html += '<div style="background:#fff3cd;border:1px solid #ffc107;border-radius:4px;padding:8px;margin:8px 0;font-size:0.85rem">';
          html += '<strong>Warnings:</strong><ul style="margin:4px 0 0 16px">';
          for (const w of data.openemr.warnings) html += '<li>' + esc(w) + '</li>';
          html += '</ul></div>';
        }
        if (data.openemr?.errors?.length) {
          for (const e of data.openemr.errors) html += '<p class="failure">' + esc(e) + '</p>';
        }
        html += '<hr style="margin:12px 0">';
        html += '<p><strong>Summary:</strong> ' + (data.payload_summary?.answered||0) + '/' +
                (data.payload_summary?.total||0) + ' questions, ' +
                (data.payload_summary?.derived_facts||0) + ' derived facts</p>';
        html += '<p><strong>Recommendation:</strong> ' + esc(data.payload_summary?.recommendation||'—') + '</p>';
        if (data.automation_resolution?.rationale) {
          html += '<p><strong>Automation rationale:</strong> ' + esc(data.automation_resolution.rationale) + '</p>';
        }
        if (data.soap_note) {
          html += '<details><summary>SOAP note preview</summary><pre>' + esc(
            ['Subjective', data.soap_note.subjective || '', '', 'Objective', data.soap_note.objective || '', '', 'Assessment', data.soap_note.assessment || '', '', 'Plan', data.soap_note.plan || ''].join('\n')
          ) + '</pre></details>';
        }
        html += '<details><summary>Clinician note preview</summary><pre>' + esc(data.clinician_note||'') + '</pre></details>';
        html += '<details><summary>Public health report preview</summary><pre>' + esc(data.public_health_report||'') + '</pre></details>';
        resultDiv.innerHTML = html;
      } catch (err) {
        resultDiv.innerHTML = '<p class="failure">Request failed: ' + esc(err.message) + '</p>';
      } finally {
        btn.disabled = false;
        btn.textContent = 'Submit consult';
      }
    });

    function clearForm() {
      document.getElementById('intake-form').reset();
      document.getElementById('result').style.display = 'none';
      document.getElementById('submit-btn').disabled = !questionnaire;
    }

    // ── Init ───────────────────────────────────────────────────────
    loadPatients();
    loadQuestionnaire();
    document.addEventListener('change', (event) => {
      if (event.target && event.target.name === 'c04') {
        updateBatQuestionVisibility();
      }
    });
  </script>
</body>
</html>`;
