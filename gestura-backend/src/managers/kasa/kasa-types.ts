export interface KasaDiscoveredDevice {
  id: string;
  host: string;
  alias: string;
  mac?: string;
  model?: string;
  type: "light" | "plug" | "other";
}
