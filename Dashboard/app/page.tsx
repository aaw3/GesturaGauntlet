"use client";

import Link from "next/link";
import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import { io, Socket } from "socket.io-client";
import {
  Activity,
  BarChart3,
  Clock3,
  Cpu,
  Gauge,
  Hand,
  Lightbulb,
  Network,
  RefreshCw,
  Settings,
  Signal,
  Zap,
} from "lucide-react";

import { LiveSensorData } from "@/components/dashboard/live-sensor-data";
import { NetworkStatusIndicator } from "@/components/dashboard/network-status-indicator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type NetworkStatus = "connected" | "disconnected" | "unknown";
type GloveMode = "active" | "passive";

interface SensorStatus {
  latest: (SensorData & { timestamp?: string }) | null;
  sampleCount: number;
  lastUpdatedAt: string | null;
  source: string | null;
}

interface SensorData {
  x: number;
  y: number;
  z: number;
  gx: number;
  gy: number;
  gz: number;
}

interface GyroBulbControl {
  enabled: boolean;
  active: boolean;
  axis: string;
  smoothing: number;
  throttleMs: number;
  lastBrightness: number | null;
  pendingBrightness: number | null;
}

const emptySensorData: SensorData = { x: 0, y: 0, z: 0, gx: 0, gy: 0, gz: 0 };

let socket: Socket | null = null;

