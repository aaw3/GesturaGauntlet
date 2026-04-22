import { GloveEvent, GloveSignal, GloveStatus } from "../types/glove";
import { InputSource } from "../types/mapping";
import { DeviceActionRequest } from "../types/api";
import { mappingToAction } from "../managers/base/CapabilityHelpers";
import { ActionRouter } from "./ActionRouter";
import { MappingService } from "./MappingService";

export class GloveStateService {
  private statuses = new Map<string, GloveStatus>();

  constructor(
    private mappingService: MappingService,
    private actionRouter: ActionRouter,
  ) {}

  getStatus(gloveId: string): GloveStatus | undefined {
    return this.statuses.get(gloveId);
  }

  updateStatus(status: GloveStatus): GloveStatus {
    this.statuses.set(status.gloveId, status);
    return status;
  }

  async handleEvent(event: GloveEvent) {
    const mappings = this.mappingService.findForInput(event.gloveId, event.type as InputSource);
    return Promise.all(
      mappings
        .map((mapping) => mappingToAction(mapping, 1))
        .filter(isAction)
        .map((action) => this.actionRouter.execute(action)),
    );
  }

  async handleSignal(signal: GloveSignal) {
    const inputSource = `glove.${signal.signal}` as InputSource;
    const mappings = this.mappingService.findForInput(signal.gloveId, inputSource);

    return Promise.all(
      mappings
        .map((mapping) => mappingToAction(mapping, signal.normalized))
        .filter(isAction)
        .map((action) => this.actionRouter.execute(action)),
    );
  }
}

function isAction(action: DeviceActionRequest | null): action is DeviceActionRequest {
  return action !== null;
}
