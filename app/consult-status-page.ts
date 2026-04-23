// ---------------------------------------------------------------------------
// rade-v2 — Clinician consult status page
// ---------------------------------------------------------------------------

import { loadCanonicalIntake } from "../intake/loader.js";
import { buildQuestionnaire, getQuestion } from "../intake/questionnaire.js";
import type { ConsultView } from "../core/consult/service.js";
import type { ConsultTransformDescriptor } from "../core/transforms/registry.js";
import {
  CONSULT_FACT_REVIEW_SECTIONS,
  buildFactReviewSnapshot,
  buildConsultSummarySnapshot,
  buildWorkflowTimeline,
} from "./consult-ui.js";

const questionnaire = buildQuestionnaire(loadCanonicalIntake().data);

export function renderConsultStatusPage(input: {
  view: ConsultView;
  artifacts: ConsultTransformDescriptor[];
}): string {
  const { view, artifacts } = input;
  const consult = view.consult;
  const pendingClarifications = consult.clarifications.filter((thread) => !thread.response);
  const realArtifacts = artifacts.filter((artifact) => artifact.availability === "real");
  const summary = buildConsultSummarySnapshot(view);
  const factReview = buildFactReviewSnapshot(view);
  const timeline = buildWorkflowTimeline(view.audit_events);
  const correctionAllowed =
    consult.current_state !== "CLOSED" &&
    consult.current_state !== "CANCELLED" &&
    consult.current_state !== "CLARIFICATION_REQUESTED";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Consult ${escapeHtml(consult.consult_id)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f5; color: #1f2937; }
    main { max-width: 980px; margin: 0 auto; padding: 24px; }
    .panel { background: #fff; border: 1px solid #d1d5db; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    h1, h2, h3 { margin-top: 0; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    pre { white-space: pre-wrap; background: #f8fafc; padding: 12px; border-radius: 6px; }
    textarea, input, select { width: 100%; padding: 8px; margin-top: 6px; margin-bottom: 12px; border: 1px solid #cbd5e1; border-radius: 6px; }
    button { background: #1d4ed8; color: #fff; border: none; border-radius: 6px; padding: 10px 14px; cursor: pointer; }
    .artifact-list { display: grid; gap: 8px; }
    .artifact { padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px; }
    .pending { color: #b45309; }
    .badge { display: inline-block; margin-right: 6px; margin-top: 6px; padding: 2px 8px; border-radius: 999px; background: #e2e8f0; font-size: 12px; }
    .fact-list { list-style: none; padding: 0; margin: 0; }
    .fact-list li { padding: 10px 0; border-bottom: 1px solid #e5e7eb; }
    .fact-list li:last-child { border-bottom: none; }
    .timeline { list-style: none; padding: 0; margin: 0; }
    .timeline li { padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .timeline li:last-child { border-bottom: none; }
    .muted { color: #64748b; }
  </style>
</head>
<body>
  <main>
    <p><a href="/intake">Back to intake</a></p>
    <h1>Consult status</h1>

    <div class="grid">
      <div class="panel">
        <h2>Consult summary</h2>
        <p><strong>Species:</strong> ${escapeHtml(summary.key_facts.species)}</p>
        <p><strong>Exposure type:</strong> ${escapeHtml(summary.key_facts.exposure_type)}</p>
        <p><strong>Location:</strong> ${escapeHtml(summary.key_facts.location)}</p>
        <p><strong>Date:</strong> ${escapeHtml(summary.key_facts.exposure_date)}</p>
      </div>

      <div class="panel">
        <h2>Workflow</h2>
        <p><strong>Consult ID:</strong> ${escapeHtml(consult.consult_id)}</p>
        <p><strong>Current state:</strong> ${escapeHtml(consult.current_state)}</p>
        <p><strong>Latest action:</strong> ${escapeHtml(summary.latest_action)}</p>
        <p><strong>Blocking missing fields:</strong> ${summary.blocking_missing_labels.length}</p>
        <p><strong>Pending clarifications:</strong> ${summary.pending_clarifications}</p>
        <p><a href="/consults/${consult.consult_id}/audit" target="_blank">Open audit log</a></p>
      </div>

      <div class="panel">
        <h2>Outstanding issues</h2>
        ${summary.blocking_missing_labels.length === 0
          ? "<p>No blocking review gaps.</p>"
          : `<p><strong>Blocking review gaps</strong></p><ul>${summary.blocking_missing_labels.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`}
        ${summary.non_blocking_missing_labels.length === 0
          ? "<p>No follow-up details are currently missing.</p>"
          : `<p><strong>Follow-up details still missing</strong></p><ul>${summary.non_blocking_missing_labels.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`}
      </div>
    </div>

    <div class="grid">
      <div class="panel">
        <h2>Recommendation</h2>
        <p><strong>Authored:</strong> ${consult.recommendation ? "yes" : "no"}</p>
        <p><strong>Returned:</strong> ${consult.recommendation?.returned_to_clinician_at ? "yes" : "no"}</p>
        <p><strong>Acknowledged:</strong> ${consult.recommendation?.acknowledged_at ? "yes" : "no"}</p>
        ${consult.recommendation
          ? `<p><strong>Category:</strong> ${escapeHtml(consult.recommendation.category)}</p>
             <p><strong>Disposition:</strong> ${escapeHtml(consult.recommendation.label)}</p>
             <p><strong>Urgency:</strong> ${escapeHtml(consult.recommendation.urgency)}</p>
             <p><strong>PH reviewer:</strong> ${escapeHtml(consult.recommendation.authored_by.display_name)}</p>
             <p><strong>Returned at:</strong> ${escapeHtml(consult.recommendation.returned_to_clinician_at ?? "Not yet returned")}</p>
             <p><strong>Rationale:</strong> ${escapeHtml(consult.recommendation.rationale)}</p>
             <p><strong>Follow-up tasks:</strong></p>
             ${consult.recommendation.follow_up_tasks.length === 0
               ? "<p class=\"muted\">No explicit follow-up tasks recorded.</p>"
               : `<ul>${consult.recommendation.follow_up_tasks.map((task) => `<li>${escapeHtml(task.label)} (${escapeHtml(task.priority)})</li>`).join("")}</ul>`}
             <p><a href="/consults/${consult.consult_id}/artifacts/return-to-clinician" target="_blank">Open returned recommendation</a></p>`
          : `<p class="pending">Public health has not returned a recommendation yet.</p>`}
        ${consult.current_state === "RECOMMENDATION_RETURNED"
          ? `<button onclick="acknowledgeRecommendation()">Acknowledge recommendation</button>`
          : ""}
      </div>

      <div class="panel">
        <h2>Fact updates</h2>
        ${factReview.latest_correction
          ? `<p><strong>Latest correction:</strong> ${escapeHtml(factReview.latest_correction.corrected_at)} by ${escapeHtml(factReview.latest_correction.corrected_by)}</p>
             <p><strong>Corrected facts:</strong> ${escapeHtml(factReview.latest_correction.corrected_question_labels.join(", "))}</p>
             ${factReview.latest_correction.note ? `<p><strong>Note:</strong> ${escapeHtml(factReview.latest_correction.note)}</p>` : ""}`
          : "<p>No direct fact corrections have been recorded yet.</p>"}
        ${factReview.pending_clarification_labels.length > 0
          ? `<p><strong>Clarification-targeted facts:</strong> ${escapeHtml(factReview.pending_clarification_labels.join(", "))}</p>`
          : "<p>No clarification-targeted facts are currently pending.</p>"}
      </div>

      <div class="panel">
        <h2>Workflow timeline</h2>
        <ul class="timeline">
          ${timeline.map((entry) => `<li><strong>${escapeHtml(entry.label)}</strong><br><span class="muted">${entry.complete ? escapeHtml(entry.at ?? "Recorded") : "Not yet reached"}</span></li>`).join("")}
        </ul>
      </div>
    </div>

    <div class="panel">
      <h2>Answer review</h2>
      <p class="muted">These are the consult facts currently on record. Missing or uncertain facts are marked directly in the review list.</p>
      <div class="grid">
        ${factReview.sections.map((section) => renderFactReviewSection(section)).join("")}
      </div>
    </div>

    <div class="panel">
      <h2>Pending clarifications</h2>
      ${pendingClarifications.length === 0
        ? "<p>No pending clarification requests.</p>"
        : pendingClarifications.map((thread) => renderClarificationForm(thread.request.clarification_id, thread.request.target_question_ids, thread.request.freeform_question)).join("")}
    </div>

    <div class="panel">
      <h2>Correct consult facts</h2>
      ${correctionAllowed
        ? renderCorrectionForm(factReview)
        : `<p class="muted">${consult.current_state === "CLARIFICATION_REQUESTED"
            ? "Use the clarification response form while a clarification request is open."
            : "Direct corrections are unavailable after the consult is closed or cancelled."}</p>`}
    </div>

    <div class="panel">
      <h2>Available artifacts</h2>
      <div class="artifact-list">
        ${realArtifacts.map((artifact) => `<div class="artifact"><strong>${escapeHtml(artifact.artifact_name)}</strong><br>${escapeHtml(artifact.description)}<br><a href="/consults/${consult.consult_id}/artifacts/${artifact.artifact_name}" target="_blank">Open artifact</a></div>`).join("")}
      </div>
    </div>
  </main>

  <script>
    const consultId = ${JSON.stringify(consult.consult_id)};

    function randomId() {
      return globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    }

    function collectAnswers(form) {
      const answers = {};
      const fields = form.querySelectorAll('[data-question-id]');
      const seen = new Set();

      for (const field of fields) {
        const questionId = field.dataset.questionId;
        const responseType = field.dataset.responseType;
        if (!questionId || !responseType || seen.has(questionId)) {
          continue;
        }
        seen.add(questionId);

        if (responseType === 'multiselect_any') {
          const values = [...form.querySelectorAll('[data-question-id="' + questionId + '"]:checked')].map((entry) => entry.value);
          if (values.length > 0) {
            answers[questionId] = values;
          }
        } else if (responseType === 'binary_yn' || responseType === 'ternary_ynu') {
          const selected = form.querySelector('[data-question-id="' + questionId + '"]:checked');
          if (selected) {
            answers[questionId] = selected.value;
          }
        } else {
          const input = form.querySelector('[data-question-id="' + questionId + '"]');
          if (input && input.value) {
            answers[questionId] = input.value;
          }
        }
      }

      return answers;
    }

    async function submitClarification(clarificationId) {
      const form = document.getElementById('clarification-' + clarificationId);
      const answers = collectAnswers(form);

      const res = await fetch('/consults/' + consultId + '/clarifications/' + clarificationId + '/response', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomId(),
        },
        body: JSON.stringify({
          responded_by: { actor_id: 'intake-clinician', display_name: 'Clinician Submitter' },
          answers,
          narrative_update: form.querySelector('[name="narrative_update"]').value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Clarification submission failed' }));
        alert(data.error || 'Clarification submission failed');
        return;
      }

      location.reload();
    }

    async function submitCorrection() {
      const form = document.getElementById('consult-correction-form');
      const answers = collectAnswers(form);
      const narrativeInput = form.querySelector('[name="narrative_update"]').value.trim();
      const noteInput = form.querySelector('[name="correction_note"]').value.trim();

      if (Object.keys(answers).length === 0 && !narrativeInput) {
        alert('Enter at least one corrected fact or a narrative update.');
        return;
      }

      const res = await fetch('/consults/' + consultId + '/corrections', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomId(),
        },
        body: JSON.stringify({
          corrected_by: { actor_id: 'intake-clinician', display_name: 'Clinician Submitter' },
          answers,
          narrative_update: narrativeInput || undefined,
          note: noteInput || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Correction failed' }));
        alert(data.error || 'Correction failed');
        return;
      }

      location.reload();
    }

    async function acknowledgeRecommendation() {
      const res = await fetch('/consults/' + consultId + '/acknowledge', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomId(),
        },
        body: JSON.stringify({
          acknowledged_by: { actor_id: 'intake-clinician', display_name: 'Clinician Submitter' },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Acknowledgement failed' }));
        alert(data.error || 'Acknowledgement failed');
        return;
      }

      location.reload();
    }
  </script>
</body>
</html>`;
}

function renderFactReviewSection(section: { title: string; items: Array<{ question_id: string; question_text: string; value: string; badges: string[] }> }): string {
  return `<div class="panel">
    <h3>${escapeHtml(section.title)}</h3>
    <ul class="fact-list">
      ${section.items.map((item) => `<li><strong>${escapeHtml(item.question_text)}</strong><br>${escapeHtml(item.value)}<br>${item.badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</li>`).join("")}
    </ul>
  </div>`;
}

function renderCorrectionForm(factReview: { sections: Array<{ title: string; items: Array<{ question_id: string; value: string }> }> }): string {
  const currentValueByQuestionId = new Map(
    factReview.sections.flatMap((section) =>
      section.items.map((item) => [item.question_id, item.value] as const),
    ),
  );

  return `<form id="consult-correction-form" onsubmit="event.preventDefault(); submitCorrection()">
    <p class="muted">Submit a targeted correction for the key consult facts below. The existing workflow state stays intact, and the correction is appended to the audit trail.</p>
    <label>Correction note</label>
    <textarea name="correction_note" placeholder="Optional reason for the correction"></textarea>
    ${CONSULT_FACT_REVIEW_SECTIONS.map((section) => `<div class="panel"><h3>${escapeHtml(section.title)}</h3>${section.question_ids.map((questionId) => renderQuestionInput(questionId, currentValueByQuestionId.get(questionId) ?? "Not recorded")).join("")}</div>`).join("")}
    <label>Narrative update</label>
    <textarea name="narrative_update" placeholder="Optional replacement narrative context"></textarea>
    <button type="submit">Save correction</button>
  </form>`;
}

function renderClarificationForm(
  clarificationId: string,
  targetQuestionIds: string[],
  freeformQuestion: string | undefined,
): string {
  return `<form id="clarification-${clarificationId}" class="panel" onsubmit="event.preventDefault(); submitClarification(${JSON.stringify(clarificationId)})">
    <h3>Clarification ${escapeHtml(clarificationId)}</h3>
    <p>${escapeHtml(freeformQuestion ?? "Public health requested clarification on the fields below.")}</p>
    ${targetQuestionIds.map((questionId) => renderQuestionInput(questionId)).join("")}
    <label>Narrative update</label>
    <textarea name="narrative_update" placeholder="Optional additional context for PH review"></textarea>
    <button type="submit">Send clarification response</button>
  </form>`;
}

function renderQuestionInput(questionId: string, currentValue?: string): string {
  const question = getQuestion(questionnaire, questionId);
  if (!question) {
    return `<p>Unknown question: ${escapeHtml(questionId)}</p>`;
  }

  const label = `<label><strong>${escapeHtml(question.id)}</strong> ${escapeHtml(question.text)}</label>${currentValue ? `<div class="muted">Current on record: ${escapeHtml(currentValue)}</div>` : ""}`;

  switch (question.response.type) {
    case "binary_yn":
      return `${label}${renderRadio(question.id, question.response.type, ["yes", "no"])}`;
    case "ternary_ynu":
      return `${label}${renderRadio(question.id, question.response.type, ["yes", "no", "unknown"])}`;
    case "enum":
    case "count_enum":
      return `${label}<select data-question-id="${escapeHtml(question.id)}" data-response-type="${escapeHtml(question.response.type)}"><option value="">-- select --</option>${question.response.option_values.map((option) => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join("")}</select>`;
    case "multiselect_any":
      return `${label}<div>${question.response.items.map((item) => `<label><input type="checkbox" data-question-id="${escapeHtml(question.id)}" data-response-type="multiselect_any" value="${escapeHtml(item.value)}"> ${escapeHtml(item.label)}</label>`).join("<br>")}</div>`;
    case "datetime":
      return `${label}<input type="datetime-local" data-question-id="${escapeHtml(question.id)}" data-response-type="datetime">`;
    case "free_text":
      return `${label}<input type="text" data-question-id="${escapeHtml(question.id)}" data-response-type="free_text">`;
    default:
      return `${label}<input type="text" data-question-id="${escapeHtml(question.id)}" data-response-type="free_text">`;
  }
}

function renderRadio(
  questionId: string,
  responseType: string,
  values: string[],
): string {
  return `<div>${values.map((value) => `<label><input type="radio" name="${escapeHtml(questionId)}" data-question-id="${escapeHtml(questionId)}" data-response-type="${escapeHtml(responseType)}" value="${escapeHtml(value)}"> ${escapeHtml(value)}</label>`).join(" ")}</div>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}