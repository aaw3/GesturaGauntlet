"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { io, Socket } from "socket.io-client";
import { SystemStatusPanel } from "@/components/dashboard/system-status-panel";
import { NetworkStatusIndicator } from "@/components/dashboard/network-status-indicator";
import { LiveSensorData } from "@/components/dashboard/live-sensor-data";
import { OledMessagePanel } from "@/components/dashboard/oled-message-panel";
import {
  PassiveBulbConfigDevice,
  PassiveBulbConfigPanel,
} from "@/components/dashboard/passive-bulb-config-panel";
import {
  ActiveBulbConfigDevice,
  ActiveBulbConfigPanel,
} from "@/components/dashboard/active-bulb-config-panel";
import { Hand, Activity, Settings } from "lucide-react";

// Declare socket outside to prevent constant reconnections on UI renders
let socket: Socket;

interface PassiveColorConfigPayload {
  devices: PassiveBulbConfigDevice[];
  defaults: {
    stillColor: string;
    movingColor: string;
  };
}

interface ActiveColorConfigPayload {
  devices: ActiveBulbConfigDevice[];
  defaults: {
    activeColor: string;
  };
}

interface SensorData {
  x: number;
  y: number;
  z: number;
  gx: number;
  gy: number;
  gz: number;
  pressure: number;
}

interface PassiveMotionState {
  state: string;
  score: number;
  rawMotionScore: number;
  lastAppliedState: string;
  lastColor: string;
  movementAgeMs: number | null;
  sensorAgeMs: number | null;
  stillDelayMs: number;
  commandInFlight: boolean;
  pendingState: string;
}

interface ActiveControlState {
  engaged: boolean;
  pressure: number;
  selectedTarget: string | null;
  selectedTargetHost: string | null;
  selectedAction: string;
  inputSource: string;
  cycleInputSource: string;
  engagePressure: number;
  releasePressure: number;
  releaseCooldownMs: number;
  releaseCooldownRemainingMs: number;
  passiveOutputPaused: boolean;
  lastEngagedAt: string | null;
  lastReleasedAt: string | null;
  lastShortTapAt: string | null;
}

const emptySensorData: SensorData = {
  x: 0,
  y: 0,
  z: 0,
  gx: 0,
  gy: 0,
  gz: 0,
  pressure: 0,
};

