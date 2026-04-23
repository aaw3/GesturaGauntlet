import {
  ManagerInterface,
  ManagerInterfaceKind,
  ManagerRouteState,
  RouteAttemptMetric,
} from "./topology";

export interface RouteSelectionPolicy {
  lanCooldownMs: number;
  recentLanHealthyMs: number;
}

export const defaultRouteSelectionPolicy: RouteSelectionPolicy = {
  lanCooldownMs: 15_000,
  recentLanHealthyMs: 60_000,
};

export function chooseManagerInterface(
  interfaces: ManagerInterface[],
  state: ManagerRouteState,
  now = Date.now(),
  policy = defaultRouteSelectionPolicy,
): ManagerInterface | null {
  const sorted = [...interfaces].sort((left, right) => left.priority - right.priority);
  const lan = sorted.find((item) => item.kind === "lan");
  const publicRoute = sorted.find((item) => item.kind === "public");
  const lanCoolingDown = Boolean(state.lanCooldownUntil && state.lanCooldownUntil > now);
  const lanRecentlyHealthy = Boolean(
    state.lastLanSuccessAt && now - state.lastLanSuccessAt <= policy.recentLanHealthyMs,
  );

  if (lan && !lanCoolingDown && (lanRecentlyHealthy || state.activeRoute !== "public")) {
    return lan;
  }

  return publicRoute ?? lan ?? null;
}

export function nextRouteStateAfterAttempt(
  state: ManagerRouteState,
  route: ManagerInterfaceKind,
  success: boolean,
  now = Date.now(),
  policy = defaultRouteSelectionPolicy,
): ManagerRouteState {
  if (success && route === "lan") {
    return { ...state, activeRoute: "lan", lastLanSuccessAt: now, lanCooldownUntil: undefined };
  }
  if (success && route === "public") {
    return { ...state, activeRoute: "public", lastPublicSuccessAt: now };
  }
  if (!success && route === "lan") {
    return {
      ...state,
      activeRoute: "public",
      lastLanFailureAt: now,
      lanCooldownUntil: now + policy.lanCooldownMs,
    };
  }
  return state;
}

export function createRouteAttemptMetric(
  metric: Omit<RouteAttemptMetric, "id" | "ts">,
): Omit<RouteAttemptMetric, "id"> {
  return { ts: Date.now(), ...metric };
}
