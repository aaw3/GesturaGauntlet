class ActionRouter {
  constructor(managerService, deviceRegistry, { routeMetricsService } = {}) {
    this.managerService = managerService;
    this.deviceRegistry = deviceRegistry;
    this.routeMetricsService = routeMetricsService;
  }

  async execute(action) {
    const device = this.deviceRegistry.getById(action.deviceId);
    if (!device) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: 'Device not found in registry',
      };
    }

    const capability = device.capabilities.find((item) => item.id === action.capabilityId);
    if (!capability) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: 'Capability not found',
      };
    }

    const manager = this.managerService.get(device.managerId);
    if (!manager) {
      return {
        ok: false,
        deviceId: action.deviceId,
        capabilityId: action.capabilityId,
        message: `Manager ${device.managerId} not found`,
      };
    }

    const info = typeof manager.getInfo === 'function' ? manager.getInfo() : {};
    const route = chooseRouteKind(info);
    const startedAt = Date.now();
    try {
      const result = await manager.executeAction(action);
      this.routeMetricsService?.record?.({
        managerId: device.managerId,
        deviceId: action.deviceId,
        attemptedRoute: route,
        finalRoute: route,
        success: Boolean(result?.ok),
        latencyMs: Date.now() - startedAt,
        message: result?.message,
      });
      return result;
    } catch (err) {
      this.routeMetricsService?.record?.({
        managerId: device.managerId,
        deviceId: action.deviceId,
        attemptedRoute: route,
        finalRoute: route,
        success: false,
        latencyMs: Date.now() - startedAt,
        message: err.message,
      });
      throw err;
    }
  }
}

function chooseRouteKind(managerInfo) {
  const first = [...(managerInfo.interfaces || [])].sort(
    (left, right) => (left.priority ?? 100) - (right.priority ?? 100)
  )[0];
  return first?.kind || 'public';
}

module.exports = { ActionRouter };
