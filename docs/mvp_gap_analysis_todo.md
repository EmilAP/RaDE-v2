# MVP Gap Analysis — Execution Checklist

Companion to [mvp_gap_analysis_consult_relay.md](mvp_gap_analysis_consult_relay.md).
Strict P0 → P1 → P2 ordering. Check off items as completed.

## P0 — must land before any demo is credible

### Consult contracts
- [x] **Create `core/consult/types.ts`** with `CanonicalConsult`, `ActorRef`, `ConsultRequest`, `ClarificationRequest`, `ClarificationResponse`, `ConsultRecommendation`, `EscalationDraft`, `ArtifactBundle`, `Parties`, `AutomationMode`.
- [x] **Deprecate `Assessment`, `CaseEnvelope`, `WorkflowStatus`** in [core/types.ts](core/types.ts); add `@deprecated` JSDoc; keep exports until callers migrate.
- [ ] **Add compatibility wrappers for legacy paths** in [core/intake.ts](core/intake.ts), [core/envelope.ts](core/envelope.ts), [core/pipeline.ts](core/pipeline.ts); do not move files until consult workflow tests are green.

### State machine + audit + store
- [x] **Create `core/consult/state.ts`** — linear `ConsultState` enum + transition table + `assertTransition()`; keep escalation outside the primary lifecycle.
- [x] **Create `core/consult/audit.ts`** — `AuditEvent` types, `appendEvent`, `replayState(events): ConsultState`.
- [x] **Create `core/consult/store.ts`** — `ConsultStore` interface + JSON-file impl writing to `data/runtime/consults/<id>.json`.
- [x] **Create `core/consult/service.ts`** — idempotent `submitConsult`, `recordEngineDecision`, `requestClarification`, `provideClarification`, `authorRecommendation`, `returnRecommendation`, `acknowledge`, `escalate`, `close`.
- [x] **Create `core/consult/idempotency.ts`** — command ledger / idempotency-key dedupe for all consult workflow writes.
- [x] **Create `core/consult/missing-fields.ts`** — centralized missing critical field and clarification-target resolver.

### Workflow API + PH UI + recommendation composer
- [x] **Create `app/consult-routes.ts`** with full route map (see Appendix B in the audit doc); require idempotency keys on mutating routes; mount in [app/server.ts](app/server.ts).
- [x] **Create `app/ph-routes.ts`** + inline `PH_QUEUE_HTML` and `PH_DETAIL_HTML`.
- [x] **Create `core/transforms/return-to-clinician.ts`** + `core/transforms/ph-workspace.ts` + `core/transforms/registry.ts`.
- [x] **Create `renderers/recommendation-return.ts`** producing clinician-facing addendum from `ConsultRecommendation`.
- [x] **Keep artifact bundles non-authoritative** — document and test that transforms are derived caches only.

### Workflow tests
- [x] `tests/consult-state.test.ts` — every legal/illegal transition.
- [x] `tests/consult-service.test.ts` — submit → engine decision → recommendation authored → returned → acknowledged happy path.
- [x] `tests/audit.test.ts` — event log derives correct state across edge cases.
- [x] `tests/idempotency.test.ts` — duplicate command retries do not duplicate state changes or side effects.

## P1 — required for the full closed-loop MVP demo

### Provenance & modality-agnostic intake
- [x] **Create `intake/provenance.ts`** — `ProvenancedAnswer`, `SourceModality ∈ {dictated, typed, clicked, inferred}`, `FieldStatus ∈ {confirmed, unconfirmed, missing}`, `captured_by`, `captured_at`, `last_confirmed_by`, `last_confirmed_at`.
- [x] **Edit [intake/answers.ts](intake/answers.ts)** — add `withProvenance()` helper; preserve legacy `Ans` constructors.
- [x] **Edit [intake/payload.ts](intake/payload.ts)** — surface `status`/`modality`/`confidence` in `NormalizedAnswer`.
- [ ] **Edit [app/intake-routes.ts](app/intake-routes.ts)** — add narrative textarea + per-answer modality default; submit posts to `POST /consults`.

