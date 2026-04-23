// ---------------------------------------------------------------------------
// rade-v2 — Consult audit events and state replay
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import {
  assertTransition,
  initialConsultState,
  type ConsultState,
} from "./state.js";
import type { ActorRef } from "./types.js";

export type AuditEventType =
  | "consult_submitted"
  | "consult_ready_for_review"
  | "consult_facts_corrected"
  | "engine_decision_recorded"
  | "clarification_requested"
  | "clarification_responded"
  | "recommendation_authored"
  | "recommendation_returned"
  | "recommendation_acknowledged"
  | "consult_closed"
  | "escalation_requested";

export type AuditEvent = {
  event_id: string;
  consult_id: string;
  event_type: AuditEventType;
  at: string;
  actor: ActorRef;
  from_state?: ConsultState;
  to_state?: ConsultState;
  idempotency_key?: string;
  payload?: Record<string, unknown>;
};

export function createAuditEvent(input: {
  consult_id: string;
  event_type: AuditEventType;
  actor: ActorRef;
  from_state?: ConsultState;
  to_state?: ConsultState;
  at?: string;
  idempotency_key?: string;
  payload?: Record<string, unknown>;
}): AuditEvent {
  return {
    event_id: randomUUID(),
    consult_id: input.consult_id,
    event_type: input.event_type,
    at: input.at ?? new Date().toISOString(),
    actor: input.actor,
    from_state: input.from_state,
    to_state: input.to_state,
    idempotency_key: input.idempotency_key,
    payload: input.payload,
  };
}

export function replayState(events: AuditEvent[]): ConsultState {
  let current = initialConsultState();

  for (const event of events) {
    if (!event.to_state) continue;
    const from = event.from_state ?? current;
    assertTransition(from, event.to_state);
    current = event.to_state;
  }

  return current;
}

export function appendEvents(
  existing: AuditEvent[],
  next: AuditEvent[],
): AuditEvent[] {
  return [...existing, ...next];
}