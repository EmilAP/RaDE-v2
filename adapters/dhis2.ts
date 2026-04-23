// ---------------------------------------------------------------------------
// rade-v2 — DHIS2 adapter (legacy compat + re-export)
//
// The primary DHIS2 Tracker adapter is now in dhis2-tracker.ts.
// This file re-exports for backward compatibility and provides the
// original buildDhis2Output function signature.
// ---------------------------------------------------------------------------

export {
  buildDhis2Output,
  buildFollowUpEvent,
  type Dhis2Output,
  type Dhis2TrackerPayload,
  type Dhis2TrackedEntity,
  type Dhis2Enrollment,
  type Dhis2Event,
  type Dhis2DataValue,
  type Dhis2ValidationReport,
  type TeiDemographics,
  type FollowUpVisitInput,
} from "./dhis2-tracker.js";
