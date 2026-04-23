const DEFAULT_LAN_COOLDOWN_MS = 15_000;
const DEFAULT_RECENT_LAN_MS = 60_000;

function chooseManagerRoute(manager, state = {}, now = Date.now()) {
  const interfaces = [...(manager.interfaces || [])].sort(
    (left, right) => (left.priority ?? 100) - (right.priority ?? 100)
  );
  const lan = interfaces.find((item) => item.kind === 'lan');
  const pub = interfaces.find((item) => item.kind === 'public');
  const lanCoolingDown = Boolean(state.lanCooldownUntil && state.lanCooldownUntil > now);
  const lanRecentlyHealthy = Boolean(
    state.lastLanSuccessAt && now - state.lastLanSuccessAt <= DEFAULT_RECENT_LAN_MS
  );

  if (lan && !lanCoolingDown && (lanRecentlyHealthy || state.activeRoute !== 'public')) {
    return lan;
  }
  return pub || lan || null;
}

function markRouteSuccess(state, routeKind, now = Date.now()) {
  const next = { ...state, activeRoute: routeKind };
  if (routeKind === 'lan') {
    next.lastLanSuccessAt = now;
    next.lanCooldownUntil = undefined;
  }
  if (routeKind === 'public') next.lastPublicSuccessAt = now;
  return next;
}

function markRouteFailure(state, routeKind, now = Date.now(), cooldownMs = DEFAULT_LAN_COOLDOWN_MS) {
  const next = { ...state };
  if (routeKind === 'lan') {
    next.lastLanFailureAt = now;
    next.lanCooldownUntil = now + cooldownMs;
    if (next.activeRoute === 'lan') next.activeRoute = 'public';
  }
  return next;
}

module.exports = {
  DEFAULT_LAN_COOLDOWN_MS,
  DEFAULT_RECENT_LAN_MS,
  chooseManagerRoute,
  markRouteFailure,
  markRouteSuccess,
};
