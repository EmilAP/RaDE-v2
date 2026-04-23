// ---------------------------------------------------------------------------
// rade-v2 — Policy overlay scaffold
// ---------------------------------------------------------------------------

import type { CanonicalCasePayload } from "../../intake/payload.js";
import type { CanonicalConsult } from "../consult/types.js";

export type PolicyOverlayKind = "jurisdiction" | "automation";

export type PolicyOverlay = {
  overlay_id: string;
  kind: PolicyOverlayKind;
  description: string;
};

export function resolvePolicyOverlays(input: {
  payload?: CanonicalCasePayload;
  consult?: CanonicalConsult;
} = {}): PolicyOverlay[] {
  const payload = input.payload ?? input.consult?.body.payload;
  const overlays: PolicyOverlay[] = [
    {
      overlay_id: "overlay:automation:default-ph-required",
      kind: "automation",
      description: "Default MVP automation policy requires PH review.",
    },
  ];

  const location = getFreeTextAnswer(payload, "c03")?.toLowerCase();
  if (location?.includes("ontario")) {
    overlays.unshift({
      overlay_id: "overlay:jurisdiction:ontario",
      kind: "jurisdiction",
      description: "Ontario location detected; no jurisdiction-specific automation override is applied in this pass.",
    });
  }

  return overlays;
}

function getFreeTextAnswer(
  payload: CanonicalCasePayload | undefined,
  questionId: string,
): string | undefined {
  if (!payload) {
    return undefined;
  }

  for (const section of payload.sections) {
    const answer = section.answers.find((entry) => entry.question_id === questionId);
    if (answer?.is_answered && answer.raw_value.kind === "free_text") {
      return answer.raw_value.value;
    }
  }

  return undefined;
}