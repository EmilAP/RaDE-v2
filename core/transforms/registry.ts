// ---------------------------------------------------------------------------
// rade-v2 — Consult transform registry
// ---------------------------------------------------------------------------

import type { CanonicalConsult, ConsultArtifact } from "../consult/types.js";

export type ConsultTransform = (consult: CanonicalConsult) => ConsultArtifact;

export type ConsultTransformGroup = "human-readable" | "neutral-machine" | "system-adapter";

export type ConsultTransformAvailability = "real" | "scaffolded";

export type ConsultTransformDescriptor = {
  artifact_name: string;
  group: ConsultTransformGroup;
  availability: ConsultTransformAvailability;
  description: string;
  gap_reason?: string;
};

type StoredTransformDescriptor = ConsultTransformDescriptor & {
  transform?: ConsultTransform;
};

export class ConsultTransformRegistry {
  private readonly transforms = new Map<string, StoredTransformDescriptor>();

  register(descriptor: ConsultTransformDescriptor, transform: ConsultTransform): void {
    this.transforms.set(descriptor.artifact_name, {
      ...descriptor,
      transform,
    });
  }

  registerScaffold(descriptor: ConsultTransformDescriptor): void {
    this.transforms.set(descriptor.artifact_name, descriptor);
  }

  get(name: string): ConsultTransform | undefined {
    return this.transforms.get(name)?.transform;
  }

  getDescriptor(name: string): ConsultTransformDescriptor | undefined {
    const descriptor = this.transforms.get(name);
    if (!descriptor) {
      return undefined;
    }

    return {
      artifact_name: descriptor.artifact_name,
      group: descriptor.group,
      availability: descriptor.availability,
      description: descriptor.description,
      gap_reason: descriptor.gap_reason,
    };
  }

  render(name: string, consult: CanonicalConsult): ConsultArtifact {
    const descriptor = this.transforms.get(name);
    if (!descriptor) {
      throw new Error(`Unknown artifact: ${name}`);
    }
    if (!descriptor.transform) {
      throw new Error(descriptor.gap_reason ?? `Artifact is scaffolded but not yet implemented: ${name}`);
    }

    return descriptor.transform(consult);
  }

  list(): ConsultTransformDescriptor[] {
    return [...this.transforms.values()]
      .map((descriptor) => ({
        artifact_name: descriptor.artifact_name,
        group: descriptor.group,
        availability: descriptor.availability,
        description: descriptor.description,
        gap_reason: descriptor.gap_reason,
      }))
      .sort((left, right) => left.artifact_name.localeCompare(right.artifact_name));
  }
}