### Clarification loop
- [x] **Edit `app/consult-routes.ts`** — clarification endpoints.
- [x] **Edit PH detail page** — "Request clarification" UI bound to question IDs emitted by `core/consult/missing-fields.ts`.
- [x] **Create `app/consult-status-page.ts`** — clinician sees pending clarifications + answer form.
- [x] **Add `tests/clarification.test.ts`**.

### Automation modes + policy overlay separation
- [x] **Create `core/policy/automation.ts`** — `resolveAutomationMode(consult): "PH_REQUIRED" | "PH_OPTIONAL" | "AUTO_ALLOWED"`.
- [x] **Create `core/policy/overlays.ts`** — extract zone/jurisdiction logic from [core/catalog.ts](core/catalog.ts) (or re-export); document overlay contract.
- [x] **Wire automation mode into `submitConsult`** — short-circuit logic + tests (`tests/automation-mode.test.ts`).

### Additional artifacts
- [x] **Create `core/transforms/{chart-note,ph-summary,json,fhir,openemr,dhis2}.ts`** — thin wrappers over existing renderers/adapters.
- [x] **Create `renderers/ph-internal-note.ts`** + `renderers/escalation-draft.ts`.

### Demo example
- [x] **Create `examples/consult-loop.ts`** — scripted end-to-end raccoon-bite consult walkthrough.

### Workflow legibility hardening
- [x] **Remove raw JSON from primary workflow views** in [app/intake-routes.ts](app/intake-routes.ts), [app/ph-routes.ts](app/ph-routes.ts), and [app/consult-status-page.ts](app/consult-status-page.ts); keep the main UI human-readable.
- [x] **Strengthen `core/consult/missing-fields.ts`** — classify blocking vs follow-up missing fields for core rabies review context and surface them clearly in the PH / clinician views.
- [x] **Add minimal intake contradiction guardrails** in [app/intake-routes.ts](app/intake-routes.ts) for bat-specific answers versus clear non-bat species selection.

### Fact review and correction tranche
- [x] **Add structured answer review sections** in [app/consult-status-page.ts](app/consult-status-page.ts) and [app/ph-routes.ts](app/ph-routes.ts) so current consult facts, missing facts, uncertain facts, and clarification-targeted facts are visible without raw JSON.
- [x] **Add an explicit consult fact correction flow** in [core/consult/service.ts](core/consult/service.ts) and [app/consult-routes.ts](app/consult-routes.ts); corrections append audit events, preserve idempotency, and rerender authoritative consult state.
- [x] **Allow clinician correction of selected core facts from the status page** in [app/consult-status-page.ts](app/consult-status-page.ts) while keeping the edit surface intentionally narrow and auditable.
- [x] **Improve the returned recommendation artifact and recommendation readability** in [renderers/recommendation-return.ts](renderers/recommendation-return.ts), [app/ph-routes.ts](app/ph-routes.ts), and [app/consult-status-page.ts](app/consult-status-page.ts) with category/disposition, rationale, urgency, follow-up tasks, PH-review status, and reviewer/timestamp context.
- [x] **Add focused correction-flow and artifact rerender tests** in [tests/correction-flow.test.ts](tests/correction-flow.test.ts), [tests/consult-ui.test.ts](tests/consult-ui.test.ts), and [tests/artifacts.test.ts](tests/artifacts.test.ts).

## P2 — quality-of-life and cleanup, not blocking demo

- [ ] **Rename `core/engine.ts` → `core/engine/rabies.ts`** with `runEngine(consult): EngineDecision` signature.
- [ ] **Retire deprecated legacy wrappers** once all callers migrate; only then consider moving/removing v1 stack and deleting [data/canonical/canonical_rabies_intake_v1.json](data/canonical/canonical_rabies_intake_v1.json).
- [ ] **Add SQLite-backed `ConsultStore`** as an alternative implementation.
- [ ] **FHIR recommendation mapping** — extend [adapters/fhir.ts](adapters/fhir.ts) to emit `ServiceRequest`/`Communication` for the returned recommendation.
- [ ] **Auth stub** — actor identification beyond a header.
- [ ] **Markdown demo writeup** in `docs/mvp-demo.md` covering the closed-loop scenario.
