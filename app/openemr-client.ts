// ---------------------------------------------------------------------------
// rade-v2 — OpenEMR REST API client
//
// Handles OAuth2 password-grant auth and writes to the standard REST API.
// FHIR endpoints in OpenEMR are read-only for Encounter/SOAP/Observation,
// so this uses /apis/default/api/ instead.
// ---------------------------------------------------------------------------

// ── Config ─────────────────────────────────────────────────────────────────

export type OpenEmrConfig = {
  baseUrl: string;       // e.g. "https://localhost:9300"
  siteId: string;        // e.g. "default"
  username: string;      // admin user
  password: string;      // admin password
  userRole: "users" | "patient";
  patientEmail?: string;
  clientId?: string;     // populated after registration
  clientSecret?: string; // populated after registration (not used for public client)
};

const DEFAULT_CONFIG: OpenEmrConfig = {
  baseUrl: process.env.OPENEMR_BASE_URL ?? "https://localhost:9300",
  siteId: process.env.OPENEMR_SITE_ID ?? "default",
  username: process.env.OPENEMR_USER ?? "admin",
  password: process.env.OPENEMR_PASS ?? "pass",
  userRole: (process.env.OPENEMR_USER_ROLE as "users" | "patient") ?? "users",
  patientEmail: process.env.OPENEMR_PATIENT_EMAIL,
  clientId: process.env.OPENEMR_CLIENT_ID,
};

let cachedConfig: OpenEmrConfig = { ...DEFAULT_CONFIG };
let cachedToken: { access_token: string; expires_at: number } | null = null;

export function getConfig(): OpenEmrConfig {
  return cachedConfig;
}

export function setConfig(partial: Partial<OpenEmrConfig>): void {
  cachedConfig = { ...cachedConfig, ...partial };
  cachedToken = null; // invalidate token on config change
}

// ── TLS: accept self-signed certs in dev ───────────────────────────────────

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// ── OAuth2 Client Registration ─────────────────────────────────────────────
// One-time: registers a public client for password grant.

export async function registerClient(): Promise<{ client_id: string }> {
  const cfg = cachedConfig;
  const url = `${cfg.baseUrl}/oauth2/${cfg.siteId}/registration`;

  const body = {
    application_type: "private",
    redirect_uris: [],
    post_logout_redirect_uris: [],
    client_name: "RADE Rabies Intake",
    token_endpoint_auth_method: "client_secret_post",
    contacts: [],
    scope: "openid api:oemr api:fhir",
    grant_types: ["password"],
    response_types: [],
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Client registration failed (${res.status}): ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const clientId = data.client_id as string;
  cachedConfig.clientId = clientId;
  if (data.client_secret) {
    cachedConfig.clientSecret = data.client_secret as string;
  }
  return { client_id: clientId };
}

// ── OAuth2 Token (password grant) ──────────────────────────────────────────

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expires_at) {
    return cachedToken.access_token;
  }

  const cfg = cachedConfig;

  if (!cfg.clientId) {
    console.log("[openemr] No client_id found — registering new OAuth2 client…");
    await registerClient();
  }

  const url = `${cfg.baseUrl}/oauth2/${cfg.siteId}/token`;

  const params = new URLSearchParams({
    grant_type: "password",
    username: cfg.username,
    password: cfg.password,
    client_id: cfg.clientId!,
    scope: [
      "openid",
      "offline_access",
      "api:oemr",
      "api:fhir",
      "user/patient.crus",
      "user/encounter.crus",
      "user/vital.crus",
      "user/Patient.read",
      "user/Patient.write",
      "user/Encounter.read",
      "user/Observation.read",
    ].join(" "),
    user_role: cfg.userRole,
  });

  if (cfg.userRole === "patient" && cfg.patientEmail) {
    params.set("email", cfg.patientEmail);
  }

  if (cfg.clientSecret) {
    params.set("client_secret", cfg.clientSecret);
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  const data = await res.json() as Record<string, unknown>;
  const accessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) ?? 3600;

  cachedToken = {
    access_token: accessToken,
    expires_at: Date.now() + (expiresIn - 60) * 1000, // refresh 60s early
  };

  return accessToken;
}

