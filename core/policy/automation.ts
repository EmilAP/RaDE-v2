// ---------------------------------------------------------------------------
// rade-v2 — Automation policy scaffold
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload } from "../../intake/payload.js";
import type { AutomationMode, CanonicalConsult } from "../consult/types.js";
import { resolvePolicyOverlays } from "./overlays.js";

export type AutomationResolution = {
  mode: AutomationMode;
  policy_overlays_applied: string[];
  rationale: string;
};

export function resolveAutomationMode(input: {
  payload?: CanonicalCasePayload;
  consult?: CanonicalConsult;
  requested_mode?: AutomationMode;
} = {}): AutomationResolution {
  const overlays = resolvePolicyOverlays(input);

  if (input.consult) {
    return {
      mode: input.consult.automation_mode,
      policy_overlays_applied: overlays.map((overlay) => overlay.overlay_id),
      rationale:
        "Persisted consult retains the automation mode resolved at submission time while policy automation remains scaffolded.",
    };
  }

  if (input.requested_mode) {
    return {
      mode: input.requested_mode,
      policy_overlays_applied: overlays.map((overlay) => overlay.overlay_id),
      rationale:
        "Requested automation mode was accepted by the current scaffold policy; downstream workflow behavior remains workflow-first.",
    };
  }

  return {
    mode: "PH_REQUIRED",
    policy_overlays_applied: overlays.map((overlay) => overlay.overlay_id),
    rationale:
      "This workflow-first tranche keeps human PH review mandatory while automation policy is intentionally scaffolded.",
  };
}