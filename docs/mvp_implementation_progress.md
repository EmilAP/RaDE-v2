# MVP Implementation Progress

## Implemented in this pass

- Added an explicit `correctConsultFacts` service-layer command plus `consult_facts_corrected` audit events so key consult facts can be corrected without silently mutating history; updated authoritative consult state, missing-field resolution, and derived artifacts all rerender from the corrected answers.
- Added structured answer-review sections to both the clinician status page and PH detail page so users can see the core consult facts on record, which facts are driving review, which remain missing, which are clarification-targeted, and which were recently corrected.
- Added a narrow clinician correction form on the status page for selected core rabies-review facts, with correction notes and optional narrative replacement, while explicitly keeping the edit surface small and auditable rather than building a general full-form editor.
- Improved PH-side and clinician-side recommendation readability, and upgraded the return-to-clinician artifact so it now shows recommendation category/disposition, rationale, urgency, follow-up tasks, PH review status, reviewer/timestamps, and the current consult facts on record.
- Added focused regression coverage for correction-state updates, appended audit history, missing-field recomputation after correction, corrected artifact rerendering, and the new answer-review/correction UI markers.
- Removed raw JSON dumps from the primary intake, PH, and clinician workflow views and replaced them with readable summary panels, recommendation text, and timeline-oriented status cues.
- Added shared consult-view helpers so the PH detail page and clinician status page both surface the same key facts, current state, outstanding issues, and latest workflow action at the top of the page.
- Strengthened `core/consult/missing-fields.ts` so rabies-review gaps are split into blocking review fields versus follow-up fields, including conditional bat-specific context when the species remains bat-related.
- Added minimal intake guardrails that hide bat-specific questions for clear non-bat species selections and reject contradictory bat/non-bat combinations on submit.
- Added focused usability tests covering UI legibility, submitted-state visibility, workflow timeline rendering, missing-field classification, and contradictory intake warnings.
- Moved automation-mode resolution into `core/consult/service.ts` so `submitConsult` is now the authoritative policy boundary; route handlers only pass optional hints/inputs and return the service-owned resolution.
- Expanded `core/policy/automation.ts` to preserve the resolved submission mode on persisted consult views while keeping current automation behavior honest and scaffolded.
- Added focused automation regression coverage in `tests/automation-mode.test.ts` for service-layer resolution, `PH_REQUIRED`, currently scaffolded `PH_OPTIONAL` / `AUTO_ALLOWED` handling, idempotent submit retries, and audit replay/state integrity.
- Added `examples/consult-loop.ts` plus `npm run example:consult-loop` to demonstrate the current closed-loop rabies consult workflow from submission through clarification, recommendation return, acknowledgement, and visible audit progression.
- Added the workflow-first consult core under `core/consult/`: contracts, linear state machine, audit events/replay, JSON-file persistence, idempotent command handling, centralized missing-critical-field resolution, and the consult service.
- Added an interim engine-advisory shape that supports `not_implemented`, `advisory_only`, and `partial_rules_applied`; consult submission works even with only the stub advisory.
- Added the workflow route layer in `app/consult-routes.ts` and mounted it in `app/server.ts`.
- Added a minimal PH queue/detail UI in `app/ph-routes.ts` supporting queue view, missing-field review, clarification request, recommendation authoring, and recommendation return.
- Threaded answer provenance through the actual intake stack in `intake/answers.ts`, `intake/payload.ts`, `core/consult/missing-fields.ts`, and `core/consult/service.ts`.
- Wired `app/intake-routes.ts` into consult submission, added optional narrative capture, and made OpenEMR a downstream projection instead of the authoritative workflow sink.
- Added `app/consult-status-page.ts` so clinicians can inspect workflow state, respond to clarification requests, and acknowledge returned recommendations.
- Expanded the artifact layer with policy scaffolding, grouped transform descriptors, human-readable wrappers, neutral JSON exports, peer adapter projections, and an explicit scaffolded OpenMRS entry.
- Added the return-to-clinician renderer/transform path and upgraded the transform registry from a name map to a descriptor-backed registry.
- Added a regression test proving artifacts remain derived outputs only and do not mutate authoritative consult state.
- Added workflow tests for state transitions, service happy path, audit replay, retry safety, and clarification flow.

## Remaining from the broader plan

- `app/intake-routes.ts` now creates consults directly through the shared consult service, but it does not yet route through the external `/consults` HTTP surface.
- Automation policy is now resolved inside `submitConsult`, but the current scaffold still keeps workflow handling effectively PH-first and does not yet implement richer automation short-circuit behavior beyond preserving the resolved mode.
- The workflow now supports narrow post-submit fact correction and better fact review, but it still does not provide a full arbitrary answer-editing experience or richer multi-actor identity handling.
- Broader cleanup of legacy wrappers remains pending.

## Deviations from plan

- Idempotency support was implemented in `core/consult/store.ts`, `core/consult/service.ts`, and `core/consult/idempotency.ts` without introducing a broader command bus.
- The workflow-first slice still uses the interim advisory engine stub and does not depend on the full decision tree; even when `PH_OPTIONAL` or `AUTO_ALLOWED` are requested, the current tranche honestly preserves the resolved mode while still routing through the same PH-review-first workflow.
- Intake-to-consult wiring was done by reusing the shared consult service inside `app/intake-routes.ts` rather than by bouncing the submission back through the HTTP route layer.
- Intake constraint logic in this pass stays intentionally narrow: it only blocks obvious bat-versus-non-bat contradictions exposed by the current questionnaire and does not attempt to model full clinical consistency rules.
- Fact correction in this pass stays intentionally narrow as well: it covers selected core consult facts through an explicit correction command instead of introducing a generic full-form editing framework.
- Legacy workflow modules were left in place and only deprecated where necessary; no broad file moves were performed.