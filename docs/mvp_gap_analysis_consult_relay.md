# RaDE MVP Gap Analysis — Consult Relay Pivot

**Audit date:** 2026-04-22
**Auditor role:** senior staff engineer / product-architecture review
**Scope:** Compare current `rade-v2` repo against the target MVP — a closed-loop clinician ↔ public health (PH) consult workflow system, scoped initially to animal exposure / rabies PEP consults.
**Repo audited:** `/home/owner/dev/rade-v2`

---

## 1. Executive summary

**Verdict: partially suitable, significant boundary work required — but DO NOT start a new repo.**

`rade-v2` already contains roughly **35–40% of the MVP** as substrate: a validated canonical intake questionnaire (49 Q, dual-source WHO + Ontario), a clean intake-answer-payload pipeline, a deterministic decision engine (`core/engine.ts`), four output renderers, four exporter adapters (FHIR, Epic-FHIR, OpenEMR, SORMAS, DHIS2-Tracker), a Hono HTTP server, and a working OpenEMR write flow. The "capture once, transform many" half of the wedge is largely real.

What is missing is the **consult relay half**: there is no Consult resource, no typed actor model, no linear state machine, no clarification loop, no recommendation-return artifact, no audit-event log, no PH review UI, no automation-mode policy switch, no centralized missing-critical-field resolver, and no field-level provenance rich enough for retry-safe, governable workflow. The current architecture indexes hard on *"engine produces an assessment for a clinician"* — it does not yet model *"clinician submits a consult, PH reviews, returns a recommendation, audit trail closes the loop."*

The good news: the boundaries needed (canonical payload ↔ engine ↔ renderers ↔ adapters) already exist, and the relay layer can be added on top without destroying the existing primitives. Two important architectural mismatches must be resolved early: (1) two parallel intake stacks (`core/intake.ts` + v1 checklist vs. `intake/*` + v2 checklist) must be collapsed onto v2; (2) two parallel "envelope/assessment" stacks (`core/envelope.ts` + `core/types.ts::Assessment` vs. `intake/payload.ts::CanonicalCasePayload` + `intake/assessment.ts::PlaceholderAssessment`) must be unified under a single `CanonicalConsult` aggregate. That unification must preserve a linear consult lifecycle, treat escalation as a side stream rather than a peer terminal state, and keep artifact bundles explicitly non-authoritative.

### Top 5 architectural strengths already present
1. **Clean intake → questionnaire → answer set → canonical payload pipeline** (`intake/loader.ts` → `intake/questionnaire.ts` → `intake/answers.ts` → `intake/payload.ts`) with validation, classification, and source traces.
2. **Deterministic engine kept separate** from intake and rendering (`core/engine.ts`) — exactly the separation the principles require.
3. **Multiple artifact transforms already wired** off a single canonical input (renderers + 5 platform adapters + DHIS2 manifest).
4. **Question-level source tracing** (`who_ids`, `on_ids`, `redundancy_group`, `origin`) — gives us the bones of provenance.
5. **Working server + OpenEMR write flow** with dependency-injected, tested orchestrator (`app/openemr-flow.ts`, `tests/openemr-flow.test.ts`).