export default function Dashboard() {
  const [brokerUrl, setBrokerUrl] = useState("http://localhost:3001");
  const [networkStatus, setNetworkStatus] = useState<NetworkStatus>("unknown");
  const [activeMode, setActiveMode] = useState<GloveMode>("passive");
  const [selectedDevice] = useState("desk_lamp");
  const [selectedAction] = useState("brightness");
  const [focusScore, setFocusScore] = useState(75);
  const [sensorData, setSensorData] = useState<SensorData>(emptySensorData);
  const [sensorStatus, setSensorStatus] = useState<SensorStatus>({
    latest: null,
    sampleCount: 0,
    lastUpdatedAt: null,
    source: null,
  });
  const [gyroBulbControl, setGyroBulbControl] = useState<GyroBulbControl | null>(null);
  const [showSensorData, setShowSensorData] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const [statusLatencyMs, setStatusLatencyMs] = useState<number | null>(null);
  const [lastStatusSync, setLastStatusSync] = useState<string | null>(null);

  useEffect(() => {
    socket = io(brokerUrl);

    socket.on("connect", () => {
      setNetworkStatus("connected");
      socket?.emit("getMode");
    });

    socket.on("disconnect", () => {
      setNetworkStatus("disconnected");
    });

    socket.on("modeUpdate", (newMode: string) => {
      const normalizedMode = newMode?.toLowerCase();
      if (normalizedMode === "active" || normalizedMode === "passive") {
        setActiveMode(normalizedMode);
      }
    });

    socket.on("focusScore", (score: number) => {
      setFocusScore(Math.round(score));
    });

    socket.on("sensorStatus", (status: SensorStatus) => {
      setSensorStatus(status);
      if (status.latest) setSensorData(normalizeSensorData(status.latest));
    });

    socket.on("gyroBulbControl", (control: GyroBulbControl) => {
      setGyroBulbControl(control);
    });

    socket.on("gyroBulbUpdate", (update: { brightness?: number }) => {
      setGyroBulbControl((current) =>
        current
          ? {
              ...current,
              lastBrightness: update.brightness ?? current.lastBrightness,
              pendingBrightness: null,
            }
          : current,
      );
    });

    socket.on("sensorData", (data: Partial<SensorData> & { timestamp?: string }) => {
      if (isSimulating) return;
      const normalized = normalizeSensorData(data);
      setSensorData(normalized);
      setSensorStatus((current) => ({
        latest: { ...normalized, timestamp: data.timestamp },
        sampleCount: current.sampleCount + 1,
        lastUpdatedAt: data.timestamp ?? new Date().toISOString(),
        source: current.source ?? "mqtt",
      }));
    });

    return () => {
      socket?.disconnect();
      socket = null;
    };
  }, [brokerUrl, isSimulating]);

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (isSimulating) {
      interval = setInterval(() => {
        setSensorData({
          x: Number((Math.random() * 2 - 1).toFixed(3)),
          y: Number((Math.random() * 2 - 1).toFixed(3)),
          z: Number((Math.random() * 2 - 1).toFixed(3)),
          gx: Number((Math.random() * 250 - 125).toFixed(3)),
          gy: Number((Math.random() * 250 - 125).toFixed(3)),
          gz: Number((Math.random() * 250 - 125).toFixed(3)),
        });
      }, 500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSimulating]);

  const refreshStatus = async () => {
    const startedAt = performance.now();
    try {
      const response = await fetch(`${brokerUrl}/api/status`);
      if (!response.ok) throw new Error(`Status ${response.status}`);
      const data = await response.json();
      setStatusLatencyMs(Math.round(performance.now() - startedAt));
      setLastStatusSync(new Date().toLocaleTimeString());
      if (data.mode === "active" || data.mode === "passive") setActiveMode(data.mode);
      if (typeof data.focusScore === "number") setFocusScore(data.focusScore);
      if (data.sensor) setSensorStatus(data.sensor);
      if (data.sensor?.latest) setSensorData(normalizeSensorData(data.sensor.latest));
      if (data.gyroBulbControl) setGyroBulbControl(data.gyroBulbControl);
    } catch {
      setStatusLatencyMs(null);
      setNetworkStatus((current) => (current === "connected" ? current : "disconnected"));
    }
  };

  useEffect(() => {
    void refreshStatus();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [brokerUrl]);

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

  const metrics = [
    {
      label: "REST latency",
      value: statusLatencyMs === null ? "Unavailable" : `${statusLatencyMs} ms`,
      icon: Clock3,
    },
    {
      label: "Sensor samples",
      value: sensorStatus.sampleCount.toLocaleString(),
      icon: BarChart3,
    },
    {
      label: "Last sensor update",
      value: sensorAge,
      icon: Signal,
    },
    {
      label: "Gyro control",
      value: gyroBulbControl?.active ? "Active" : gyroBulbControl?.enabled ? "Armed" : "Disabled",
      icon: Lightbulb,
    },
  ];

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-5 md:px-8 md:py-8">
        <header className="flex flex-col gap-5 border-b border-border/60 pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Hand className="size-6" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                Gestura Gauntlet
              </h1>
              <p className="text-sm text-muted-foreground">Analytics</p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <nav className="flex h-10 items-center gap-1 rounded-md border border-border bg-card p-1">
              <Link className="inline-flex h-8 items-center gap-2 rounded-sm bg-primary px-3 text-sm font-medium text-primary-foreground" href="/">
                <Activity className="size-4" />
                Analytics
              </Link>
              <Link className="inline-flex h-8 items-center gap-2 rounded-sm px-3 text-sm font-medium text-muted-foreground hover:bg-secondary hover:text-foreground" href="/configuration">
                <Settings className="size-4" />
                Configuration
              </Link>
            </nav>
            <NetworkStatusIndicator status={networkStatus} />
          </div>
        </header>

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-lg border border-border bg-card p-6">
            <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
              <div>
                <div className="mb-3 flex items-center gap-2">
                  <Badge variant={activeMode === "active" ? "default" : "secondary"}>
                    {activeMode}
                  </Badge>
                  <Badge variant="outline">{selectedDevice}</Badge>
                  <Badge variant="outline">{selectedAction}</Badge>
                </div>
                <h2 className="text-3xl font-semibold tracking-tight">Glove Control State</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  The glove only needs to report mode, selected target, selected action, and normalized input. Device definitions and execution rules stay in the backend.
                </p>
              </div>

              <div className="flex rounded-md border border-border bg-background p-1">
                <Button
                  size="sm"
                  variant={activeMode === "passive" ? "default" : "ghost"}
                  onClick={() => handleModeChange("passive")}
                >
                  Passive
                </Button>
                <Button
                  size="sm"
                  variant={activeMode === "active" ? "default" : "ghost"}
                  onClick={() => handleModeChange("active")}
                >
                  <Zap className="size-4" />
                  Active
                </Button>
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricTile label="Focus score" value={`${focusScore}%`} icon={Gauge} tone={focusScore >= 70 ? "good" : focusScore >= 45 ? "warn" : "bad"} />
              <MetricTile label="Mode topic" value="gauntlet/mode" icon={Network} />
              <MetricTile label="Sensor topic" value="gauntlet/sensors" icon={Cpu} />
              <MetricTile label="Last sync" value={lastStatusSync ?? "Pending"} icon={RefreshCw} />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">Connection Info</h2>
                <p className="text-sm text-muted-foreground">gestura-backend</p>
              </div>
              <Button size="icon" variant="outline" onClick={refreshStatus} aria-label="Refresh status">
                <RefreshCw className="size-4" />
              </Button>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="broker-url">Server URL</Label>
                <Input
                  id="broker-url"
                  value={brokerUrl}
                  onChange={(event) => setBrokerUrl(event.target.value)}
                  className="font-mono text-xs"
                />
              </div>

              <InfoRow label="WebSocket" value={networkStatus} />
              <InfoRow label="MQTT broker" value="tcp://localhost:1883" />
              <InfoRow label="HTTP status" value={statusLatencyMs === null ? "unavailable" : "reachable"} />
              <InfoRow label="Input source" value={sensorStatus.source ?? "waiting"} />
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-4">
          {metrics.map((metric) => (
            <MetricTile key={metric.label} {...metric} />
          ))}
        </section>

        <section className="rounded-lg border border-border bg-card p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Sensor Stream</h2>
              <p className="text-sm text-muted-foreground">
                Keep this hidden when firmware is not transmitting continuous telemetry.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Label htmlFor="sensor-toggle" className="text-sm text-muted-foreground">
                Show live sensor data
              </Label>
              <Switch id="sensor-toggle" checked={showSensorData} onCheckedChange={setShowSensorData} />
            </div>
          </div>

          {showSensorData ? (
            <div className="mt-5">
              <LiveSensorData
                sensorData={sensorData}
                isSimulating={isSimulating}
                onToggleSimulation={() => setIsSimulating((current) => !current)}
              />
            </div>
          ) : (
            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <InfoTile label="Latest roll input" value={sensorData.x.toFixed(3)} />
              <InfoTile label="Sample source" value={sensorStatus.source ?? "none"} />
              <InfoTile label="Telemetry state" value={sensorStatus.lastUpdatedAt ? "available" : "idle"} />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function normalizeSensorData(data: Partial<SensorData>): SensorData {
  return {
    x: Number(data.x ?? 0),
    y: Number(data.y ?? 0),
    z: Number(data.z ?? 0),
    gx: Number(data.gx ?? 0),
    gy: Number(data.gy ?? 0),
    gz: Number(data.gz ?? 0),
  };
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono text-xs text-foreground">{value}</span>
    </div>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-4">
      <div className="text-xs font-medium uppercase text-muted-foreground">{label}</div>
      <div className="mt-2 truncate font-mono text-lg font-semibold">{value}</div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  icon: ElementType;
  tone?: "neutral" | "good" | "warn" | "bad";
}) {
  const toneClass = {
    neutral: "text-primary",
    good: "text-success",
    warn: "text-warning",
    bad: "text-destructive",
  }[tone];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className={`size-4 ${toneClass}`} />
      </div>
      <div className="truncate text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}
