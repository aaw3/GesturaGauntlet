"use client";

import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import {
  Activity,
  BarChart3,
  Clock3,
  Cpu,
  Hand,
  Network,
  RefreshCw,
  Settings,
  Signal,
  Zap,
} from "lucide-react";

import { SystemStatusPanel } from "@/components/dashboard/system-status-panel";
import { NetworkStatusIndicator } from "@/components/dashboard/network-status-indicator";
import { LiveSensorData } from "@/components/dashboard/live-sensor-data";

type NetworkStatus = "connected" | "disconnected" | "unknown";
type GloveMode = "active" | "passive";

interface SensorStatus {
  sampleCount: number;
  lastUpdatedAt: string | null;
  source: string | null;
}

interface SensorData {
  roll: number;
  pitch: number;
  roll_deg: number;
  pitch_deg: number;
  x: number;
  y: number;
  z: number;
  gx: number;
  gy: number;
  gz: number;
  pressure: number;
}

interface BackendStatus {
  mode?: GloveMode;
  managers?: unknown[];
  nodes?: unknown[];
  deviceCount?: number;
  system?: {
    websocketHub?: {
      connectedGloveCount?: number;
      connectedNodeCount?: number;
      connectedDashboardCount?: number;
    };
    telemetry?: {
      recentEventCount?: number;
      recentRouteMetricCount?: number;
    };
    database?: {
      configured?: boolean;
      connected?: boolean;
    };
    influxdb?: {
      enabled?: boolean;
      status?: string;
    };
  };
}

const emptySensorData: SensorData = {
  roll: 0,
  pitch: 0,
  roll_deg: 0,
  pitch_deg: 0,
  x: 0,
  y: 0,
  z: 0,
  gx: 0,
  gy: 0,
  gz: 0,
  pressure: 0,
};

let socket: Socket | null = null;