// ── API helpers ────────────────────────────────────────────────────────────

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  const token = await getAccessToken();
  const url = `${cachedConfig.baseUrl}/apis/${cachedConfig.siteId}/api${path}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

// ── List patients (to find a test patient UUID) ────────────────────────────

export type PatientSummary = {
  uuid: string;
  pid: string;
  fname: string;
  lname: string;
};

export async function listPatients(): Promise<PatientSummary[]> {
  const { status, data } = await apiRequest("GET", "/patient");
  if (status !== 200) {
    throw new Error(`List patients failed (${status}): ${JSON.stringify(data)}`);
  }
  const raw = data as { data?: Array<Record<string, unknown>> };
  return (raw.data ?? []).map((p) => ({
    uuid: p.uuid as string,
    pid: String(p.pid ?? p.id ?? ""),
    fname: (p.fname as string) ?? "",
    lname: (p.lname as string) ?? "",
  }));
}

// ── Create encounter ───────────────────────────────────────────────────────

export type CreateEncounterResult = {
  uuid: string;
  encounter: string;
};

export async function createEncounter(
  patientUuid: string,
  payload: Record<string, string>,
): Promise<CreateEncounterResult> {
  const body = {
    date: new Date().toISOString().slice(0, 10),
    class_code: "AMB",
    facility_id: "3",
    pc_catid: "5",
    sensitivity: "normal",
    ...payload,
  };

  const { status, data } = await apiRequest(
    "POST",
    `/patient/${patientUuid}/encounter`,
    body,
  );

  if (status < 200 || status >= 300) {
    throw new Error(`Create encounter failed (${status}): ${JSON.stringify(data)}`);
  }

  const rec = data as { data?: Record<string, unknown>; uuid?: string; eid?: string; euuid?: string };
  const inner = (rec.data ?? rec) as Record<string, unknown>;
  return {
    uuid: (inner.euuid as string) ?? (inner.uuid as string) ?? "",
    encounter: String(inner.eid ?? inner.encounter ?? ""),
  };
}

// ── Create SOAP note ───────────────────────────────────────────────────────

export type CreateSoapNoteResult = {
  id: string;
};

export async function createSoapNote(
  patientPid: string,
  encounterUuidOrId: string,
  note: {
    subjective: string;
    objective: string;
    assessment: string;
    plan: string;
  },
): Promise<CreateSoapNoteResult> {
  const { status, data } = await apiRequest(
    "POST",
    `/patient/${patientPid}/encounter/${encounterUuidOrId}/soap_note`,
    note,
  );

  if (status < 200 || status >= 300) {
    throw new Error(`Create SOAP note failed (${status}): ${JSON.stringify(data)}`);
  }

  const rec = data as { data?: Record<string, unknown> };
  const inner = rec.data ?? (rec as Record<string, unknown>);
  return { id: String(inner.id ?? inner.sid ?? "") };
}

// ── Create vitals ──────────────────────────────────────────────────────────

export async function createVitals(
  patientUuid: string,
  encounterUuid: string,
  payload: Record<string, string>,
): Promise<{ id: string }> {
  const { status, data } = await apiRequest(
    "POST",
    `/patient/${patientUuid}/encounter/${encounterUuid}/vital`,
    payload,
  );

  if (status < 200 || status >= 300) {
    throw new Error(`Create vitals failed (${status}): ${JSON.stringify(data)}`);
  }

  const rec = data as Record<string, unknown>;
  const inner = (rec.data ?? rec) as Record<string, unknown>;
  return { id: String(inner.vid ?? inner.id ?? inner.fid ?? status) };
}
