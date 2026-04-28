"use client";

import { Power, Zap, Shield, Timer } from "lucide-react";

interface SystemStatusPanelProps {
  activeMode: "active" | "passive" | null;
  activeControl?: {
    engaged: boolean;
    pressure: number;
    selectedTarget: string | null;
    selectedAction: string;
    engagePressure: number;
    releasePressure: number;
    releaseCooldownRemainingMs: number;
    passiveOutputPaused: boolean;
  } | null;
  passiveMotion?: {
    state: string;
    score: number;
    rawMotionScore: number;
    lastAppliedState: string;
    lastColor: string;
    movementAgeMs: number | null;
    stillDelayMs: number;
  } | null;
  onModeChange: (mode: "active" | "passive") => void;
  onRefresh?: () => void;
}

function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "waiting";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${Math.round(value / 1000)}s`;
}

export function SystemStatusPanel({
  activeMode,
  activeControl,
  passiveMotion,
  onModeChange,
  onRefresh,
}: SystemStatusPanelProps) {
  const pressure = activeControl?.pressure ?? 0;
  const pressureMax = Math.max(activeControl?.engagePressure ?? 20, 1);
  const pressurePercent = Math.max(0, Math.min(100, (pressure / pressureMax) * 100));

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
      <div className="mb-6 flex items-center gap-2">
        <Power className="h-5 w-5 text-primary" />
        <h2 className="font-semibold text-card-foreground">Control Status</h2>
        <button
          onClick={onRefresh}
          className="ml-auto rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          Sync State
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div
          className={`rounded-xl border-2 p-5 transition-all ${
            activeControl?.engaged
              ? "border-primary bg-primary/10 shadow-lg shadow-primary/20"
              : "border-border bg-secondary/50"
          }`}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full ${
                  activeControl?.engaged
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Zap className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Active Control</h3>
                <p className="text-xs text-muted-foreground">Hold FSR to adjust selected target.</p>
              </div>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                activeControl?.engaged
                  ? "bg-primary/15 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {activeControl?.engaged ? "Held" : "Released"}
            </span>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pressure</span>
              <span className="font-mono text-foreground">{pressure.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${pressurePercent}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Target</span>
              <span className="max-w-[55%] truncate font-mono text-xs text-foreground">
                {activeControl?.selectedTarget || "none"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Action</span>
              <span className="font-medium text-foreground">
                {activeControl?.selectedAction || "brightness"}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border-2 border-chart-2/40 bg-chart-2/10 p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-chart-2 text-foreground">
                <Shield className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Passive Tracking</h3>
                <p className="text-xs text-muted-foreground">Always running unless active hold owns output.</p>
              </div>
            </div>
            <span className="rounded-full bg-chart-2/15 px-2.5 py-1 text-[11px] font-medium text-chart-2">
              {passiveMotion?.state || "waiting"}
            </span>
          </div>

          <div className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Motion score</span>
              <span className="font-mono text-foreground">
                {(passiveMotion?.rawMotionScore ?? 0).toFixed(4)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Last bulb state</span>
              <span className="font-medium text-foreground">
                {passiveMotion?.lastAppliedState || "unknown"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Idle timer</span>
              <span className="font-mono text-foreground">
                {formatMs(passiveMotion?.movementAgeMs)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Output</span>
              <span className="font-medium text-foreground">
                {activeControl?.passiveOutputPaused ? "Paused" : "Owning light"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground sm:grid-cols-[1fr_auto] sm:items-center">
        <div className="flex items-center gap-2">
          <Timer className="h-4 w-4" />
          <span>
            Manual mode is debug-only. Passive remains the baseline; active happens while FSR is held.
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onModeChange("passive")}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
              activeMode === "passive"
                ? "bg-chart-2/20 text-chart-2"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Debug Passive
          </button>
          <button
            onClick={() => onModeChange("active")}
            className={`rounded-full px-3 py-1 font-medium transition-colors ${
              activeMode === "active"
                ? "bg-primary/20 text-primary"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Debug Active
          </button>
        </div>
      </div>
    </div>
  );
}
