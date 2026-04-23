import { describe, expect, it } from "vitest";

import { createAuditEvent, replayState } from "../core/consult/audit.js";
import type { ActorRef } from "../core/consult/types.js";

const actor: ActorRef = {
  actor_id: "actor-1",
  role: "system",
  display_name: "System",
};

describe("audit replay", () => {
  it("replays the final consult state from ordered events", () => {
    const consultId = "consult-1";
    const events = [
      createAuditEvent({
        consult_id: consultId,
        event_type: "consult_submitted",
        actor,
        from_state: "DRAFT",
        to_state: "SUBMITTED",
      }),
      createAuditEvent({
        consult_id: consultId,
        event_type: "consult_ready_for_review",
        actor,
        from_state: "SUBMITTED",
        to_state: "AWAITING_PH_REVIEW",
      }),
      createAuditEvent({
        consult_id: consultId,
        event_type: "recommendation_authored",
        actor,
        from_state: "AWAITING_PH_REVIEW",
        to_state: "RECOMMENDATION_AUTHORED",
      }),
      createAuditEvent({
        consult_id: consultId,
        event_type: "recommendation_returned",
        actor,
        from_state: "RECOMMENDATION_AUTHORED",
        to_state: "RECOMMENDATION_RETURNED",
      }),
      createAuditEvent({
        consult_id: consultId,
        event_type: "recommendation_acknowledged",
        actor,
        from_state: "RECOMMENDATION_RETURNED",
        to_state: "ACKNOWLEDGED",
      }),
      createAuditEvent({
        consult_id: consultId,
        event_type: "consult_closed",
        actor,
        from_state: "ACKNOWLEDGED",
        to_state: "CLOSED",
      }),
    ];

    expect(replayState(events)).toBe("CLOSED");
  });
});