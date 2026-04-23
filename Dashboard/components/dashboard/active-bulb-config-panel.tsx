"use client";

import { useEffect, useState } from "react";
import { Lightbulb, Palette, RefreshCw, Save } from "lucide-react";

export interface ActiveBulbConfigDevice {
  host: string;
  alias: string;
  connected: boolean;
  error?: string;
  activeColor: string;
}

interface ActiveBulbConfigPanelProps {
  devices: ActiveBulbConfigDevice[];
  isSavingHost?: string | null;
  error?: string | null;
  onSave: (host: string, colors: { activeColor: string }) => void | Promise<void>;
  onRefresh?: () => void;
}

export function ActiveBulbConfigPanel({
  devices,
  isSavingHost,
  error,
  onSave,
  onRefresh,
}: ActiveBulbConfigPanelProps) {
  const [drafts, setDrafts] = useState<
    Record<string, { activeColor: string }>
  >({});

  useEffect(() => {
    const nextDrafts: Record<string, { activeColor: string }> = {};

    for (const device of devices) {
      nextDrafts[device.host] = {
        activeColor: device.activeColor,
      };
    }

    setDrafts(nextDrafts);
  }, [devices]);

  const updateDraft = (
    host: string,
    key: "activeColor",
    value: string
  ) => {
    setDrafts((current) => ({
      ...current,
      [host]: {
        ...current[host],
        [key]: value,
      },
    }));
  };

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-card to-card/80 p-6 ring-1 ring-primary/5">
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <Palette className="h-5 w-5 text-primary" />
          <div>
            <h2 className="font-semibold text-card-foreground">Active Lighting</h2>
            <p className="text-xs text-muted-foreground">
              Customize the base color for Active Mode.
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Devices
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {devices.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-secondary/30 px-4 py-6 text-center text-sm text-muted-foreground">
          No bulbs are configured. Add <code className="rounded bg-muted px-1 py-0.5 font-mono">BULB_IP</code> or{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono">BULB_IPS</code> in the backend env.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-1">
          {devices.map((device) => {
            const draft = drafts[device.host] || {
              activeColor: device.activeColor,
            };
            const hasChanges = draft.activeColor !== device.activeColor;

            return (
              <div
                key={device.host}
                className="rounded-xl border border-border bg-secondary/35 p-4 shadow-sm"
              >
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Lightbulb
                        className={`h-4 w-4 ${
                          device.connected ? "text-chart-2" : "text-muted-foreground"
                        }`}
                      />
                      <h3 className="truncate font-medium text-foreground">{device.alias}</h3>
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {device.host}
                    </p>
                  </div>

                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${
                      device.connected
                        ? "bg-chart-2/15 text-chart-2"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {device.connected ? "Connected" : "Unavailable"}
                  </span>
                </div>

                {device.error && (
                  <div className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {device.error}
                  </div>
                )}

                <div className="grid gap-3">
                  <label className="rounded-lg border border-border bg-card/70 p-3">
                    <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Base Color
                    </span>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={draft.activeColor}
                        onChange={(event) =>
                          updateDraft(device.host, "activeColor", event.target.value)
                        }
                        className="h-11 w-14 cursor-pointer rounded-md border border-border bg-transparent"
                      />
                      <div className="min-w-0">
                        <div className="font-mono text-sm text-foreground">
                          {draft.activeColor}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Rotation & FSR clutch will control the brightness of this color.
                        </div>
                      </div>
                    </div>
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-4 w-4 rounded-full border border-border"
                      style={{ backgroundColor: draft.activeColor }}
                    />
                    <span className="text-xs text-muted-foreground">
                      Preview for this bulb
                    </span>
                  </div>

                  <button
                    onClick={() =>
                      onSave(device.host, {
                        activeColor: draft.activeColor,
                      })
                    }
                    disabled={!hasChanges || isSavingHost === device.host}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Save className="h-4 w-4" />
                    {isSavingHost === device.host ? "Saving..." : "Save Color"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
