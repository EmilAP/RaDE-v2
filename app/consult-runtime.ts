// ---------------------------------------------------------------------------
// rade-v2 — Shared consult workflow runtime wiring
// ---------------------------------------------------------------------------

import { createMissingCriticalFieldResolver } from "../core/consult/missing-fields.js";
import { createDefaultConsultStore } from "../core/consult/store.js";
import { createConsultService } from "../core/consult/service.js";
import { ConsultTransformRegistry } from "../core/transforms/registry.js";
import { buildChartNoteArtifact } from "../core/transforms/chart-note.js";
import { buildConsultJsonArtifact } from "../core/transforms/json.js";
import { buildDhis2Artifact } from "../core/transforms/dhis2.js";
import { buildEscalationDraftArtifact } from "../core/transforms/escalation-draft.js";
import { buildFhirArtifact } from "../core/transforms/fhir.js";
import { buildOpenEmrArtifact } from "../core/transforms/openemr.js";
import { buildPhInternalNoteArtifact } from "../core/transforms/ph-internal-note.js";
import { buildPhSummaryArtifact } from "../core/transforms/ph-summary.js";
import { buildReturnToClinicianArtifact } from "../core/transforms/return-to-clinician.js";
import { buildPhWorkspaceArtifact } from "../core/transforms/ph-workspace.js";
import { buildSormasArtifact } from "../core/transforms/sormas.js";
import { buildStructuredConsultArtifact } from "../core/transforms/structured-consult.js";

const store = createDefaultConsultStore();
const resolver = createMissingCriticalFieldResolver();
const service = createConsultService(store, resolver);
const registry = new ConsultTransformRegistry();

registerDefaultConsultTransforms(registry);

export function registerDefaultConsultTransforms(
  target: ConsultTransformRegistry,
): ConsultTransformRegistry {
  target.register(
    {
      artifact_name: "chart-note",
      group: "human-readable",
      availability: "real",
      description: "Clinician-facing chart-ready note draft.",
    },
    buildChartNoteArtifact,
  );
  target.register(
    {
      artifact_name: "escalation-draft",
      group: "human-readable",
      availability: "real",
      description: "Escalation draft derived from the consult and recommendation state.",
    },
    buildEscalationDraftArtifact,
  );
  target.register(
    {
      artifact_name: "ph-internal-note",
      group: "human-readable",
      availability: "real",
      description: "Internal PH documentation stub.",
    },
    buildPhInternalNoteArtifact,
  );
  target.register(
    {
      artifact_name: "ph-summary",
      group: "human-readable",
      availability: "real",
      description: "Human-readable PH summary report.",
    },
    buildPhSummaryArtifact,
  );
  target.register(
    {
      artifact_name: "ph-workspace",
      group: "human-readable",
      availability: "real",
      description: "Structured PH workspace view for review and clarification.",
    },
    (consult) => buildPhWorkspaceArtifact(consult, resolver),
  );
  target.register(
    {
      artifact_name: "return-to-clinician",
      group: "human-readable",
      availability: "real",
      description: "Clinician return note derived from the PH recommendation.",
    },
    buildReturnToClinicianArtifact,
  );
  target.register(
    {
      artifact_name: "json",
      group: "neutral-machine",
      availability: "real",
      description: "Authoritative consult JSON snapshot.",
    },
    buildConsultJsonArtifact,
  );
  target.register(
    {
      artifact_name: "structured-consult",
      group: "neutral-machine",
      availability: "real",
      description: "Neutral structured consult export for downstream processing.",
    },
    buildStructuredConsultArtifact,
  );
  target.register(
    {
      artifact_name: "dhis2",
      group: "system-adapter",
      availability: "real",
      description: "DHIS2 tracker scaffold projection.",
    },
    buildDhis2Artifact,
  );
  target.register(
    {
      artifact_name: "fhir",
      group: "system-adapter",
      availability: "real",
      description: "FHIR projection backed by the current Epic/SMART scaffold.",
    },
    buildFhirArtifact,
  );
  target.register(
    {
      artifact_name: "openemr",
      group: "system-adapter",
      availability: "real",
      description: "OpenEMR adapter scaffold projection.",
    },
    buildOpenEmrArtifact,
  );
  target.registerScaffold({
    artifact_name: "openmrs",
    group: "system-adapter",
    availability: "scaffolded",
    description: "OpenMRS projection target.",
    gap_reason: "No OpenMRS adapter exists in this repository yet.",
  });
  target.register(
    {
      artifact_name: "sormas",
      group: "system-adapter",
      availability: "real",
      description: "SORMAS adapter scaffold projection.",
    },
    buildSormasArtifact,
  );

  return target;
}

export function getConsultService() {
  return service;
}

export function getConsultResolver() {
  return resolver;
}

export function getConsultTransformRegistry() {
  return registry;
}