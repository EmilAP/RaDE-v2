// ---------------------------------------------------------------------------
// rade-v2 — JSON-file consult store with idempotency ledger
// ---------------------------------------------------------------------------

import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuditEvent } from "./audit.js";
import type { CanonicalConsult } from "./types.js";

export type PersistedConsultRecord = {
  consult: CanonicalConsult;
  audit_events: AuditEvent[];
};

export type StoredCommandResult<TResult = unknown> = {
  idempotency_key: string;
  command_name: string;
  consult_id?: string;
  recorded_at: string;
  result: TResult;
};

export interface ConsultStore {
  loadConsultRecord(consultId: string): PersistedConsultRecord | undefined;
  saveConsultRecord(record: PersistedConsultRecord): void;
  listConsultRecords(): PersistedConsultRecord[];
  getCommandResult<TResult = unknown>(
    idempotencyKey: string,
  ): StoredCommandResult<TResult> | undefined;
  saveCommandResult<TResult = unknown>(
    result: StoredCommandResult<TResult>,
  ): void;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = resolve(__dirname, "../../data/runtime/consults");

export class JsonFileConsultStore implements ConsultStore {
  constructor(private readonly rootDir: string = DEFAULT_ROOT) {
    mkdirSync(this.rootDir, { recursive: true });
  }

  loadConsultRecord(consultId: string): PersistedConsultRecord | undefined {
    const path = this.consultPath(consultId);
    if (!existsSync(path)) return undefined;
    return this.readJson<PersistedConsultRecord>(path);
  }

  saveConsultRecord(record: PersistedConsultRecord): void {
    this.writeJson(this.consultPath(record.consult.consult_id), record);
  }

  listConsultRecords(): PersistedConsultRecord[] {
    return readdirSync(this.rootDir)
      .filter((name) => name.endsWith(".json") && name !== "_commands.json")
      .map((name) => this.readJson<PersistedConsultRecord>(join(this.rootDir, name)))
      .sort((left, right) =>
        right.consult.updated_at.localeCompare(left.consult.updated_at),
      );
  }

  getCommandResult<TResult = unknown>(
    idempotencyKey: string,
  ): StoredCommandResult<TResult> | undefined {
    const ledger = this.readCommandLedger<TResult>();
    return ledger[idempotencyKey];
  }

  saveCommandResult<TResult = unknown>(
    result: StoredCommandResult<TResult>,
  ): void {
    const ledger = this.readCommandLedger<TResult>();
    ledger[result.idempotency_key] = result;
    this.writeJson(this.commandLedgerPath(), ledger);
  }

  private consultPath(consultId: string): string {
    return join(this.rootDir, `${consultId}.json`);
  }

  private commandLedgerPath(): string {
    return join(this.rootDir, "_commands.json");
  }

  private readCommandLedger<TResult>(): Record<string, StoredCommandResult<TResult>> {
    const path = this.commandLedgerPath();
    if (!existsSync(path)) return {};
    return this.readJson<Record<string, StoredCommandResult<TResult>>>(path);
  }

  private readJson<T>(filePath: string): T {
    return JSON.parse(readFileSync(filePath, "utf-8")) as T;
  }

  private writeJson(filePath: string, value: unknown): void {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(value, null, 2));
  }
}

export function createDefaultConsultStore(): JsonFileConsultStore {
  return new JsonFileConsultStore();
}