"use client";

import { useState, useEffect } from "react";
import { io, Socket } from "socket.io-client";
import { SystemStatusPanel } from "@/components/dashboard/system-status-panel";
import { NetworkStatusIndicator } from "@/components/dashboard/network-status-indicator";
import { LiveSensorData } from "@/components/dashboard/live-sensor-data";
import { OledMessagePanel } from "@/components/dashboard/oled-message-panel";
import { Hand, Activity } from "lucide-react";

// Declare socket outside to prevent constant reconnections on UI renders
let socket: Socket;

export default function Dashboard() {
  // Changed from picoIp to brokerUrl (pointing to your Node.js server)
  const [brokerUrl, setBrokerUrl] = useState("http://localhost:3001");
  const [networkStatus, setNetworkStatus] = useState<"connected" | "disconnected" | "unknown">("unknown");
  const [activeMode, setActiveMode] = useState<"active" | "passive" | null>("passive");
  const [isSimulating, setIsSimulating] = useState(false);
  const [sensorData, setSensorData] = useState({ x: 0, y: 0, z: 0, gx: 0, gy: 0, gz: 0 });

  // --- 1. WEBSOCKET CONNECTION & LISTENERS ---
  useEffect(() => {
    // Connect to the Node Broker
    socket = io(brokerUrl);

    socket.on("connect", () => {
      setNetworkStatus("connected");
      socket.emit("getMode");
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
    socket.on("sensorData", (data: { x: number; y: number; z: number; gx?: number; gy?: number; gz?: number; }) => {
      // Only use live data if we aren't using the local UI simulator
      if (!isSimulating) {
        setSensorData({
          x: data.x || 0,
          y: data.y || 0,
          z: data.z || 0,
          gx: data.gx || 0,
          gy: data.gy || 0,
          gz: data.gz || 0,
        });
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
    }
  };

  const handleSendMessage = (message: string) => {
    if (socket && socket.connected) {
      socket.emit("sendMessage", message); 
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