### Top 5 critical gaps
1. **No Consult resource and no consult state machine.** `WorkflowStatus` in [core/types.ts](core/types.ts#L141) has only `intake | assessed | action_required | completed`; there is no `awaiting_ph_review`, `clarification_requested`, `recommendation_authored`, `recommendation_returned`, `acknowledged`, `closed`.
2. **No typed actor model, no PH review surface, no recommendation composer.** Renderers produce a PH *report*, not a workspace, and the repo has no first-class actor roles (`clinician_submitter`, `ph_reviewer`, `ph_supervisor`, `system`).
3. **No clarification loop.** `ConsultRequest → ClarificationRequest → UpdatedConsult → Recommendation` is entirely absent.
4. **No audit-event log / persistence.** Everything is in-memory; there is no `AuditEvent` stream and no store.
5. **No field-level provenance rich enough for audit, no centralized missing-critical-field resolver, and no automation-mode policy switch** (`PH_REQUIRED | PH_OPTIONAL | AUTO_ALLOWED`).

---

## 2. Target MVP restatement (engineering-precise)

### Product boundary
A modality-agnostic intake → canonical consult object → bidirectional clinician ↔ PH consult workflow → multi-artifact output system, with embedded deterministic decision support, narrowed to animal exposure / rabies PEP for the first vertical slice.

### In-scope capabilities
- Modality-agnostic clinician-side intake (dictated narrative, typed narrative, structured form) feeding **one** canonical schema.
- A `CanonicalConsult` aggregate that unifies patient context, exposure, animal/source, wound/anatomy, immune history, urgency, submitter metadata, actor references, and consult-lifecycle metadata.
- Automatic generation, from one consult, of: chart-ready clinician note, PH consult summary, PH workspace view, ministry escalation draft (when applicable), JSON export, FHIR-aligned export.
- A PH review console: receive consult → review normalized fields → see missing-data flags → see deterministic rationale → compose/edit recommendation → optionally request clarification → optionally escalate.
- A first-class clarification loop with explicit state transitions.
- Recommendation return: PH-issued recommendation, rationale, urgency, follow-up tasks, escalation outcome — with distinct lifecycle moments for recommendation authored, recommendation returned to clinician, and clinician acknowledgment — auto-rendered into a return-to-clinician artifact + PH internal documentation stub + (optional) ministry escalation summary.
- Closed-loop audit trail covering submission, review, clarification, recommendation authored, recommendation returned, recommendation acknowledged, follow-up, escalation side events, and all state transitions.
- Three configurable automation modes: `PH_REQUIRED`, `PH_OPTIONAL`, `AUTO_ALLOWED`.
- Field-level provenance: `source_modality ∈ {dictated, typed, clicked, inferred}`, `confidence`, `status ∈ {confirmed, unconfirmed, missing}`, `captured_by`, `captured_at`, `last_confirmed_by`, `last_confirmed_at`.
- All workflow commands are idempotent and safe on retry.
- Artifact bundles are derived outputs/caches, never authoritative state.
- Missing critical field detection and clarification targeting are centralized in one resolver, not scattered across UI handlers.

### Explicitly out of scope (MVP)
- Generic clinical chatbot / open-ended LLM assistant.
- Broad, arbitrary EHR interoperability beyond OpenEMR + 1–2 FHIR shapes.
- General outbreak surveillance platform.
- Production ministry integration.
- Multi-disease generalization beyond what the canonical model trivially permits.
- Autonomous LLM-issued clinical recommendations.

### Primary user roles
- **`clinician_submitter`** — originates consult, responds to clarifications, receives recommendation, acknowledges.
- **`ph_reviewer`** — receives consult, requests clarification, composes recommendation, returns recommendation, optionally requests escalation.
- **`ph_supervisor`** — reviews escalations and supervises exception handling.
- **`system`** — records derived events, caches artifacts, and runs deterministic transforms.

### Closed-loop workflow
`DRAFT → SUBMITTED → AWAITING_PH_REVIEW → (CLARIFICATION_REQUESTED → CLARIFICATION_PROVIDED → AWAITING_PH_REVIEW)* → RECOMMENDATION_AUTHORED → RECOMMENDATION_RETURNED → ACKNOWLEDGED → CLOSED`

Escalation is **not** a peer lifecycle state. It is modeled as a separate flag/object/event stream attached to the consult.

### Automation modes (policy switch)
- `PH_REQUIRED` — engine output is advisory only; PH must compose & sign.
- `PH_OPTIONAL` — engine output may be auto-issued for low-risk classes; PH path remains available.
- `AUTO_ALLOWED` — engine output auto-issued unless flags trip; PH on exception only.

### Modality-agnostic input requirement
Dictation / typing / structured entry are **adapters** to one `CanonicalConsult` schema, not separate products.

### Clarification loop requirement
Clarification is a first-class state and a first-class artifact (`ClarificationRequest` referencing specific question IDs and free-text asks, returning a `ClarificationResponse` / patched `CanonicalConsult`). Candidate clarification targets are resolved centrally by a `MissingCriticalFieldResolver`, not by UI-specific heuristics.

### Multi-artifact transform requirement
One `CanonicalConsult` → bundle of artifacts via a registry of named transforms (chart-note, ph-summary, ph-workspace, escalation-draft, return-to-clinician, json, fhir). These artifacts are derived outputs/caches only.

### Auditable transaction state requirement
Every state change appends an immutable `AuditEvent`; the consult's current state is derived from the event log. Persistence (even SQLite/JSON for MVP) is mandatory. The consult aggregate + audit log are authoritative; artifact bundles are never used as state.

---

## 3. Repo inventory relevant to MVP

| Concern | Location | What it does | MVP relevance |
|---|---|---|---|
| Canonical intake schema (v2) | [data/canonical/canonical_rabies_intake_v2.json](data/canonical/canonical_rabies_intake_v2.json) | 49 questions, 14 sections, dual-source (WHO + ON) with `source_map`, `redundancy_group`, classification | **Core** — basis of `CanonicalConsult` |
| Legacy intake schema (v1) | [data/canonical/canonical_rabies_intake_v1.json](data/canonical/canonical_rabies_intake_v1.json) | Older flat checklist | **Deprecate** |
| Decision-flow skeleton | [data/canonical/rade_canonical_rabies_flow_v1.json](data/canonical/rade_canonical_rabies_flow_v1.json) | TODO_manual_* node graph; not yet executed | **Future** — out of MVP critical path |
| Loader + validator | [intake/loader.ts](intake/loader.ts) | Reads + validates intake JSON | **Reuse** |
| Questionnaire model | [intake/questionnaire.ts](intake/questionnaire.ts) | Typed view over raw schema | **Reuse** |
| Answer set + validation | [intake/answers.ts](intake/answers.ts) | `AnswerValue` discriminated union, validators, `Ans` constructors | **Reuse, extend** with provenance |
| Canonical payload | [intake/payload.ts](intake/payload.ts) | Normalized answers, source traces, derived facts | **Reuse, rename → CanonicalConsult.body** |
| Placeholder assessment | [intake/assessment.ts](intake/assessment.ts) | Honest stub; emits risk signals | **Demote** to "engine pre-result"; superseded by `EngineDecision` + `ConsultRecommendation` |
| Deterministic engine | [core/engine.ts](core/engine.ts) | Rule-based rabies decision (priority-ordered) | **Reuse**; rename file/concept; treat as advisory input to PH |
| Catalog / zone policy | [core/catalog.ts](core/catalog.ts) | NA zone, host profiles, recommendation classes | **Reuse** as policy overlay seed |
| Legacy intake mapper | [core/intake.ts](core/intake.ts) | Maps v1 checklist answers → engine input | **Replace** with `intake/payload → engine input` mapper using v2 derived facts |
| Legacy envelope/assessment | [core/envelope.ts](core/envelope.ts), [core/types.ts](core/types.ts) | `ClinicalCase`, `Assessment`, `CaseEnvelope`, `WorkflowStatus` | **Refactor** into `CanonicalConsult`, `EngineDecision`, `ConsultState` |
| Pipeline | [core/pipeline.ts](core/pipeline.ts) | `runAssessment` / `runIntakeAssessment` | **Refactor** into `submitConsult` workflow command |
| Renderers | [renderers/clinician.ts](renderers/clinician.ts), [renderers/clinician-v2.ts](renderers/clinician-v2.ts), [renderers/public-health.ts](renderers/public-health.ts), [renderers/patient.ts](renderers/patient.ts) | Text/structured outputs | **Reuse**; register in transform registry; add return-to-clinician + escalation-draft renderers |
| FHIR / Epic / OpenEMR / SORMAS / DHIS2 adapters | [adapters/](adapters/) | Convert payload → external shapes | **Reuse**; treat as transforms |
| Mapping manifests | [manifests/intake-mapping.ts](manifests/intake-mapping.ts), [manifests/dhis2-mapping.ts](manifests/dhis2-mapping.ts) | Documentation manifests | **Reuse** |
| HTTP server | [app/server.ts](app/server.ts) | Hono server, `/assess`, `/intake/*` | **Extend** with consult workflow routes |
| Intake UI + form HTML | [app/intake-routes.ts](app/intake-routes.ts) | Clinician intake form, OpenEMR submission | **Reuse + extend** for consult submit; needs PH review UI as sibling |
| OpenEMR REST client | [app/openemr-client.ts](app/openemr-client.ts) | OAuth2 + REST writes | **Reuse** |
| OpenEMR write flow | [app/openemr-flow.ts](app/openemr-flow.ts) | DI-friendly orchestrator | **Reuse** as one of several transform handlers |
| Tests | [tests/intake.test.ts](tests/intake.test.ts), [tests/intake-v2.test.ts](tests/intake-v2.test.ts), [tests/pipeline.test.ts](tests/pipeline.test.ts), [tests/dhis2.test.ts](tests/dhis2.test.ts), [tests/openemr-flow.test.ts](tests/openemr-flow.test.ts) | Unit + integration coverage of intake/engine/adapters | **Reuse**; add workflow + state tests |
| Docs | [docs/dhis2-module-overview.md](docs/dhis2-module-overview.md), [docs/integrations/openemr-api-baseline.md](docs/integrations/openemr-api-baseline.md), [data/research/](data/research/) | Background + integration baselines | **Reuse** |
| Persistence | — | None (in-memory only) | **Missing** |
| AuditEvent log | — | None | **Missing** |
| State machine | — | None (only a 4-value `WorkflowStatus`) | **Missing** |
| PH review UI | — | None | **Missing** |
| Clarification loop | — | None | **Missing** |
| Field-level provenance | — | Source-map exists at *question* level; per-answer modality/confidence/status/captured-by timestamps absent | **Missing** |
| Automation-mode policy | — | None | **Missing** |
| Missing critical field resolver | — | No centralized resolver; missingness appears only as `unresolved_fields` on payload | **Missing** |
| Idempotent workflow command handling | — | No command idempotency key / retry-safe mutation layer | **Missing** |

---

## 4. Gap analysis matrix

| # | MVP capability | Status | Existing files / modules | Required change | Priority | Suggested approach |
|---|---|---|---|---|---|---|
| 1 | Modality-agnostic intake | **Partial** | [app/intake-routes.ts](app/intake-routes.ts), [intake/answers.ts](intake/answers.ts) | Structured form works; dictation/typed-narrative ingestors absent. Also need per-answer `source_modality`. | P1 | Add `IntakeIngestor` interface; structured + narrative-stub implementations; extend `AnswerValue` with provenance envelope. |
| 2 | Canonical consult object | **Partial / conflicting** | [intake/payload.ts](intake/payload.ts) (CanonicalCasePayload), [core/types.ts](core/types.ts) (CaseEnvelope) | Two competing aggregates. Unify into one `CanonicalConsult`. | **P0** | New `core/consult/types.ts` with `CanonicalConsult` wrapping intake body + metadata + parties + state ref; deprecate `CaseEnvelope`. |
| 3 | Consult request object | **Absent** | — | Need `ConsultRequest` (submission record: who, when, automation mode, target reviewer queue). | **P0** | Add to `core/consult/types.ts`. |
| 4 | Clarification request object | **Absent** | — | Need `ClarificationRequest` referencing question IDs + free-text. | P1 | Add to `core/consult/types.ts`; route handler to append + transition state. |
| 5 | Consult recommendation object | **Partial / conflicting** | [core/types.ts](core/types.ts) (`Assessment`), [intake/assessment.ts](intake/assessment.ts) (placeholder) | Neither models a *PH-authored* recommendation with rationale, urgency, tasks, escalation outcome, signer. | **P0** | New `ConsultRecommendation` distinct from `EngineDecision`. Engine output becomes one input to recommendation composer. |
| 6 | Consult state machine / workflow statuses | **Absent** | [core/types.ts](core/types.ts#L141) `WorkflowStatus` is too coarse | Define a **linear** lifecycle with distinct `RECOMMENDATION_AUTHORED`, `RECOMMENDATION_RETURNED`, and `ACKNOWLEDGED`; keep escalation outside the primary enum. | **P0** | `core/consult/state.ts` with enum + transition table + guard fn; persist via event log. |
| 7 | Field provenance / confidence / missingness | **Partial** | Question-level `source_map`; missingness via `unresolved_fields` | Per-answer `{source_modality, confidence, status, captured_by, captured_at, last_confirmed_by, last_confirmed_at}` envelope is missing. | P1 | Wrap `AnswerValue` in `ProvenancedAnswer` with full audit fields and safe legacy defaults. |
| 8 | Deterministic recommendation engine separation | **Present** | [core/engine.ts](core/engine.ts) | Already separate; just needs rename + clearer interface as advisory producer of `EngineDecision`. | P2 | Rename to `core/engine/rabies.ts`; expose `runEngine(consult): EngineDecision`. |
| 9 | Policy overlay separation | **Partial** | [core/catalog.ts](core/catalog.ts) (zone policy embedded) | Catalog is fine for MVP, but jurisdiction overlays + automation-mode policy must be a distinct module. | P1 | `core/policy/overlays.ts` + `core/policy/automation.ts`. |
| 10 | Clinician intake UI | **Present (basic)** | [app/intake-routes.ts](app/intake-routes.ts) `INTAKE_HTML` | Works for structured entry. Add narrative textarea + submission to consult workflow (not just OpenEMR write). | P1 | Add narrative field + provenance toggle; redirect submit to `POST /consults`. |
| 11 | PH review UI | **Absent** | — | Need PH workspace: incoming queue, normalized view, missing-data flags, engine advisory, recommendation composer, clarification trigger. | **P0** | New `app/ph-routes.ts` + `PH_HTML`; mirrors intake UI style. |
| 12 | Recommendation composer | **Absent** | — | UI + endpoint to author/edit `ConsultRecommendation`. | **P0** | `POST /consults/:id/recommendation` + composer panel in PH UI. |
| 13 | Return-to-clinician artifact generation | **Absent** | Renderers exist for *intake* views, not *recommendation* views | New renderer transforming `ConsultRecommendation` into clinician-facing addendum/note. | **P0** | `renderers/recommendation-return.ts`. |
| 14 | PH internal note artifact | **Partial** | [renderers/public-health.ts](renderers/public-health.ts) renders intake summary, not internal note | Add PH internal doc stub triggered on recommendation. | P1 | `renderers/ph-internal-note.ts`. |
| 15 | Ministry escalation draft artifact | **Absent** | — | New renderer for escalation; gated by recommendation flag. | P1 | `renderers/escalation-draft.ts`. |
| 16 | Chart note artifact | **Present** | [renderers/clinician.ts](renderers/clinician.ts), [renderers/clinician-v2.ts](renderers/clinician-v2.ts) | Reuse | P2 | Register in transform registry. |
| 17 | JSON export | **Present (implicit)** | Server returns JSON via Hono | Make explicit in artifact bundle. | P2 | `transforms/json.ts`. |
| 18 | FHIR-ish / FHIR-ready export | **Present** | [adapters/fhir.ts](adapters/fhir.ts), [adapters/epic-fhir.ts](adapters/epic-fhir.ts) | Reuse; broaden to consult-level (encounter + QR + recommendation). | P2 | Add `recommendation → FHIR ServiceRequest/Communication` mapping. |
| 19 | Audit trail | **Absent** | Engine has `audit_trail: string[]` per decision only | Need persistent `AuditEvent` log per consult; UI surfacing. | **P0** | `core/consult/audit.ts` + JSON-file or SQLite store. |
| 20 | Automation modes | **Absent** | — | Policy resolves which path applies to a consult. | P1 | `core/policy/automation.ts` returning `PH_REQUIRED \| PH_OPTIONAL \| AUTO_ALLOWED`; consumed by submit handler. |
| 21 | Scenario / demo readiness | **Partial** | [examples/raccoon-bite.ts](examples/raccoon-bite.ts), [examples/intake-raccoon-bite.ts](examples/intake-raccoon-bite.ts) | Examples cover intake → adapter. Missing end-to-end consult demo. | P1 | `examples/consult-loop.ts` walking the closed loop. |
| 22 | Test coverage for workflow states + transforms | **Partial** | Intake/adapter tests strong; no workflow tests | Add state-machine, clarification, recommendation, audit tests. | **P0** (alongside their features) | `tests/consult-state.test.ts`, `tests/clarification.test.ts`, `tests/recommendation.test.ts`, `tests/audit.test.ts`. |
| 23 | Idempotent workflow commands | **Absent** | — | All consult-mutating commands must be safe on retry and dedupe by command key. | **P0** | Add command envelope / idempotency key handling in `core/consult/service.ts` + store-backed command ledger. |
| 24 | Centralized missing-critical-field resolver | **Absent** | — | Clarification targeting cannot live in UI handlers. | **P0** | Add `core/consult/missing-fields.ts` used by submit/review/clarification flows and PH UI. |

**P0 count: 10.**

---

## 5. Canonical target architecture

```
                     ┌─────────────────────────────────────────────────┐
                     │                 INPUT ADAPTERS                  │
                     │  structured form │ typed narrative │ dictation  │
                     └────────────────────────┬────────────────────────┘
                                              │  ProvenancedAnswer[]
                                              ▼
                ┌─────────────────────────────────────────────────────────┐
                │  intake/  (loader → questionnaire → answers → payload)  │
                │  produces ConsultBody (renamed CanonicalCasePayload)    │
                └────────────────────────┬────────────────────────────────┘
                                         │
                                         ▼
              ┌──────────────────────────────────────────────────────────┐
              │  core/consult/   CanonicalConsult aggregate              │
              │     ├─ ConsultBody              (intake-derived)         │
              │     ├─ Parties                  (typed actor refs)       │
              │     ├─ State (current, derived from event log)           │
              │     ├─ EngineDecision[]         (advisory, deterministic)│
              │     ├─ ClarificationThread[]                             │
              │     ├─ ConsultRecommendation?   (PH-authored)            │
              │     └─ EscalationThread?        (side stream)            │
              └──────┬───────────────────────────────────────┬───────────┘
                     │                                       │
                     ▼                                       ▼
   ┌─────────────────────────────┐         ┌────────────────────────────────┐
   │  core/engine/  (DETERMINISTIC) │         │  core/policy/                  │
   │  - rabies rules             │         │  - zone/jurisdiction overlays  │
   │  - returns EngineDecision   │         │  - automation mode resolver    │
   └─────────────────────────────┘         └────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────────────────────────────────┐
        │  core/transforms/  ArtifactRegistry                            │
        │   chart-note │ ph-summary │ ph-workspace │ escalation-draft    │
        │   return-to-clinician │ json │ fhir │ openemr-encounter │ dhis2│
        │   derived outputs only; never authoritative state             │
        └────────────────────────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────────────────────────────────┐
        │  app/  (Hono)                                                  │
        │   /consults (POST), /consults/:id (GET),                       │
        │   /consults/:id/clarifications (POST),                         │
        │   /consults/:id/clarifications/:cid/response (POST),           │
        │   /consults/:id/recommendation (POST),                         │
        │   /consults/:id/recommendation/return (POST),                  │
        │   /consults/:id/acknowledge (POST),                            │
        │   /consults/:id/audit (GET),                                   │
        │   /intake (clinician UI), /ph (PH review UI)                   │
        └────────────────────────────────────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────────────────────────────────┐
        │  store/  JSON-file or better-sqlite3                           │
        │   consults table + audit_events table (append-only)            │
        └────────────────────────────────────────────────────────────────┘
```

### How "RaDE as engine" becomes "RaDE as consult relay" without destroying the good parts
- Keep `intake/*` verbatim; add `ProvenancedAnswer` envelope without breaking existing `AnswerValue` (composition, not replacement).
- Promote `CanonicalCasePayload` into `ConsultBody`; have the new `CanonicalConsult` wrap it.
- `core/engine.ts` becomes one *advisor* whose output (`EngineDecision`) is attached to the consult — not the terminal artifact.
- Renderers + adapters remain pure functions registered into a `transforms/` registry; the workflow service composes the bundle. The resulting `ArtifactBundle` is cached convenience output, not state.
- All consult-mutating commands flow through a single idempotent service layer keyed by command ID / idempotency key.
- Missing critical fields and clarification targets are computed centrally and reused by API + UI.
- Hono server gains a small consult-routing module; existing `/intake` keeps working.
- Legacy modules are first deprecated and wrapped in place. Physical moves are deferred until workflow tests cover the new consult path.

---

## 6. Recommended domain objects / contracts

### `CanonicalConsult`
- **Purpose:** single source of truth for a consult transaction.
- **Min fields:** `consult_id`, `created_at`, `updated_at`, `module_id` (`"rabies"`), `schema_version`, `automation_mode`, `parties { submitter, reviewer?, supervisor? }`, `body: ConsultBody`, `engine_decisions: EngineDecision[]`, `clarifications: ClarificationThread[]`, `recommendation?: ConsultRecommendation`, `escalation?: EscalationThread`, `state: ConsultState`.
- **Relation to existing:** wraps `CanonicalCasePayload` (rename `body` → `ConsultBody`); supersedes `CaseEnvelope`.
- **Verdict:** **new** (small wrapper over existing payload).

### `ActorRef`
- **Purpose:** typed, auditable identity attached to commands, events, provenance, and acknowledgments.
- **Min fields:** `actor_id`, `role ∈ {clinician_submitter, ph_reviewer, ph_supervisor, system}`, `display_name`, `organization_id?`.
- **Relation to existing:** new; used anywhere the current repo passes strings like `submitted_by` or `authored_by`.
- **Verdict:** **new**.

### `ConsultRequest`
- **Purpose:** the submission event itself (immutable record of who asked, when, how).
- **Min fields:** `request_id`, `consult_id`, `submitted_by: ActorRef`, `submitted_at`, `requested_automation_mode`, `target_queue`, `original_intake_snapshot_hash`, `idempotency_key`.
- **Relation:** new; emitted from `submitConsult` command.
- **Verdict:** **new**.

### `ClarificationRequest`
- **Purpose:** PH asks for missing/ambiguous data.
- **Min fields:** `clarification_id`, `consult_id`, `requested_by: ActorRef`, `requested_at`, `target_question_ids: string[]`, `freeform_question?: string`, `due_by?`, `resolver_snapshot`.
- **Relation:** new; lives inside `ClarificationThread`.
- **Verdict:** **new**.

### `ClarificationResponse` (a.k.a. `UpdatedConsult` event)
- **Purpose:** clinician's reply patches the consult body.
- **Min fields:** `response_id`, `clarification_id`, `responded_by: ActorRef`, `responded_at`, `answer_patches: ProvenancedAnswer[]`, `narrative_update?: string`, `idempotency_key`.
- **Verdict:** **new**.

### `ConsultRecommendation`
- **Purpose:** PH-authored, signed recommendation returned to clinician.
- **Min fields:** `recommendation_id`, `consult_id`, `authored_by: ActorRef`, `authored_at`, `returned_to_clinician_at?`, `acknowledged_by?`, `acknowledged_at?`, `category`, `label`, `rationale`, `urgency`, `follow_up_tasks[]`, `escalation_required`, `signed_at`, `engine_decision_ref?`, `policy_overlays_applied[]`.
- **Relation:** distinct from `core/types.ts::Assessment` (which conflates engine output with recommendation). `Assessment` is retired.
- **Verdict:** **new** (replaces `Assessment`).

### `MissingCriticalFieldResolver`
- **Purpose:** centralized authority for unresolved critical fields, clarification targets, and blocking conditions before recommendation return.
- **Min fields:** `resolve(consult): { missing_field_ids: string[]; clarification_targets: string[]; blocking_reasons: string[] }`.
- **Relation:** new; wraps and supersedes ad hoc uses of `payload.unresolved_fields` in handlers/renderers.
- **Verdict:** **new**.

### `EscalationDraft`
- **Purpose:** ministry/upper-tier handoff artifact.
- **Min fields:** `draft_id`, `consult_id`, `recommendation_id`, `body_text`, `attachments_ref[]`, `to_party`.
- **Verdict:** **new** artifact (renderer output).

### `ArtifactBundle`
- **Purpose:** named map of generated artifacts for a consult at a point in time.
- **Min fields:** `bundle_id`, `consult_id`, `generated_at`, `artifacts: Record<string, Artifact>`.
- **Verdict:** **new** thin container; produced by the transform registry.
- **Authority note:** cache/derived only; never the source of truth for consult state.

### `ProvenancedAnswer`
- **Purpose:** answer payload with sufficient audit metadata for traceability and reconciliation.
- **Min fields:** `value`, `source_modality`, `confidence`, `status`, `captured_by: ActorRef`, `captured_at`, `last_confirmed_by?: ActorRef`, `last_confirmed_at?: string`.
- **Relation to existing:** wraps `AnswerValue` from [intake/answers.ts](intake/answers.ts).
- **Verdict:** **new** wrapper; backward-compatible defaults required.

### `AuditEvent`
- **Purpose:** immutable log entry; consult state is derived from these.
- **Min fields:** `event_id`, `consult_id`, `event_type`, `at`, `actor: ActorRef`, `from_state?`, `to_state?`, `payload_ref`, `idempotency_key?`.
- **Event types:** `consult_drafted`, `consult_submitted`, `engine_decision_recorded`, `clarification_requested`, `clarification_responded`, `recommendation_authored`, `recommendation_returned`, `recommendation_acknowledged`, `escalation_requested`, `escalation_drafted`, `consult_closed`.
- **Verdict:** **new**.

### `ConsultState` (enum)
`DRAFT | SUBMITTED | AWAITING_PH_REVIEW | CLARIFICATION_REQUESTED | CLARIFICATION_PROVIDED | RECOMMENDATION_AUTHORED | RECOMMENDATION_RETURNED | ACKNOWLEDGED | CLOSED | CANCELLED`

---

## 7. File-level implementation plan

### Phase 0 — Naming / architecture cleanup (no behavior change)
- **Goal:** deprecate legacy v1 paths safely and set the new layout without early file churn.
- **Touch:**
  - Mark `Assessment`, `CaseEnvelope`, `WorkflowStatus` in [core/types.ts](core/types.ts) as `@deprecated`.
  - Add thin compatibility wrappers that forward legacy callers toward the new consult service boundary.
  - Add `core/consult/` and `core/transforms/` empty modules with README stubs.
- **Acceptance:** `npm test` still green; no public API removed.
- **Risk:** low.

### Phase 1 — Canonical consult contracts
- **Goal:** introduce the unified consult aggregate and provenance envelope.
- **Files:**
  - **new** `core/consult/types.ts` — `CanonicalConsult`, `ActorRef`, `ConsultRequest`, `ClarificationRequest`, `ClarificationResponse`, `ConsultRecommendation`, `EscalationDraft`, `ArtifactBundle`, `Parties`, `AutomationMode`.
  - **new** `intake/provenance.ts` — `ProvenancedAnswer`, `SourceModality`, `FieldStatus`.
  - **edit** `intake/answers.ts` — add `withProvenance()` helper; keep legacy `Ans` constructors.
  - **edit** `intake/payload.ts` — emit `is_missing | is_unconfirmed | is_confirmed` per answer based on provenance.
  - **new** `core/consult/missing-fields.ts` — centralized resolver for missing critical fields and clarification targets.
- **Deps:** Phase 0.
- **Acceptance:** new types compile; `payload.ts` exposes provenance fields with safe defaults for legacy callers.
- **Risk:** medium (don't break existing payload consumers).

### Phase 2 — State machine + workflow API + persistence
- **Files:**
  - **new** `core/consult/state.ts` — linear enum + transition guard; escalation modeled separately.
  - **new** `core/consult/audit.ts` — `AuditEvent`, `appendEvent`, `replayState`.
  - **new** `core/consult/store.ts` — JSON-file store (`./data/runtime/consults/*.json`) behind `ConsultStore` interface; SQLite later.
  - **new** `core/consult/service.ts` — `submitConsult`, `recordEngineDecision`, `requestClarification`, `provideClarification`, `authorRecommendation`, `returnRecommendation`, `acknowledge`, `escalate`, `close`.
  - **new** `core/consult/idempotency.ts` — command envelope / dedupe ledger / replay-safe results.
  - **new** `app/consult-routes.ts` — Hono routes per the API map below; mounted at `/consults`.
  - **edit** `app/server.ts` — `app.route("/consults", consult)`.
  - **new** `tests/consult-state.test.ts`, `tests/consult-service.test.ts`.
- **Deps:** Phase 1.
- **Acceptance:** can submit a consult, append events, replay state; state-machine rejects illegal transitions; duplicate POST retries with the same idempotency key do not duplicate side effects.
- **Risk:** medium (correct event-sourced state derivation + retry semantics).

### Phase 3 — Transform / artifact layer
- **Files:**
  - **new** `core/transforms/registry.ts` — `registerTransform`, `runBundle(consult, names)`.
  - **new** `core/transforms/chart-note.ts` — wraps existing `renderClinicianIntake`.
  - **new** `core/transforms/ph-summary.ts` — wraps existing `renderPublicHealth`.
  - **new** `core/transforms/ph-workspace.ts` — structured object for PH UI.
  - **new** `core/transforms/return-to-clinician.ts` — renders `ConsultRecommendation`.
  - **new** `core/transforms/escalation-draft.ts`.
  - **new** `core/transforms/json.ts`, `core/transforms/fhir.ts` (wraps `buildFhirOutput`), `core/transforms/openemr.ts` (wraps `buildOpenEmrOutput`), `core/transforms/dhis2.ts`.
  - **edit** `app/consult-routes.ts` — `GET /consults/:id/artifacts/:name`.
- **Deps:** Phase 2.
- **Acceptance:** registry produces artifact bundle for a sample consult; all transforms unit-tested via fixture; deleting/regenerating artifacts does not affect consult state.
- **Risk:** low (mostly thin wrappers).

### Phase 4 — Clinician intake UI (consult-aware)
- **Files:**
  - **edit** [app/intake-routes.ts](app/intake-routes.ts) — submit posts to `POST /consults` (not directly to OpenEMR); add narrative textarea; per-answer modality dropdown (default `clicked`).
  - **edit** `INTAKE_HTML` — show consult ID after submission and link to status page.
  - **new** `app/consult-status-page.ts` — minimal HTML showing current state + last artifact links.
- **Deps:** Phase 2/3.
- **Acceptance:** clinician can submit and see consult in `AWAITING_PH_REVIEW`.
- **Risk:** low.

### Phase 5 — PH review UI
- **Files:**
  - **new** `app/ph-routes.ts` — list pending consults, open detail, render workspace transform, recommendation composer, clarification button, escalation toggle.
  - **new** `PH_QUEUE_HTML`, `PH_DETAIL_HTML` (inline like intake form).
- **Deps:** Phase 3.
- **Acceptance:** PH user can see queue, open consult, draft recommendation, save.
- **Risk:** medium (UX).

### Phase 6 — Clarification loop
- **Files:**
  - **edit** `app/consult-routes.ts` — clarification endpoints.
  - **edit** PH detail page — "Request clarification" UI bound to question IDs from `core/consult/missing-fields.ts`.
  - **edit** clinician status page — show pending clarifications + form to answer.
  - **new** `tests/clarification.test.ts`.
- **Deps:** Phase 5.
- **Acceptance:** PH requests, clinician answers, state transitions verified.
- **Risk:** medium.

### Phase 7 — Recommendation return + audit + automation modes
- **Files:**
  - **edit** `core/consult/service.ts` — author, then return recommendation as distinct idempotent commands; trigger return-to-clinician + ph-internal-note + (optional) escalation-draft transforms.
  - **new** `core/policy/automation.ts` — `resolveAutomationMode(consult): AutomationMode`.
  - **edit** submit path — apply automation mode (PH_REQUIRED short-circuits engine auto-issue; AUTO_ALLOWED may author + return low-risk recommendations, but authored and returned remain distinct audit events).
  - **new** `app/audit-routes.ts` — `GET /consults/:id/audit`.
  - **new** `tests/recommendation.test.ts`, `tests/audit.test.ts`, `tests/automation-mode.test.ts`.
  - **edit** clinician status page — acknowledge button.
- **Deps:** Phase 6.
- **Acceptance:** end-to-end loop closes; full audit log visible; all three automation modes covered by tests.
- **Risk:** medium.

---

## 8. MVP demo path (first vertical slice)

**Use case:** raccoon bite reported in Ontario.

1. Clinician opens `/intake`, selects patient, fills the rabies intake form (existing UI), optionally pastes a brief narrative; submits.
2. `POST /consults` creates `CanonicalConsult` (state `SUBMITTED → AWAITING_PH_REVIEW`); `EngineDecision` recorded as advisory; OpenEMR write flow triggered as a transform (existing code). The command is safe on retry via idempotency key.
3. PH user opens `/ph`, sees one queued consult, opens it. PH workspace shows normalized fields + missing-data flags + engine advisory + rationale.
4. PH clicks "Request clarification" on `c25` (animal availability). `ClarificationRequest` event appended; state → `CLARIFICATION_REQUESTED`. Clinician sees the request on `/consults/:id/status`, supplies the answer; state → `CLARIFICATION_PROVIDED → AWAITING_PH_REVIEW`.
5. PH composes recommendation (category, urgency, rationale, follow-up tasks); signs it. State → `RECOMMENDATION_AUTHORED`.
6. PH returns the authored recommendation to the clinician. State → `RECOMMENDATION_RETURNED`. System auto-renders return-to-clinician note, PH internal note stub, JSON, FHIR.
7. Clinician sees the returned recommendation, acknowledges. State → `ACKNOWLEDGED → CLOSED`.
8. `GET /consults/:id/audit` shows the full event timeline.

**Minimum code to make this real (delta from today):**
- `core/consult/{types,state,audit,store,service,idempotency,missing-fields}.ts`
- `core/transforms/{registry,chart-note,ph-workspace,return-to-clinician}.ts`
- `app/consult-routes.ts`, `app/ph-routes.ts`, plus inline HTML for PH queue/detail
- Status-page edits to existing intake HTML
- Tests for state machine, clarification, recommendation, audit, idempotency

---

## 9. Deferred items (explicitly out of MVP)

- Generic clinical chatbot / open-ended LLM Q&A.
- Speech-to-text dictation backend (stub only — accept narrative text for MVP, integrate ASR later).
- Arbitrary EHR interoperability beyond OpenEMR + 1–2 FHIR shapes.
- Outbreak surveillance / population-level analytics.
- Production ministry integration (escalation-draft is generated, not transmitted).
- Full multi-disease abstraction (`module_id` field exists; second module deferred).
- Autonomous LLM-issued clinical recommendations.
- Full canonical decision-flow execution from [data/canonical/rade_canonical_rabies_flow_v1.json](data/canonical/rade_canonical_rabies_flow_v1.json) — current rule engine is sufficient for MVP advisory.
- Real-time multi-user concurrency / locking (single-writer file store is fine for the slice).
- Auth/SSO beyond a header-based actor stub.

---

## 10. Final recommendation

**Continue in the current repo, but refactor around new boundaries.**

Justification:
- The intake → payload → renderer/adapter substrate is genuinely reusable and well-tested. Throwing it away would discard the most expensive parts to rebuild.
- The required pivot is *additive*: a new `core/consult/` package, a transform registry, two new HTTP modules, two new HTML pages, a JSON-file store, and an idempotency layer. None of this requires displacing existing code.
- The two real refactors (collapsing v1 vs. v2 intake stacks; replacing `Assessment`/`CaseEnvelope` with `CanonicalConsult` + `ConsultRecommendation`) are bounded and best done inside the existing repo with tests in place. Legacy modules should be deprecated and wrapped first, not moved early.
- A second repo would force re-importing intake, engine, adapters, server scaffolding, and test fixtures — pure cost, no benefit.

The single most important architectural change: **introduce `CanonicalConsult` + `ConsultState` + `AuditEvent` log, and force every state-changing operation through a `core/consult/service.ts` command surface.** Everything else (PH UI, clarification loop, recommendation return, automation modes) is a straightforward consequence of that decision.

---

## Appendix A — Proposed module map

```
core/
  consult/        types | state | audit | store | service |
                  idempotency | missing-fields
  engine/         rabies (renamed from core/engine.ts)
  policy/         overlays | automation
  transforms/     registry | chart-note | ph-summary | ph-workspace |
                  return-to-clinician | escalation-draft | json | fhir |
                  openemr | dhis2
intake/           loader | questionnaire | answers | payload | provenance
adapters/         (unchanged — used by transforms/)
renderers/        (unchanged — used by transforms/)
manifests/        (unchanged)
app/              server | intake-routes | consult-routes | ph-routes |
                  audit-routes | openemr-client | openemr-flow
store/            data/runtime/consults/<id>.json (created at runtime)
```

## Appendix B — Proposed API route map

| Method | Path | Purpose |
|---|---|---|
| POST | `/consults` | Submit a new consult (body = ConsultRequest + intake answers; requires idempotency key) |
| GET | `/consults/:id` | Fetch full consult |
| GET | `/consults/:id/state` | Lightweight current state |
| GET | `/consults/:id/audit` | Audit event log |
| GET | `/consults/:id/artifacts` | List available artifact names |
| GET | `/consults/:id/artifacts/:name` | Render a named artifact (e.g. `chart-note`, `return-to-clinician`, `fhir`) |
| POST | `/consults/:id/clarifications` | PH requests clarification (idempotent) |
| POST | `/consults/:id/clarifications/:cid/response` | Clinician answers (idempotent) |
| POST | `/consults/:id/recommendation` | PH authors / signs recommendation (idempotent) |
| POST | `/consults/:id/recommendation/return` | Mark recommendation as returned to clinician (idempotent) |
| POST | `/consults/:id/acknowledge` | Clinician acknowledges (idempotent) |
| POST | `/consults/:id/escalate` | Generate escalation draft / append escalation event (idempotent) |
| POST | `/consults/:id/close` | Close consult (idempotent) |
| GET | `/intake` | Clinician intake UI (existing) |
| GET | `/ph` | PH review queue UI (new) |
| GET | `/ph/consults/:id` | PH detail / composer (new) |
| GET | `/consults/:id/status` | Clinician status / clarification UI (new) |

## Appendix C — Proposed `ConsultState` enum
```ts
export type ConsultState =
  | "DRAFT"
  | "SUBMITTED"
  | "AWAITING_PH_REVIEW"
  | "CLARIFICATION_REQUESTED"
  | "CLARIFICATION_PROVIDED"
  | "RECOMMENDATION_AUTHORED"
  | "RECOMMENDATION_RETURNED"
  | "ACKNOWLEDGED"
  | "CLOSED"
  | "CANCELLED";
```

## Appendix D — Proposed artifact transform registry
```ts
type Transform = (consult: CanonicalConsult) => Artifact;

registerTransform("chart-note",            chartNoteTransform);
registerTransform("ph-summary",            phSummaryTransform);
registerTransform("ph-workspace",          phWorkspaceTransform);
registerTransform("return-to-clinician",   returnToClinicianTransform);
registerTransform("ph-internal-note",      phInternalNoteTransform);
registerTransform("escalation-draft",      escalationDraftTransform);
registerTransform("json",                  jsonTransform);
registerTransform("fhir",                  fhirTransform);
registerTransform("openemr-encounter",     openEmrEncounterTransform);
registerTransform("dhis2-tracker",         dhis2TrackerTransform);

// Derived cache only: deleting or regenerating artifacts must not mutate
// consult state or replace the audit log as source of truth.
```

## Appendix E — Proposed directory layout for new workflow modules
```
core/consult/
  types.ts          CanonicalConsult, ConsultRequest, ClarificationRequest,
                    ClarificationResponse, ConsultRecommendation, EscalationDraft,
                    ArtifactBundle, Parties, ActorRef, AutomationMode
  state.ts          ConsultState enum + transition table + guards
  audit.ts          AuditEvent + appendEvent + replayState
  store.ts          ConsultStore interface + JsonFileConsultStore
  idempotency.ts    command dedupe ledger + retry-safe command envelope
  missing-fields.ts centralized critical-field / clarification resolver
  service.ts        submitConsult, recordEngineDecision,
                    requestClarification, provideClarification,
                    authorRecommendation, returnRecommendation,
                    acknowledge, escalate, close
  index.ts          barrel
```
