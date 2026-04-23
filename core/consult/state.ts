// ---------------------------------------------------------------------------
// rade-v2 — Consult lifecycle state machine
// ---------------------------------------------------------------------------

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

const ALLOWED_TRANSITIONS: Record<ConsultState, ConsultState[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["AWAITING_PH_REVIEW", "CANCELLED"],
  AWAITING_PH_REVIEW: [
    "CLARIFICATION_REQUESTED",
    "RECOMMENDATION_AUTHORED",
    "CLOSED",
    "CANCELLED",
  ],
  CLARIFICATION_REQUESTED: ["CLARIFICATION_PROVIDED", "CANCELLED"],
  CLARIFICATION_PROVIDED: ["AWAITING_PH_REVIEW", "CANCELLED"],
  RECOMMENDATION_AUTHORED: ["RECOMMENDATION_RETURNED", "CANCELLED"],
  RECOMMENDATION_RETURNED: ["ACKNOWLEDGED", "CANCELLED"],
  ACKNOWLEDGED: ["CLOSED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(
  from: ConsultState,
  to: ConsultState,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: ConsultState,
  to: ConsultState,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid consult transition: ${from} -> ${to}`);
  }
}

export function isTerminalState(state: ConsultState): boolean {
  return state === "CLOSED" || state === "CANCELLED";
}

export function initialConsultState(): ConsultState {
  return "DRAFT";
}