export default function Dashboard() {
  // Changed from picoIp to brokerUrl (pointing to your Node.js server)
  const [brokerUrl, setBrokerUrl] = useState("http://localhost:3001");
  const [networkStatus, setNetworkStatus] = useState<"connected" | "disconnected" | "unknown">("unknown");
  const [activeMode, setActiveMode] = useState<"active" | "passive" | null>("passive");
  const [isSimulating, setIsSimulating] = useState(false);
  const [sensorData, setSensorData] = useState<SensorData>(emptySensorData);
  const [passiveMotion, setPassiveMotion] = useState<PassiveMotionState | null>(null);
  const [activeControl, setActiveControl] = useState<ActiveControlState | null>(null);
  
  const [passiveBulbs, setPassiveBulbs] = useState<PassiveBulbConfigDevice[]>([]);
  const [passiveConfigError, setPassiveConfigError] = useState<string | null>(null);
  const [savingPassiveHost, setSavingPassiveHost] = useState<string | null>(null);

  const [activeBulbs, setActiveBulbs] = useState<ActiveBulbConfigDevice[]>([]);
  const [activeConfigError, setActiveConfigError] = useState<string | null>(null);
  const [savingActiveHost, setSavingActiveHost] = useState<string | null>(null);

  // --- 1. WEBSOCKET CONNECTION & LISTENERS ---
  useEffect(() => {
    // Connect to the Node Broker
    socket = io(brokerUrl);

    socket.on("connect", () => {
      setNetworkStatus("connected");
      socket.emit("getMode");
      socket.emit("getPassiveColorConfig");
      socket.emit("getActiveColorConfig");
      socket.emit("getActiveControlState");
    });

    socket.on("disconnect", () => {
      setNetworkStatus("disconnected");
    });

    // Update UI when the server confirms a mode change
    socket.on("modeUpdate", (newMode) => {
      console.log("Received mode update from server:", newMode);
      if (newMode) {
        setActiveMode(newMode.toLowerCase() as "active" | "passive");
      }
    });

    // Firehose of data from the Pico
    socket.on("sensorData", (data: Partial<SensorData>) => {
      // Only use live data if we aren't using the local UI simulator
      if (!isSimulating) {
        setSensorData({
          x: data.x || 0,
          y: data.y || 0,
          z: data.z || 0,
          gx: data.gx || 0,
          gy: data.gy || 0,
          gz: data.gz || 0,
          pressure: data.pressure || 0,
        });
      }
    });

    socket.on("passiveMotionState", (state: PassiveMotionState) => {
      setPassiveMotion(state);
    });

    socket.on("activeControlState", (state: ActiveControlState) => {
      setActiveControl(state);
    });

    socket.on("passiveColorConfig", (config: PassiveColorConfigPayload) => {
      setPassiveBulbs(config?.devices || []);
      setPassiveConfigError(null);
    });

    socket.on("passiveColorConfigResult", (result: { success: boolean; error?: string }) => {
      if (!result?.success && result.error) {
        setPassiveConfigError(result.error);
      }
    });

    socket.on("activeColorConfig", (config: ActiveColorConfigPayload) => {
      setActiveBulbs(config?.devices || []);
      setActiveConfigError(null);
    });

    socket.on("activeColorConfigResult", (result: { success: boolean; error?: string }) => {
      if (!result?.success && result.error) {
        setActiveConfigError(result.error);
      }
    });

    // Cleanup on unmount
    return () => {
      if (socket) socket.disconnect();
    };
  }, [brokerUrl, isSimulating]);

  // --- 2. EMIT ACTIONS TO SERVER ---
  const handleModeChange = (mode: "active" | "passive") => {
    if (socket && socket.connected) {
      console.log("Emitting setMode:", mode);
      socket.emit("setMode", mode);
    }
  };

  const handleRefresh = () => {
    if (socket && socket.connected) {
      console.log("Requesting state sync...");
      socket.emit("getMode");
      socket.emit("getPassiveColorConfig");
      socket.emit("getActiveColorConfig");
      socket.emit("getActiveControlState");
    }
  };

  const handleSendMessage = (message: string) => {
    if (socket && socket.connected) {
      socket.emit("sendMessage", message); 
    }
  };

  const handlePassiveColorSave = async (
    host: string,
    colors: { stillColor: string; movingColor: string }
  ) => {
    setSavingPassiveHost(host);
    setPassiveConfigError(null);

    try {
      const response = await fetch(`${brokerUrl}/api/passive-config`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host,
          stillColor: colors.stillColor,
          movingColor: colors.movingColor,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload?.success) {
        throw new Error(payload?.error || "Failed to save passive colors.");
      }

      if (payload?.passiveColorConfig?.devices) {
        setPassiveBulbs(payload.passiveColorConfig.devices);
      }
    } catch (error) {
      setPassiveConfigError(
        error instanceof Error ? error.message : "Failed to save passive colors."
      );
    } finally {
      setSavingPassiveHost(null);
    }
  };

  const handleActiveColorSave = async (
    host: string,
    colors: { activeColor: string }
  ) => {
    setSavingActiveHost(host);
    setActiveConfigError(null);

    try {
      if (socket && socket.connected) {
        socket.emit("setActiveColorConfig", {
          host,
          activeColor: colors.activeColor,
        });
      }
    } catch (error) {
      setActiveConfigError(
        error instanceof Error ? error.message : "Failed to save active color."
      );
    } finally {
      setSavingActiveHost(null);
    }
  };

  // --- 3. LOCAL SIMULATOR (Fallback for UI testing) ---
  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isSimulating) {
      interval = setInterval(() => {
        setSensorData({
          x: parseFloat((Math.random() * 2 - 1).toFixed(3)),
          y: parseFloat((Math.random() * 2 - 1).toFixed(3)),
          z: parseFloat((Math.random() * 2 - 1).toFixed(3)),
          gx: parseFloat((Math.random() * 250 - 125).toFixed(3)),
          gy: parseFloat((Math.random() * 250 - 125).toFixed(3)),
          gz: parseFloat((Math.random() * 250 - 125).toFixed(3)),
          pressure: parseFloat((Math.random() * 100).toFixed(1)),
        });
      }, 500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSimulating]);

  // --- 4. UI RENDERING ---
  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
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
          
          <div className="flex items-center gap-4">
            <Link
              href="/configuration"
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              <Settings className="h-4 w-4" />
              Configuration
            </Link>
            <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 border border-border">
              <span className="text-xs text-muted-foreground">Broker URL:</span>
              <input
                type="text"
                value={brokerUrl}
                onChange={(e) => setBrokerUrl(e.target.value)}
                className="w-40 bg-transparent text-sm text-foreground outline-none font-mono"
                placeholder="http://localhost:3001"
              />
            </div>
            <NetworkStatusIndicator status={networkStatus} />
          </div>
        </header>

        {/* Main Grid */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* System Status Panel - Spans 2 columns on large screens */}
          <div className="lg:col-span-2">
            <SystemStatusPanel
              activeMode={activeMode}
              activeControl={activeControl}
              passiveMotion={passiveMotion}
              onModeChange={handleModeChange}
              onRefresh={handleRefresh}
            />
          </div>

          {/* Network Status Card */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
            <div className="mb-4 flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-card-foreground">Connection Info</h2>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Server</span>
                <span className="font-mono text-foreground text-xs">{brokerUrl}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <span className={`font-medium ${
                  networkStatus === "connected" 
                    ? "text-success" 
                    : networkStatus === "disconnected" 
                    ? "text-destructive" 
                    : "text-muted-foreground"
                }`}>
                  {networkStatus === "connected" 
                    ? "Online" 
                    : networkStatus === "disconnected" 
                    ? "Offline" 
                    : "Unknown"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Mode</span>
                <span className="font-medium text-foreground capitalize">
                  {activeControl?.engaged ? "Active hold" : "Passive baseline"}
                </span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="grid gap-6 xl:grid-cols-2">
              <PassiveBulbConfigPanel
                devices={passiveBulbs}
                error={passiveConfigError}
                isSavingHost={savingPassiveHost}
                onRefresh={handleRefresh}
                onSave={handlePassiveColorSave}
              />
              <ActiveBulbConfigPanel
                devices={activeBulbs}
                error={activeConfigError}
                isSavingHost={savingActiveHost}
                onRefresh={handleRefresh}
                onSave={handleActiveColorSave}
              />
            </div>
          </div>

          {/* Live Sensor Data - Spans 2 columns */}
          <div className="lg:col-span-2">
            <LiveSensorData
              sensorData={sensorData}
              isSimulating={isSimulating}
              onToggleSimulation={() => setIsSimulating(!isSimulating)}
            />
          </div>

          {/* OLED Message Panel */}
          <OledMessagePanel onSendMessage={handleSendMessage} />
        </div>

        {/* Footer */}
        <footer className="mt-8 border-t border-border/50 pt-6 text-center text-xs text-muted-foreground">
          <p>Gestura Gauntlet Dashboard v1.0 <span className="text-primary">•</span> Real-time IoT Control Interface</p>
        </footer>
      </div>
    </div>
  );
}
