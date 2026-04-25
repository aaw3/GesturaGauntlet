"use client";

import type { ElementType } from "react";
import { Cpu, HelpCircle, Lightbulb, Plug, Server, Waves } from "lucide-react";

export const managerIconMap: Record<string, ElementType> = {
  lightbulb: Lightbulb,
  plug: Plug,
  cpu: Cpu,
  server: Server,
  waves: Waves,
};

export const managerColorMap: Record<string, string> = {
  amber: "border-amber-300 bg-amber-50 text-amber-700",
  cyan: "border-cyan-300 bg-cyan-50 text-cyan-700",
  emerald: "border-emerald-300 bg-emerald-50 text-emerald-700",
  rose: "border-rose-300 bg-rose-50 text-rose-700",
  slate: "border-slate-300 bg-slate-50 text-slate-700",
};

export function getManagerIcon(iconKey?: string): ElementType {
  return (iconKey && managerIconMap[iconKey]) || HelpCircle;
}

export function getManagerColor(colorKey?: string): string {
  return (colorKey && managerColorMap[colorKey]) || managerColorMap.slate;
}
