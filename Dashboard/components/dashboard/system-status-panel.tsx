"use client";

import { Power, Zap, Shield } from "lucide-react";

interface SystemStatusPanelProps {
  activeMode: "active" | "passive" | null;
  onModeChange: (mode: "active" | "passive") => void;
  onRefresh?: () => void;
}

export function SystemStatusPanel({ activeMode, onModeChange, onRefresh }: SystemStatusPanelProps) {
  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
      <div className="mb-6 flex items-center gap-2">
        <Power className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-card-foreground">System Status</h2>
        <button 
          onClick={onRefresh}
          className="ml-auto rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
        >
          Sync State
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Active Mode Button */}
        <button
          onClick={() => onModeChange("active")}
          className={`group relative flex flex-col items-center justify-center rounded-xl border-2 p-8 transition-all duration-300 ${
            activeMode === "active"
              ? "border-primary bg-primary/10 shadow-lg shadow-primary/20"
              : "border-border bg-secondary/50 hover:border-primary/50 hover:bg-secondary"
          }`}
        >
          <div
            className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 ${
              activeMode === "active"
                ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30"
                : "bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary"
            }`}
          >
            <Zap className="h-8 w-8" />
          </div>
          <span
            className={`text-lg font-semibold transition-colors ${
              activeMode === "active" ? "text-primary" : "text-foreground"
            }`}
          >
            Active Mode
          </span>
          <span className="mt-1 text-xs text-muted-foreground">
            Full gesture recognition
          </span>
          {activeMode === "active" && (
            <div className="absolute right-3 top-3 flex h-3 w-3 items-center justify-center">
              <span className="absolute h-3 w-3 animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative h-2 w-2 rounded-full bg-primary" />
            </div>
          )}
        </button>

        {/* Passive Mode Button */}
        <button
          onClick={() => onModeChange("passive")}
          className={`group relative flex flex-col items-center justify-center rounded-xl border-2 p-8 transition-all duration-300 ${
            activeMode === "passive"
              ? "border-chart-2 bg-chart-2/10 shadow-lg shadow-chart-2/20"
              : "border-border bg-secondary/50 hover:border-chart-2/50 hover:bg-secondary"
          }`}
        >
          <div
            className={`mb-4 flex h-16 w-16 items-center justify-center rounded-full transition-all duration-300 ${
              activeMode === "passive"
                ? "bg-chart-2 text-foreground shadow-lg shadow-chart-2/30"
                : "bg-muted text-muted-foreground group-hover:bg-chart-2/20 group-hover:text-chart-2"
            }`}
          >
            <Shield className="h-8 w-8" />
          </div>
          <span
            className={`text-lg font-semibold transition-colors ${
              activeMode === "passive" ? "text-chart-2" : "text-foreground"
            }`}
          >
            Passive Mode
          </span>
          <span className="mt-1 text-xs text-muted-foreground">
            Low power monitoring
          </span>
          {activeMode === "passive" && (
            <div className="absolute right-3 top-3 flex h-3 w-3 items-center justify-center">
              <span className="absolute h-3 w-3 animate-ping rounded-full bg-chart-2 opacity-75" />
              <span className="relative h-2 w-2 rounded-full bg-chart-2" />
            </div>
          )}
        </button>
      </div>

      <div className="mt-4 rounded-lg bg-secondary/50 p-3">
        <p className="text-center text-xs text-muted-foreground">
          Click a mode to send command to{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-primary">
            /mode?set={"<mode>"}
          </code>
        </p>
      </div>
    </div>
  );
}
