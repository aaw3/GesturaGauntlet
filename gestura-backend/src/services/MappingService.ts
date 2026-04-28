import { ID } from "../types/common";
import { GloveMapping, InputSource } from "../types/mapping";

export class MappingService {
  private mappings = new Map<ID, GloveMapping>();

  list(gloveId?: ID): GloveMapping[] {
    const all = Array.from(this.mappings.values());
    return gloveId ? all.filter((mapping) => mapping.gloveId === gloveId) : all;
  }

  get(id: ID): GloveMapping | undefined {
    return this.mappings.get(id);
  }

  upsert(mapping: GloveMapping): GloveMapping {
    this.mappings.set(mapping.id, mapping);
    return mapping;
  }

  replaceForDevice(deviceId: ID, mappings: GloveMapping[]) {
    for (const mapping of this.list()) {
      if (mapping.targetDeviceId === deviceId) {
        this.mappings.delete(mapping.id);
      }
    }

    for (const mapping of mappings) {
      this.upsert(mapping);
    }

    return this.list().filter((mapping) => mapping.targetDeviceId === deviceId);
  }

  remove(id: ID): boolean {
    return this.mappings.delete(id);
  }

  findForInput(gloveId: ID, inputSource: InputSource): GloveMapping[] {
    return this.list(gloveId).filter(
      (mapping) => mapping.enabled && mapping.inputSource === inputSource,
    );
  }
}
