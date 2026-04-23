# Animal Exposure Intake and Follow-up Module for DHIS2

> A structured, reusable rabies / animal exposure workflow module that bridges clinical intake data with DHIS2 Tracker for public health operations.

---

## What This Module Does

This module provides a **canonical intake pipeline** for animal exposure (rabies-focused) cases that produces DHIS2 Tracker-compatible export payloads. It captures structured exposure data, generates placeholder assessments, and stages follow-up workflows — all driven by a validated, source-traceable questionnaire.

### Key Capabilities

- **Structured intake capture** — 44 canonical questions covering exposure context, animal identification, exposure characteristics, patient history, and resource availability
- **Validated answer model** — type-safe answer validation against the canonical schema
- **Canonical case payload** — normalized, classified, source-traced payload ready for assessment
- **DHIS2 Tracker export** — TEI + enrollment + events mapped to a 3-stage program
- **Placeholder assessment** — honest risk signal extraction with explicit TODO markers for pending clinical logic
- **Follow-up workflow staging** — repeatable events for PEP vaccine dose tracking
- **Validate-first workflow** — client-side validation + DHIS2 `/api/tracker?importMode=VALIDATE` support

---

## How It Relates to DHIS2

This module treats DHIS2 as the **program execution and tracking surface**:

```
Canonical Intake (RaDE)
  → Validated Answers
  → Canonical Case Payload
  → DHIS2 Mapping Layer
  → Tracker API Payload
     ├─ Stage 1: Exposure Intake (non-repeatable)
     ├─ Stage 2: Assessment & Disposition (repeatable)
     └─ Stage 3: Follow-up Visit (repeatable)
```

### DHIS2 Program Model

| Component | Description |
|-----------|-------------|
| **Program** | Animal Exposure Intake and Follow-up (`WITH_REGISTRATION`) |
| **Tracked Entity Type** | Person (name, DOB, sex, phone, case ID) |
| **Stage 1: Exposure Intake** | All 44 intake questions as data elements in a single non-repeatable event |
| **Stage 2: Assessment & Disposition** | Assessment status, recommendation code, risk signals, follow-up determination. Repeatable for re-assessment |
| **Stage 3: Follow-up Visit** | Vaccine dose number, RIG administration, visit type, outcome status. Repeatable for PEP schedule |

### Why This Design

- **Single intake event** — practical for field use; one form captures the complete exposure report
- **Repeatable assessment** — allows re-assessment as new information arrives (animal test results, observation outcomes)
- **Repeatable follow-up** — supports the standard WHO PEP schedule (days 0, 3, 7, 14, 28) and additional visits

---

## Why It Is Useful Globally

Rabies kills an estimated **59,000 people per year**, with 95% of deaths in Africa and Asia. Current rabies PEP workflows are often:

- Paper-based or unstructured
- Missing standardized intake checklists
- Disconnected from public health surveillance
- Poorly tracked through the multi-dose PEP schedule

This module provides:

1. **Structured intake** derived from WHO SEARO and Ontario clinical decision tools
2. **Source traceability** — every question maps back to WHO/Ontario source IDs
3. **DHIS2-native workflow** — leverages existing DHIS2 infrastructure for tracking
4. **Open-source, reusable design** — not hard-coded to a single country implementation
5. **Future-ready** — designed for plug-in of clinical decision logic when validated

---

## How the Intake Is Structured

The canonical intake is organized into **14 sections** with **44 questions**:

| Section | Questions | Focus |
|---------|-----------|-------|
| Intake status | c01 | PEP already started? |
| Exposure context | c02–c03 | Date, location |
| Animal species | c04 | Animal type identification |
| Bat exposure assessment | c05–c11 | Bat-specific pathway |
| Exposure characteristics | c12–c13 | Type and site of exposure |
| Exposure timing | c14 | Animal alive status |
| High-priority features | c15–c16 | Age, wound severity |
| Wound management | c17 | Wound washing |
| Animal clinical features | c18–c22 | Rabies signs, behavior |
| Animal testing | c23–c24 | Lab testing status |
| Animal availability | c25–c28 | Observation/quarantine feasibility |
| Patient vaccination history | c29–c36 | Prior rabies vaccination |
| Patient current status | c37–c43 | Immunocompromised, pregnant, allergies |
| Resource context | c44 | RIG availability |

### Question Types

