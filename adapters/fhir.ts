// ---------------------------------------------------------------------------
// rade-v2 — FHIR R4 adapter
//
// Converts a CaseEnvelope into a FHIR R4 Bundle (collection) and a CDS
// Hooks–style card. Produces structurally valid FHIR resources without
// requiring any FHIR library dependency.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import type {
  CaseEnvelope,
  CdsCard,
  FhirBundle,
  FhirBundleEntry,
  FhirResource,
} from "../core/types";

export type FhirOutput = {
  bundle: FhirBundle;
  cds_card: CdsCard;
};

export function buildFhirOutput(envelope: CaseEnvelope): FhirOutput {
  const c = envelope.case;
  const a = envelope.assessment!;
  const entries: FhirBundleEntry[] = [];

  // ── Patient ──────────────────────────────────────────────────────────────
  const patientId = c.case_id;
  entries.push(
    entry("Patient", patientId, {
      resourceType: "Patient",
      id: patientId,
      identifier: [{ system: "urn:rade:case", value: c.case_id }],
      ...(c.patient.age_years !== undefined && {
        extension: [
          {
            url: "http://hl7.org/fhir/StructureDefinition/patient-age",
            valueAge: { value: c.patient.age_years, unit: "years" },
          },
        ],
      }),
    }),
  );

  // ── Observation (exposure) ───────────────────────────────────────────────
  const obsId = randomUUID();
  entries.push(
    entry("Observation", obsId, {
      resourceType: "Observation",
      id: obsId,
      status: "final",
      code: {
        coding: [
          {
            system: "http://loinc.org",
            code: "56799-0",
            display: "Animal exposure",
          },
        ],
        text: "Rabies exposure assessment",
      },
      subject: { reference: `urn:rade:Patient/${patientId}` },
      component: [
        ...(c.exposure.animal_type
          ? [{ code: { text: "Animal type" }, valueString: c.exposure.animal_type }]
          : []),
        ...(c.exposure.bat_involved
          ? [{ code: { text: "Bat involved" }, valueString: c.exposure.bat_involved }]
          : []),
        {
          code: { text: "Location" },
          valueString: `${c.exposure.country}/${c.exposure.subnational_unit}`,
        },
      ],
    }),
  );

  // ── RiskAssessment ───────────────────────────────────────────────────────
  const raId = randomUUID();
  entries.push(
    entry("RiskAssessment", raId, {
      resourceType: "RiskAssessment",
      id: raId,
      status: "final",
      subject: { reference: `urn:rade:Patient/${patientId}` },
      basis: [{ reference: `urn:rade:Observation/${obsId}` }],
      prediction: [
        {
          qualitativeRisk: { text: a.risk_snapshot.overall_risk_tier },
          outcome: { text: a.recommendation.label },
        },
      ],
    }),
  );

  // ── ServiceRequest (recommendation) ──────────────────────────────────────
  const srId = randomUUID();
  entries.push(
    entry("ServiceRequest", srId, {
      resourceType: "ServiceRequest",
      id: srId,
      status: "active",
      intent: "order",
      priority: a.recommendation.requires_escalation ? "urgent" : "routine",
      subject: { reference: `urn:rade:Patient/${patientId}` },
      code: { text: a.recommendation.label },
      reasonReference: [{ reference: `urn:rade:RiskAssessment/${raId}` }],
    }),
  );

  // ── Tasks ────────────────────────────────────────────────────────────────
  for (const task of a.follow_up_tasks) {
    entries.push(
      entry("Task", task.task_id, {
        resourceType: "Task",
        id: task.task_id,
        status: "requested",
        intent: "order",
        priority:
          task.priority === "urgent"
            ? "urgent"
            : task.priority === "important"
              ? "asap"
              : "routine",
        description: task.label,
        for: { reference: `urn:rade:Patient/${patientId}` },
      }),
    );
  }

  // ── Bundle ───────────────────────────────────────────────────────────────
  const bundle: FhirBundle = {
    resourceType: "Bundle",
    type: "collection",
    id: randomUUID(),
    timestamp: a.timestamp,
    entry: entries,
  };

  // ── CDS card ─────────────────────────────────────────────────────────────
  const tier = a.risk_snapshot.overall_risk_tier;
  const cds_card: CdsCard = {
    summary: a.recommendation.label,
    detail: a.rationale.summary,
    indicator:
      tier === "high" ? "critical" : tier === "moderate" ? "warning" : "info",
    source: { label: "RaDE Clinical Decision Support v2" },
  };

  return { bundle, cds_card };
}

// ── Helper ─────────────────────────────────────────────────────────────────

function entry(
  resourceType: string,
  id: string,
  resource: FhirResource,
): FhirBundleEntry {
  return {
    fullUrl: `urn:rade:${resourceType}/${id}`,
    resource,
  };
}
