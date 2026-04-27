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
        target_device_id: action.deviceId,
        attemptedRoute: route,
        finalRoute: route,
        route_path: route === 'lan' ? 'local_edge' : 'central_server',
        success: Boolean(result?.ok),
        action_success: Boolean(result?.ok),
        fallback_used: false,
        latencyMs: Date.now() - startedAt,
        route_latency_ms: Date.now() - startedAt,
        message: result?.message,
        failure_reason: result?.ok ? undefined : result?.message,
      });
      return result;
    } catch (err) {
      this.routeMetricsService?.record?.({
        managerId: device.managerId,
        deviceId: action.deviceId,
        target_device_id: action.deviceId,
        attemptedRoute: route,
        finalRoute: route,
        route_path: route === 'lan' ? 'local_edge' : 'central_server',
        success: false,
        action_success: false,
        fallback_used: false,
        latencyMs: Date.now() - startedAt,
        route_latency_ms: Date.now() - startedAt,
        message: err.message,
        failure_reason: err.message,
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
