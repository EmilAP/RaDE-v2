// ---------------------------------------------------------------------------
// rade-v2 — Idempotent workflow command helpers
// ---------------------------------------------------------------------------

import type { StoredCommandResult } from "./store.js";

export type IdempotentWorkflowCommand = {
  idempotency_key: string;
};

export function assertReplayCompatible(
  existing: StoredCommandResult<unknown>,
  commandName: string,
): void {
  if (existing.command_name !== commandName) {
    throw new Error(
      `Idempotency key already used for a different command: ${existing.idempotency_key}`,
    );
  }
}