import network
import time


class StatusState:
    def __init__(self, wifi_ssid=""):
        self.wifi_ssid = wifi_ssid or "unknown"
        self.route = "OFFLINE"
        self.node_name = "none"
        self.battery = "--"
        self.rtt_ms = 0
        self.connected = False
        self.degraded = False
        self.mapping_count = 0
        self.device_count = 0
        self.manager_count = 0
        self.last_error = ""
        self.rotation_index = 0
        self.last_rotation_ms = time.ticks_ms()

    def update(self, **kwargs):
        for key, value in kwargs.items():
            setattr(self, key, value)

    def rotate_if_due(self, interval_ms=2500):
        now = time.ticks_ms()
        if time.ticks_diff(now, self.last_rotation_ms) < interval_ms:
            return False
        self.rotation_index = (self.rotation_index + 1) % 4
        self.last_rotation_ms = now
        return True

    def status_label(self):
        items = [
            "WiFi {}".format(short_text(self.wifi_ssid, 12)),
            "Route {}".format(self.route),
            "Batt {}".format(self.battery),
            "RTT {}ms".format(self.rtt_ms or 0),
        ]
        return items[self.rotation_index % len(items)]

    def wifi_rssi(self):
        try:
            wlan = network.WLAN(network.STA_IF)
            if hasattr(wlan, "status"):
                return wlan.status("rssi")
        except Exception:
            pass
        return None

    def full_rows(self):
        return [
            ("WiFi", short_text(self.wifi_ssid, 14)),
            ("Route", self.route),
            ("Node", short_text(self.node_name, 14)),
            ("Battery", self.battery),
            ("RTT", "{}ms".format(self.rtt_ms or 0)),
            ("Conn", "ONLINE" if self.connected else "OFFLINE"),
            ("Maps", str(self.mapping_count)),
            ("Devices", str(self.device_count)),
            ("Managers", str(self.manager_count)),
            ("Error", short_text(self.last_error or "none", 14)),
        ]


def route_label(active_endpoint, source, connected, degraded=False):
    if not connected:
        return "OFFLINE"
    endpoint = str(active_endpoint or "")
    src = str(source or "").lower()
    if degraded:
        return "OFFLINE"
    if src == "edge" and endpoint.startswith("ws://"):
        return "LAN EDGE"
    if src == "edge":
        return "PUB EDGE"
    if endpoint.startswith("wss://"):
        return "CLOUD"
    return "PUB EDGE"


def short_text(value, max_chars):
    text = str(value or "")
    if len(text) <= max_chars:
        return text
    if max_chars <= 1:
        return text[:max_chars]
    return text[: max_chars - 1] + "~"
