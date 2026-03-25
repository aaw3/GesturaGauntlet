"use client";

import { Wifi, WifiOff, HelpCircle } from "lucide-react";

interface NetworkStatusIndicatorProps {
  status: "connected" | "disconnected" | "unknown";
}

export function NetworkStatusIndicator({ status }: NetworkStatusIndicatorProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "connected":
        return {
          icon: Wifi,
          label: "Connected",
          dotColor: "bg-success",
          textColor: "text-success",
          bgColor: "bg-success/10",
          borderColor: "border-success/30",
        };
      case "disconnected":
        return {
          icon: WifiOff,
          label: "Disconnected",
          dotColor: "bg-destructive",
          textColor: "text-destructive",
          bgColor: "bg-destructive/10",
          borderColor: "border-destructive/30",
        };
      default:
        return {
          icon: HelpCircle,
          label: "Unknown",
          dotColor: "bg-muted-foreground",
          textColor: "text-muted-foreground",
          bgColor: "bg-muted/50",
          borderColor: "border-border",
        };
    }
  };

  const config = getStatusConfig();
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${config.bgColor} ${config.borderColor}`}
    >
      <div className="relative">
        <span
          className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ${config.dotColor}`}
        />
        {status === "connected" && (
          <span
            className={`absolute -right-0.5 -top-0.5 h-2 w-2 animate-ping rounded-full ${config.dotColor}`}
          />
        )}
        <Icon className={`h-4 w-4 ${config.textColor}`} />
      </div>
      <span className={`text-xs font-medium ${config.textColor}`}>
        {config.label}
      </span>
    </div>
  );
}