export default function Dashboard() {
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("unknown");
  const [activeMode, setActiveMode] = useState<GloveMode>("passive");
  const [sensorData, setSensorData] = useState<SensorData>(emptySensorData);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>({
    sampleCount: 0,
    lastUpdatedAt: null,
    source: null,
  });
  const [showSensorData, setShowSensorData] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [statusLatencyMs, setStatusLatencyMs] = useState<number | null>(null);
  const [lastStatusSync, setLastStatusSync] = useState<string | null>(null);
  const [managerCount, setManagerCount] = useState(0);
  const [nodeCount, setNodeCount] = useState(0);
  const [deviceCount, setDeviceCount] = useState(0);
  const [connectedGloves, setConnectedGloves] = useState(0);
  const [telemetryEvents, setTelemetryEvents] = useState(0);
  const [databaseState, setDatabaseState] = useState("memory");
  const [influxState, setInfluxState] = useState("disabled");

  useEffect(() => {
    socket = io(resolveBackendSocketUrl(), { withCredentials: true });

    socket.on("connect", () => {
      setNetworkStatus("connected");
      socket?.emit("getMode");
    });

    socket.on("disconnect", () => {
      setNetworkStatus("disconnected");
    });

    socket.on("connect_error", () => {
      setNetworkStatus("disconnected");
    });

    socket.on("modeUpdate", (newMode: string) => {
      const normalizedMode = newMode?.toLowerCase();
      if (normalizedMode === "active" || normalizedMode === "passive") {
        setActiveMode(normalizedMode);
      }
    });

    socket.on("managers", (managers: unknown[]) => {
      setManagerCount(Array.isArray(managers) ? managers.length : 0);
    });

    socket.on("nodes", (nodes: unknown[]) => {
      setNodeCount(Array.isArray(nodes) ? nodes.length : 0);
    });

    socket.on("devices", (devices: unknown[]) => {
      setDeviceCount(Array.isArray(devices) ? devices.length : 0);
    });

    socket.on("sensorData", (data: Partial<SensorData> & { timestamp?: string; source?: string }) => {
      if (isSimulating) return;

      const normalized = normalizeSensorData(data);
      setSensorData(normalized);
      setSensorStatus((current) => ({
        sampleCount: current.sampleCount + 1,
        lastUpdatedAt: data.timestamp ?? new Date().toISOString(),
        source: data.source ?? current.source ?? "websocket",
      }));
    });

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [isSimulating]);

  useEffect(() => {
    let interval: NodeJS.Timeout | undefined;

    if (isSimulating) {
      interval = setInterval(() => {
        setSensorData({
          roll: Number((Math.random() * 2 - 1).toFixed(3)),
          pitch: Number((Math.random() * 2 - 1).toFixed(3)),
          roll_deg: Number((Math.random() * 180 - 90).toFixed(1)),
          pitch_deg: Number((Math.random() * 180 - 90).toFixed(1)),
          x: Number((Math.random() * 2 - 1).toFixed(3)),
          y: Number((Math.random() * 2 - 1).toFixed(3)),
          z: Number((Math.random() * 2 - 1).toFixed(3)),
          gx: Number((Math.random() * 250 - 125).toFixed(3)),
          gy: Number((Math.random() * 250 - 125).toFixed(3)),
          gz: Number((Math.random() * 250 - 125).toFixed(3)),
          pressure: Number((Math.random() * 100).toFixed(1)),
        });
        setSensorStatus((current) => ({
          sampleCount: current.sampleCount + 1,
          lastUpdatedAt: new Date().toISOString(),
          source: "simulator",
        }));
      }, 500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSimulating]);

  useEffect(() => {
    if (!showSensorData || isSimulating) return;

    const requestSnapshot = () => {
      socket?.emit("requestSensorSnapshot", { gloveId: "primary_glove" });
    };

    requestSnapshot();
    const interval = setInterval(requestSnapshot, 500);
    return () => clearInterval(interval);
  }, [showSensorData, isSimulating]);

  const refreshStatus = async () => {
    const startedAt = performance.now();

    try {
      const response = await fetch("/api/status", { credentials: "include" });
      if (!response.ok) throw new Error(`Status ${response.status}`);

      const data = (await response.json()) as BackendStatus;
      setStatusLatencyMs(Math.round(performance.now() - startedAt));
      setLastStatusSync(new Date().toLocaleTimeString());
      setNetworkStatus("connected");

      if (data.mode === "active" || data.mode === "passive") setActiveMode(data.mode);
      if (Array.isArray(data.managers)) setManagerCount(data.managers.length);
      if (Array.isArray(data.nodes)) setNodeCount(data.nodes.length);
      if (typeof data.deviceCount === "number") setDeviceCount(data.deviceCount);

      const websocketHub = data.system?.websocketHub;
      setConnectedGloves(Number(websocketHub?.connectedGloveCount ?? 0));

      const telemetry = data.system?.telemetry;
      setTelemetryEvents(Number(telemetry?.recentEventCount ?? 0));

      const database = data.system?.database;
      setDatabaseState(database?.configured ? (database.connected ? "postgres" : "offline") : "memory");
      setInfluxState(data.system?.influxdb?.status ?? "disabled");
    } catch {
      setStatusLatencyMs(null);
      setNetworkStatus((current) => (current === "connected" ? current : "disconnected"));
    }
  };

  useEffect(() => {
    void refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const sensorAge = useMemo(() => {
    if (!sensorStatus.lastUpdatedAt) return "No samples";

    const ageMs = Date.now() - new Date(sensorStatus.lastUpdatedAt).getTime();
    if (!Number.isFinite(ageMs)) return "Unknown";
    if (ageMs < 1000) return "Live";
    return `${Math.round(ageMs / 1000)}s ago`;
  }, [sensorStatus.lastUpdatedAt]);

  const handleModeChange = (mode: GloveMode) => {
    setActiveMode(mode);
    if (socket?.connected) socket.emit("setMode", mode);
  };

  const handleRefresh = () => {
    socket?.emit("getMode");
    void refreshStatus();
  };

  const metrics = [
    { label: "Device managers", value: managerCount.toLocaleString(), icon: BarChart3 },
    { label: "Imported devices", value: deviceCount.toLocaleString(), icon: Cpu },
    { label: "Connected gloves", value: connectedGloves.toLocaleString(), icon: Hand },
    { label: "REST latency", value: statusLatencyMs === null ? "Unavailable" : `${statusLatencyMs} ms`, icon: Clock3 },
  ];

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 text-primary ring-1 ring-primary/20">
              <Hand className="h-6 w-6" />
            </div>
            <div>
              <h1 className="bg-gradient-to-r from-primary via-primary to-foreground bg-clip-text text-2xl font-bold tracking-tight text-transparent">
                Gestura Gauntlet
              </h1>
              <p className="text-sm text-muted-foreground">IoT Wearable Control Center</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <nav className="flex h-10 items-center gap-1 rounded-lg border border-border bg-card p-1">
              <Link className="inline-flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground" href="/">
                <Activity className="h-4 w-4" />
                Analytics
              </Link>
              <Link className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground" href="/configuration">
                <Settings className="h-4 w-4" />
                Configuration
              </Link>
            </nav>
            <NetworkStatusIndicator status={networkStatus} />
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <SystemStatusPanel
              activeMode={activeMode}
              onModeChange={handleModeChange}
              onRefresh={handleRefresh}
            />
          </div>

          <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-card-foreground">Connection Info</h2>
            </div>
            <div className="space-y-3">
              <InfoRow label="Dashboard socket" value={networkStatus} />
              <InfoRow label="Glove transport" value="/glove websocket" />
              <InfoRow label="Last sync" value={lastStatusSync ?? "Pending"} />
              <InfoRow label="Sensor source" value={sensorStatus.source ?? "waiting"} />
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {metrics.map((metric) => (
                <MetricTile key={metric.label} {...metric} />
              ))}
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="grid gap-6 xl:grid-cols-2">
              <RuntimeCard
                title="Backend Runtime"
                icon={Network}
                rows={[
                  ["Nodes", nodeCount.toLocaleString()],
                  ["Database", databaseState],
                  ["InfluxDB", influxState],
                  ["Telemetry events", telemetryEvents.toLocaleString()],
                ]}
              />
              <RuntimeCard
                title="Glove Runtime"
                icon={Zap}
                rows={[
                  ["Mode", activeMode],
                  ["Realtime transport", "websocket"],
                  ["Sensor samples", sensorStatus.sampleCount.toLocaleString()],
                  ["Last sensor update", sensorAge],
                ]}
              />
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-4 ring-1 ring-primary/5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold text-card-foreground">Sensor Stream</h2>
                <p className="text-sm text-muted-foreground">
                  Hidden by default so the Pico only sends debug snapshots when requested.
                </p>
              </div>
              <button
                onClick={() => setShowSensorData((current) => !current)}
                className={`rounded-lg border px-4 py-2 text-sm font-medium transition ${
                  showSensorData
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-secondary/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                {showSensorData ? "Hide live data" : "Show live data"}
              </button>
            </div>

            {showSensorData ? (
              <LiveSensorData
                sensorData={sensorData}
                isSimulating={isSimulating}
                onToggleSimulation={() => setIsSimulating((current) => !current)}
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-3">
                <InfoTile label="Latest roll input" value={sensorData.roll.toFixed(3)} />
                <InfoTile label="Latest pitch input" value={sensorData.pitch.toFixed(3)} />
                <InfoTile label="Telemetry state" value={sensorStatus.lastUpdatedAt ? "available" : "idle"} />
              </div>
            )}
          </div>
        </div>

        <footer className="mt-8 border-t border-border/50 pt-6 text-center text-xs text-muted-foreground">
          <p>
            Gestura Gauntlet Dashboard v1.0 <span className="text-primary">•</span> Realtime IoT Control Interface
          </p>
        </footer>
      </div>
    </div>
  );
}

function resolveBackendSocketUrl() {
  if (process.env.NEXT_PUBLIC_GESTURA_BACKEND_URL) {
    return process.env.NEXT_PUBLIC_GESTURA_BACKEND_URL;
  }

  if (typeof window === "undefined") return undefined;

  if (window.location.port === "3000" || window.location.port === "3100") {
    return `${window.location.protocol}//${window.location.hostname}:3001`;
  }

  return undefined;
}

function normalizeSensorData(data: Partial<SensorData>): SensorData {
  return {
    roll: Number(data.roll ?? data.x ?? 0),
    pitch: Number(data.pitch ?? data.y ?? 0),
    roll_deg: Number(data.roll_deg ?? 0),
    pitch_deg: Number(data.pitch_deg ?? 0),
    x: Number(data.x ?? 0),
    y: Number(data.y ?? 0),
    z: Number(data.z ?? 0),
    gx: Number(data.gx ?? 0),
    gy: Number(data.gy ?? 0),
    gz: Number(data.gz ?? 0),
    pressure: Number(data.pressure ?? 0),
  };
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-5 ring-1 ring-primary/5">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-2 truncate font-mono text-xl font-bold text-foreground">{value}</div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: ElementType;
}) {
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-5 ring-1 ring-primary/5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="truncate text-2xl font-bold tracking-tight text-foreground">{value}</div>
    </div>
  );
}

function RuntimeCard({
  title,
  icon: Icon,
  rows,
}: {
  title: string;
  icon: ElementType;
  rows: Array<[string, string]>;
}) {
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-card-foreground">{title}</h2>
      </div>
      <div className="space-y-3">
        {rows.map(([label, value]) => (
          <InfoRow key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  );
}
