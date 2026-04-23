import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  initialConsultState,
  isTerminalState,
} from "../core/consult/state.js";

describe("consult lifecycle state machine", () => {
  it("starts in DRAFT", () => {
    expect(initialConsultState()).toBe("DRAFT");
  });

  it("allows the audited linear workflow path", () => {
    expect(canTransition("DRAFT", "SUBMITTED")).toBe(true);
    expect(canTransition("SUBMITTED", "AWAITING_PH_REVIEW")).toBe(true);
    expect(canTransition("AWAITING_PH_REVIEW", "CLARIFICATION_REQUESTED")).toBe(true);
    expect(canTransition("CLARIFICATION_REQUESTED", "CLARIFICATION_PROVIDED")).toBe(true);
    expect(canTransition("CLARIFICATION_PROVIDED", "AWAITING_PH_REVIEW")).toBe(true);
    expect(canTransition("AWAITING_PH_REVIEW", "RECOMMENDATION_AUTHORED")).toBe(true);
    expect(canTransition("RECOMMENDATION_AUTHORED", "RECOMMENDATION_RETURNED")).toBe(true);
    expect(canTransition("RECOMMENDATION_RETURNED", "ACKNOWLEDGED")).toBe(true);
    expect(canTransition("ACKNOWLEDGED", "CLOSED")).toBe(true);
  });

  it("rejects skipping milestones", () => {
    expect(canTransition("AWAITING_PH_REVIEW", "RECOMMENDATION_RETURNED")).toBe(false);
    expect(canTransition("RECOMMENDATION_AUTHORED", "ACKNOWLEDGED")).toBe(false);
    expect(canTransition("CLARIFICATION_REQUESTED", "AWAITING_PH_REVIEW")).toBe(false);
    expect(() =>
      assertTransition("AWAITING_PH_REVIEW", "RECOMMENDATION_RETURNED"),
    ).toThrow("Invalid consult transition");
  });

  it("treats CLOSED and CANCELLED as terminal", () => {
    expect(isTerminalState("CLOSED")).toBe(true);
    expect(isTerminalState("CANCELLED")).toBe(true);
    expect(isTerminalState("ACKNOWLEDGED")).toBe(false);
  });
});