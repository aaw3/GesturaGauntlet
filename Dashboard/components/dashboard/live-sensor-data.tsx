"use client";

import { Activity, Play, Pause } from "lucide-react";

interface LiveSensorDataProps {
  sensorData: { x: number; y: number; z: number; gx: number; gy: number; gz: number; pressure: number };
  isSimulating: boolean;
  onToggleSimulation: () => void;
}

export function LiveSensorData({
  sensorData,
  isSimulating,
  onToggleSimulation,
}: LiveSensorDataProps) {
  const normalizeAccel = (value: number): number => {
    // Convert from -1 to 1 range to 0 to 100 for progress bar
    return ((value + 1) / 2) * 100;
  };

  const normalizeGyro = (value: number): number => {
    // Convert from -250 to 250 dps range to 0 to 100 for progress bar
    const clamped = Math.max(-250, Math.min(250, value));
    return ((clamped + 250) / 500) * 100;
  };

  const getBarColor = (value: number): string => {
    const absValue = Math.abs(value);
    if (absValue > 0.7) return "bg-destructive";
    if (absValue > 0.4) return "bg-warning";
    return "bg-primary";
  };

  const accelAxes = [
    { label: "X", value: sensorData.x, color: "text-primary" },
    { label: "Y", value: sensorData.y, color: "text-chart-2" },
    { label: "Z", value: sensorData.z, color: "text-chart-4" },
  ];

  const gyroAxes = [
    { label: "GX", value: sensorData.gx, color: "text-primary" },
    { label: "GY", value: sensorData.gy, color: "text-chart-2" },
    { label: "GZ", value: sensorData.gz, color: "text-chart-4" },
  ];

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-card-foreground">Live Sensor Data</h2>
          {isSimulating && (
            <span className="ml-2 flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
              Streaming
            </span>
          )}
        </div>
        
        <button
          onClick={onToggleSimulation}
          className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-all ${
            isSimulating
              ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
              : "border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
          }`}
        >
          {isSimulating ? (
            <>
              <Pause className="h-4 w-4" />
              Stop Stream
            </>
          ) : (
            <>
              <Play className="h-4 w-4" />
              Simulate Stream
            </>
          )}
        </button>
      </div>

      <div className="space-y-8">
        <div className="space-y-6">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Accelerometer (g)</div>
          {accelAxes.map((axis) => (
          <div key={axis.label} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-semibold ${axis.color}`}>
                  {axis.label}-Axis
                </span>
              </div>
              <span className="font-mono text-lg font-bold text-foreground tabular-nums">
                {axis.value >= 0 ? "+" : ""}
                {axis.value.toFixed(3)}
              </span>
            </div>
            
            {/* Progress bar container */}
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
              {/* Center line marker */}
              <div className="absolute left-1/2 top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-muted-foreground/30" />
              
              {/* Value bar */}
              <div
                className={`absolute top-0 h-full transition-all duration-150 ${getBarColor(axis.value)} rounded-full`}
                style={{
                  left: axis.value >= 0 ? "50%" : `${normalizeAccel(axis.value)}%`,
                  width: `${Math.abs(axis.value) * 50}%`,
                }}
              />
            </div>
            
            {/* Scale labels */}
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>-1.0</span>
              <span>0</span>
              <span>+1.0</span>
            </div>
          </div>
          ))}
        </div>

        <div className="space-y-6">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Gyroscope (dps)</div>
          {gyroAxes.map((axis) => (
            <div key={axis.label} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${axis.color}`}>
                    {axis.label}
                  </span>
                </div>
                <span className="font-mono text-lg font-bold text-foreground tabular-nums">
                  {axis.value >= 0 ? "+" : ""}
                  {axis.value.toFixed(3)}
                </span>
              </div>
              
              <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
                <div className="absolute left-1/2 top-0 z-10 h-full w-0.5 -translate-x-1/2 bg-muted-foreground/30" />
                <div
                  className={`absolute top-0 h-full transition-all duration-150 ${getBarColor(axis.value / 250)} rounded-full`}
                  style={{
                    left: axis.value >= 0 ? "50%" : `${normalizeGyro(axis.value)}%`,
                    width: `${Math.abs(axis.value) / 5}%`,
                  }}
                />
              </div>
              
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>-250</span>
                <span>0</span>
                <span>+250</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-chart-4">Pressure</span>
          <span className="font-mono text-lg font-bold text-foreground tabular-nums">
            {sensorData.pressure.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-chart-4 transition-all duration-150"
            style={{ width: `${Math.max(0, Math.min(100, sensorData.pressure))}%` }}
          />
        </div>
      </div>

      <div className="mt-6 rounded-lg bg-secondary/50 p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Accelerometer Range: -1.0g to +1.0g</span>
          <span>Update Rate: 500ms</span>
        </div>
      </div>
    </div>
  );
}
