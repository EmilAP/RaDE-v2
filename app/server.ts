// ---------------------------------------------------------------------------
// rade-v2 — HTTP server (Hono)
// ---------------------------------------------------------------------------

import { createAdaptorServer } from "@hono/node-server";
import { Hono } from "hono";
import type { AddressInfo } from "node:net";
import type { AssessmentInput } from "../core/types";
import { runAssessment } from "../core/pipeline";
import { renderClinicianNote } from "../renderers/clinician";
import { buildFhirOutput } from "../adapters/fhir";
import intake from "./intake-routes";
import consults from "./consult-routes";
import ph from "./ph-routes";

const app = new Hono();

// Mount intake UI + OpenEMR integration
app.route("/intake", intake);
app.route("/consults", consults);
app.route("/ph", ph);

app.get("/", (c) =>
  c.json({
    name: "RaDE v2",
    version: "2.0.0",
    endpoints: {
      "GET /health": "Health check",
      "POST /assess": "Run rabies exposure assessment",
      "GET /intake": "Rabies PEP intake form (UI)",
      "GET /intake/questions": "Canonical questionnaire JSON",
      "GET /intake/patients": "List OpenEMR patients",
      "POST /intake/submit": "Submit intake → OpenEMR",
      "GET /consults": "List consult relay items",
      "POST /consults": "Submit consult to the workflow-first relay",
      "GET /ph": "Public health review queue",
    },
  }),
);

app.get("/health", (c) => c.json({ status: "ok", version: "2.0.0" }));

app.post("/assess", async (c) => {
  const input = await c.req.json<AssessmentInput>();

  if (!input.country || !input.bat_involved) {
    return c.json({ error: "Required fields: country, bat_involved" }, 400);
  }

  const { envelope } = runAssessment(input);
  const clinician = renderClinicianNote(envelope);
  const fhir = buildFhirOutput(envelope);

  return c.json({ envelope, clinician, fhir });
});

const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 10;

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}

function startServer(): void {
  const requestedPort = parsePort(process.env.PORT);
  const host = process.env.HOST ?? "0.0.0.0";

  listenWithFallback({
    host,
    preferredPort: requestedPort ?? DEFAULT_PORT,
    allowFallback: requestedPort === undefined,
    attemptsRemaining: MAX_PORT_ATTEMPTS,
  });
}

function listenWithFallback(options: {
  host: string;
  preferredPort: number;
  allowFallback: boolean;
  attemptsRemaining: number;
}): void {
  const server = createAdaptorServer({ fetch: app.fetch });

  server.once("error", (error: NodeJS.ErrnoException) => {
    if (
      error.code === "EADDRINUSE" &&
      options.allowFallback &&
      options.attemptsRemaining > 1
    ) {
      const nextPort = options.preferredPort + 1;
      console.warn(
        `Port ${options.preferredPort} is already in use. Trying ${nextPort} instead.`,
      );
      listenWithFallback({
        ...options,
        preferredPort: nextPort,
        attemptsRemaining: options.attemptsRemaining - 1,
      });
      return;
    }

    if (error.code === "EADDRINUSE") {
      console.error(
        `Port ${options.preferredPort} is already in use. Set PORT to a free port or stop the other process.`,
      );
      process.exitCode = 1;
      return;
    }

    throw error;
  });

  server.listen(options.preferredPort, options.host, () => {
    const address = server.address() as AddressInfo | null;
    const port = address?.port ?? options.preferredPort;
    console.log(`RaDE v2 listening on http://localhost:${port}`);
  });
}

function parsePort(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT value: ${value}`);
  }
  return port;
}

export default app;