- `binary_yn` → DHIS2 `BOOLEAN`
- `ternary_ynu` → DHIS2 `TEXT` with Yes/No/Unknown option set
- `enum` → DHIS2 `TEXT` with question-specific option set
- `multiselect_any` → DHIS2 `LONG_TEXT` (pipe-delimited)
- `datetime` → DHIS2 `DATETIME`
- `free_text` → DHIS2 `LONG_TEXT`

---

## What Is Implemented Now vs Placeholder

### Implemented

- ✅ Full canonical intake schema (44 questions, 14 sections)
- ✅ Answer validation against schema with type checking
- ✅ Canonical case payload builder with derived facts
- ✅ DHIS2 Tracker payload generation (TEI + enrollment + 3 stages)
- ✅ Machine-readable mapping manifest (question → data element)
- ✅ Metadata scaffold for DHIS2 import (program, stages, option sets)
- ✅ Placeholder assessment with risk signal extraction
- ✅ Follow-up event builder for PEP schedule
- ✅ Client-side validation report
- ✅ Validate-first workflow with optional DHIS2 API posting
- ✅ Demo export script with file output

### Placeholder (Awaiting Canonical Rabies Flow)

- ⏳ **Assessment status** — currently `flow_pending`; will be driven by canonical decision flow
- ⏳ **Recommendation code** — currently `manual_review_required`; will be flow-derived
- ⏳ **Decision logic version** — currently `TBD`
- ⏳ **Follow-up determination** — currently manual; will be driven by assessment outcome
- ⏳ **PEP schedule generation** — follow-up events built manually; future auto-generation from assessment
- ⏳ **Risk tier classification** — derived facts extracted but not yet mapped through decision logic

---

## What Would Be Needed for a Live DHIS2 Deployment

### Prerequisites

1. **DHIS2 instance** (2.39+ recommended) with Tracker module enabled
2. **Metadata import** — import the scaffold from `data/dhis2/metadata-scaffold.json` after replacing placeholder UIDs
3. **Org unit hierarchy** — map geographic locations to DHIS2 org units
4. **User access** — appropriate DHIS2 user roles for Tracker data capture

### Steps

1. **Replace placeholder UIDs** — all `RADE_*` identifiers must be replaced with DHIS2-generated UIDs
2. **Import metadata** — `POST /api/metadata` with the scaffold (use `?importMode=VALIDATE` first)
3. **Create option sets** — import option set definitions for enum/choice fields
4. **Configure org units** — set up the org unit hierarchy for your deployment context
5. **Test with VALIDATE** — use `POST /api/tracker?importMode=VALIDATE` to test Tracker payloads
6. **Build or adapt UI** — use the DHIS2 App Platform to build a custom capture app, or use the default Tracker Capture app
7. **Integrate decision logic** — when the canonical rabies flow is finalized, replace placeholder assessment

---

## Quick Start

```bash
# Run the demo export
npx tsx examples/dhis2-export.ts

# Run the validate-first workflow (local only)
npx tsx examples/dhis2-validate.ts

# Run with server-side validation
npx tsx examples/dhis2-validate.ts --post http://localhost:8080

# Run tests
npx vitest run tests/dhis2.test.ts
```

### Output Files

The demo writes to `output/`:

| File | Contents |
|------|----------|
| `dhis2-tracker-payload.json` | Full Tracker API payload (TEI + enrollment + events) |
| `dhis2-mapping-manifest.json` | Machine-readable question → data element mapping |
| `dhis2-validation-report.json` | Client-side validation analysis |
| `canonical-case-payload.json` | Canonical case payload (for reference) |

---

## Project Structure

```
adapters/
  dhis2.ts              # Re-export wrapper (backward compat)
  dhis2-tracker.ts      # Main DHIS2 Tracker adapter
manifests/
  dhis2-mapping.ts      # Machine-readable mapping manifest
  intake-mapping.ts     # Cross-platform mapping manifest
data/
  dhis2/
    metadata-scaffold.json  # DHIS2 metadata import scaffold
  canonical/
    canonical_rabies_intake_v2.json  # Canonical intake schema
examples/
  dhis2-export.ts       # Demo export script
  dhis2-validate.ts     # Validate-first workflow
tests/
  dhis2.test.ts         # DHIS2 adapter tests
docs/
  dhis2-module-overview.md  # This document
```

---

## License

Open source. See repository root for license details.

---

*Built with RaDE (Rabies Decision Engine) — a structured intake and decision support pipeline for animal exposure workflows.*
