// ---------------------------------------------------------------------------
// rade-v2 — Minimal PH review UI
// ---------------------------------------------------------------------------

import { Hono } from "hono";
import type { ConsultView } from "../core/consult/service.js";

import { getConsultService } from "./consult-runtime.js";
import {
  buildFactReviewSnapshot,
  buildConsultSummarySnapshot,
  buildWorkflowTimeline,
} from "./consult-ui.js";

const ph = new Hono();
const service = getConsultService();

ph.get("/", (c) => {
  const consults = service.listConsults();
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>RaDE PH Queue</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f5; color: #1f2937; }
    main { max-width: 960px; margin: 0 auto; padding: 24px; }
    h1 { margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; background: #fff; }
    th, td { padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: left; }
    a { color: #0f766e; text-decoration: none; }
  </style>
</head>
<body>
  <main>
    <h1>PH Review Queue</h1>
    <p>Workflow-first consult relay queue.</p>
    <table>
      <thead>
        <tr>
          <th>Consult</th>
          <th>State</th>
          <th>Missing critical fields</th>
          <th>Updated</th>
        </tr>
      </thead>
      <tbody>
        ${consults.length === 0 ? `<tr><td colspan="4">No consults submitted yet.</td></tr>` : consults.map((consult) => `
          <tr>
            <td><a href="/ph/consults/${consult.consult_id}">${consult.consult_id}</a></td>
            <td>${consult.current_state}</td>
            <td>${consult.missing_critical_count}</td>
            <td>${escapeHtml(consult.updated_at)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  </main>
</body>
</html>`);
});

ph.get("/consults/:consultId", (c) => {
  try {
    const view = service.getConsult(c.req.param("consultId"));
    return c.html(renderPhConsultDetailPage(view));
  } catch (error) {
    return c.html(`<!DOCTYPE html><html><body><p>${escapeHtml(error instanceof Error ? error.message : String(error))}</p></body></html>`, 404);
  }
});

export function renderPhConsultDetailPage(view: ConsultView): string {
  const consult = view.consult;
  const recommendation = consult.recommendation;
  const summary = buildConsultSummarySnapshot(view);
  const factReview = buildFactReviewSnapshot(view);
  const timeline = buildWorkflowTimeline(view.audit_events);
  const missingIds = view.missing_critical_fields.blocking_field_ids.join(", ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Consult ${escapeHtml(consult.consult_id)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f5f5f5; color: #111827; }
    main { max-width: 1080px; margin: 0 auto; padding: 24px; }
    .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    h1, h2, h3 { margin-top: 0; }
    pre { white-space: pre-wrap; background: #f9fafb; padding: 12px; border-radius: 6px; }
    textarea, input, select { width: 100%; padding: 8px; margin-top: 6px; margin-bottom: 12px; border: 1px solid #cbd5e1; border-radius: 6px; }
    button { background: #0f766e; color: #fff; border: none; border-radius: 6px; padding: 10px 14px; cursor: pointer; }
    button.secondary { background: #475569; }
    ul { padding-left: 20px; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
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
    <p><a href="/ph">Back to queue</a></p>
    <h1>Consult ${escapeHtml(consult.consult_id)}</h1>

    <div class="grid">
      <div class="panel">
        <h2>Consult summary</h2>
        <p><strong>Species:</strong> ${escapeHtml(summary.key_facts.species)}</p>
        <p><strong>Exposure type:</strong> ${escapeHtml(summary.key_facts.exposure_type)}</p>
        <p><strong>Location:</strong> ${escapeHtml(summary.key_facts.location)}</p>
        <p><strong>Date:</strong> ${escapeHtml(summary.key_facts.exposure_date)}</p>
      </div>

      <div class="panel">
        <h2>Workflow status</h2>
        <p><strong>Current state:</strong> ${consult.current_state}</p>
        <p><strong>Latest action:</strong> ${escapeHtml(summary.latest_action)}</p>
        <p><strong>Automation mode:</strong> ${consult.automation_mode}</p>
        <p><strong>Submitter:</strong> ${escapeHtml(consult.parties.submitter.display_name)}</p>
        <p><strong>Engine advisory:</strong> ${escapeHtml(consult.engine_decisions[0]?.advisory_summary ?? "No engine decision recorded")}</p>
      </div>

      <div class="panel">
        <h2>Outstanding issues</h2>
        ${summary.blocking_missing_labels.length === 0
          ? "<p>No blocking review gaps.</p>"
          : `<p><strong>Blocking review gaps</strong></p><ul>${summary.blocking_missing_labels.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`}
        ${summary.non_blocking_missing_labels.length === 0
          ? "<p>No follow-up details are currently missing.</p>"
          : `<p><strong>Follow-up details still missing</strong></p><ul>${summary.non_blocking_missing_labels.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`}
        <p><strong>Pending clarification requests:</strong> ${summary.pending_clarifications}</p>
      </div>
    </div>

    <div class="panel">
      <h2>Recommendation</h2>
      ${recommendation
        ? `<p><strong>Category:</strong> ${escapeHtml(recommendation.category)}</p>
           <p><strong>Disposition:</strong> ${escapeHtml(recommendation.label)}</p>
           <p><strong>Urgency:</strong> ${escapeHtml(recommendation.urgency)}</p>
           <p><strong>Authored by:</strong> ${escapeHtml(recommendation.authored_by.display_name)}</p>
           <p><strong>Returned at:</strong> ${escapeHtml(recommendation.returned_to_clinician_at ?? "Not yet returned")}</p>
           <p><strong>Rationale:</strong> ${escapeHtml(recommendation.rationale)}</p>
           <p><strong>Follow-up tasks:</strong></p>
           ${recommendation.follow_up_tasks.length === 0
             ? "<p class=\"muted\">No explicit follow-up tasks recorded.</p>"
             : `<ul>${recommendation.follow_up_tasks.map((task) => `<li>${escapeHtml(task.label)} (${escapeHtml(task.priority)})</li>`).join("")}</ul>`}
           <p><a href="/consults/${consult.consult_id}/artifacts/return-to-clinician" target="_blank">Open return-to-clinician artifact</a></p>`
        : "<p>No recommendation has been authored yet.</p>"}
    </div>

    <div class="panel">
      <h2>Answer review</h2>
      <p class="muted">These are the consult facts currently driving PH review. Missing, uncertain, clarification-targeted, and recently corrected facts are marked inline.</p>
      <div class="grid">
        ${factReview.sections.map((section) => renderFactReviewSection(section)).join("")}
      </div>
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
      <h2>Clarification</h2>
      <p>Default clarification targets are the blocking review gaps shown above.</p>
      <label>Target question IDs</label>
      <input id="targetQuestionIds" value="${escapeHtml(missingIds)}">
      <label>Question for clinician</label>
      <textarea id="clarificationQuestion">Please clarify the missing fields needed for PH review.</textarea>
      <button onclick="requestClarification()">Request Clarification</button>
    </div>

    <div class="panel">
      <h2>Recommendation</h2>
      <label>Category</label>
      <select id="recommendationCategory">
        <option value="observe_or_test">observe_or_test</option>
        <option value="prophylaxis">prophylaxis</option>
        <option value="expert_review">expert_review</option>
        <option value="no_action">no_action</option>
        <option value="custom">custom</option>
      </select>
      <label>Label</label>
      <input id="recommendationLabel" value="${escapeHtml(recommendation?.label ?? "PH recommendation")}">
      <label>Urgency</label>
      <select id="recommendationUrgency">
        <option value="routine">routine</option>
        <option value="important" selected>important</option>
        <option value="urgent">urgent</option>
      </select>
      <label>Rationale</label>
      <textarea id="recommendationRationale">${escapeHtml(recommendation?.rationale ?? "PH review required." )}</textarea>
      <label>Required follow-up tasks</label>
      <textarea id="recommendationTasks" placeholder="One task per line">${escapeHtml((recommendation?.follow_up_tasks ?? []).map((task) => task.label).join("\n"))}</textarea>
      <label><input id="recommendationEscalation" type="checkbox" ${recommendation?.escalation_required ? "checked" : ""}> Escalation required</label>
      <button onclick="authorRecommendation()">Author Recommendation</button>
      ${consult.current_state === "RECOMMENDATION_AUTHORED" ? `<button class="secondary" onclick="returnRecommendation()">Return Recommendation</button>` : ""}
      ${consult.recommendation ? `<p><a href="/consults/${consult.consult_id}/artifacts/return-to-clinician" target="_blank">Open return-to-clinician artifact</a></p>` : ""}
    </div>

    <div class="panel">
      <h2>Workflow timeline</h2>
      <ul class="timeline">
        ${timeline.map((entry) => `<li><strong>${escapeHtml(entry.label)}</strong><br><span class="muted">${entry.complete ? escapeHtml(entry.at ?? "Recorded") : "Not yet reached"}</span></li>`).join("")}
      </ul>
    </div>
  </main>
  <script>
    const consultId = ${JSON.stringify(consult.consult_id)};

    function randomId() {
      return globalThis.crypto?.randomUUID?.() ?? String(Date.now());
    }

    async function postJson(url, payload) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': randomId(),
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Request failed' }));
        alert(data.error || 'Request failed');
        return;
      }

      location.reload();
    }

    async function requestClarification() {
      const ids = document.getElementById('targetQuestionIds').value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      await postJson('/consults/' + consultId + '/clarifications', {
        requested_by: { actor_id: 'demo-ph-reviewer', display_name: 'Demo PH Reviewer' },
        target_question_ids: ids,
        freeform_question: document.getElementById('clarificationQuestion').value,
      });
    }

    async function authorRecommendation() {
      await postJson('/consults/' + consultId + '/recommendation', {
        authored_by: { actor_id: 'demo-ph-reviewer', display_name: 'Demo PH Reviewer' },
        category: document.getElementById('recommendationCategory').value,
        label: document.getElementById('recommendationLabel').value,
        urgency: document.getElementById('recommendationUrgency').value,
        rationale: document.getElementById('recommendationRationale').value,
        follow_up_tasks: document.getElementById('recommendationTasks').value
          .split('\n')
          .map((entry) => entry.trim())
          .filter(Boolean)
          .map((label, index) => ({
            task_id: 'task-' + index + '-' + Date.now(),
            label,
            priority: document.getElementById('recommendationUrgency').value,
            task_type: 'follow_up',
          })),
        escalation_required: document.getElementById('recommendationEscalation').checked,
      });
    }

    async function returnRecommendation() {
      await postJson('/consults/' + consultId + '/recommendation/return', {
        returned_by: { actor_id: 'demo-ph-reviewer', display_name: 'Demo PH Reviewer' },
      });
    }
  </script>
</body>
</html>`;
}

function renderFactReviewSection(section: { title: string; items: Array<{ question_text: string; value: string; badges: string[] }> }): string {
  return `<div class="panel">
    <h3>${escapeHtml(section.title)}</h3>
    <ul class="fact-list">
      ${section.items.map((item) => `<li><strong>${escapeHtml(item.question_text)}</strong><br>${escapeHtml(item.value)}<br>${item.badges.map((badge) => `<span class="badge">${escapeHtml(badge)}</span>`).join("")}</li>`).join("")}
    </ul>
  </div>`;
}

export default ph;

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}