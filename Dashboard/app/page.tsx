"use client";

import { useState, useEffect, useCallback } from "react";
import { SystemStatusPanel } from "@/components/dashboard/system-status-panel";
import { NetworkStatusIndicator } from "@/components/dashboard/network-status-indicator";
import { LiveSensorData } from "@/components/dashboard/live-sensor-data";
import { OledMessagePanel } from "@/components/dashboard/oled-message-panel";
import { Hand, Activity } from "lucide-react";

export default function Dashboard() {
  const [picoIp, setPicoIp] = useState("192.168.1.100");
  const [networkStatus, setNetworkStatus] = useState<"connected" | "disconnected" | "unknown">("unknown");
  const [activeMode, setActiveMode] = useState<"active" | "passive" | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [sensorData, setSensorData] = useState({ x: 0, y: 0, z: 0 });

  const sendRequest = useCallback(async (endpoint: string): Promise<boolean> => {
    try {
      const response = await fetch(`http://${picoIp}${endpoint}`, {
        method: "GET",
        mode: "no-cors",
      });
      setNetworkStatus("connected");
      return true;
    } catch (error) {
      console.error("Request failed:", error);
      setNetworkStatus("disconnected");
      return false;
    }
  }, [picoIp]);

  const handleModeChange = async (mode: "active" | "passive") => {
    const success = await sendRequest(`/mode?set=${mode}`);
    if (success) {
      setActiveMode(mode);
    }
  };

  const handleSendMessage = async (message: string) => {
    const encodedMessage = encodeURIComponent(message);
    await sendRequest(`/message?text=${encodedMessage}`);
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isSimulating) {
      interval = setInterval(() => {
        setSensorData({
          x: parseFloat((Math.random() * 2 - 1).toFixed(3)),
          y: parseFloat((Math.random() * 2 - 1).toFixed(3)),
          z: parseFloat((Math.random() * 2 - 1).toFixed(3)),
        });
      }, 500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isSimulating]);

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
            <div className="flex items-center gap-2 rounded-lg bg-card px-3 py-2 border border-border">
              <span className="text-xs text-muted-foreground">Pico IP:</span>
              <input
                type="text"
                value={picoIp}
                onChange={(e) => setPicoIp(e.target.value)}
                className="w-32 bg-transparent text-sm text-foreground outline-none font-mono"
                placeholder="192.168.1.100"
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
              onModeChange={handleModeChange}
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
                <span className="text-muted-foreground">Device IP</span>
                <span className="font-mono text-foreground">{picoIp}</span>
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
                  {activeMode || "Not Set"}
                </span>
              </div>
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
