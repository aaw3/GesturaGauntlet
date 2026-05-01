import network
import time
import ujson
import time
import ntptime


class WiFiManager:
    def __init__(self, path="wifi_networks.json", fallback_ssid="", fallback_password=""):
        self.path = path
        self.wlan = network.WLAN(network.STA_IF)
        self.wlan.active(True)
        self.profiles = []
        self.scan_results = []
        self.override_ssid = ""
        self.last_scan_ms = 0
        self.load()
        if fallback_ssid and not self.get_profile(fallback_ssid):
            self.upsert(fallback_ssid, fallback_password, save=False)

    def load(self):
        try:
            with open(self.path, "r") as f:
                payload = ujson.loads(f.read())
                self.profiles = normalize_profiles(payload.get("networks", payload))
                self.override_ssid = str(payload.get("overrideSsid", ""))
        except OSError:
            self.profiles = []
        except Exception as exc:
            print("WiFi profile file ignored:", exc)
            self.profiles = []

    def save(self):
        payload = {
            "networks": self.profiles,
            "overrideSsid": self.override_ssid,
            "updatedAt": int(time.time()) if hasattr(time, "time") else 0,
        }
        with open(self.path, "w") as f:
            f.write(ujson.dumps(payload))

    def sync_profiles(self, networks):
        changed = False
        for item in networks or []:
            ssid = item.get("ssid")
            if not ssid:
                continue
            password = item.get("password", "")
            if self.upsert(ssid, password, save=False):
                changed = True
        if changed:
            self.save()
        return changed

    def upsert(self, ssid, password="", save=True):
        ssid = str(ssid or "").strip()
        if not ssid:
            return False
        for profile in self.profiles:
            if profile.get("ssid") == ssid:
                if profile.get("password", "") == password:
                    return False
                profile["password"] = password
                if save:
                    self.save()
                return True
        self.profiles.append({"ssid": ssid, "password": password})
        if save:
            self.save()
        return True

    def set_override(self, ssid):
        self.override_ssid = str(ssid or "")
        self.save()

    def clear_override(self):
        self.override_ssid = ""
        self.save()

    def get_profile(self, ssid):
        for profile in self.profiles:
            if profile.get("ssid") == ssid:
                return profile
        return None

    def scan(self):
        try:
            raw = self.wlan.scan()
        except Exception as exc:
            print("WiFi scan failed:", exc)
            raw = []
        self.scan_results = normalize_scan(raw)
        self.last_scan_ms = time.ticks_ms()
        return self.scan_results

    def nearby_by_ssid(self):
        if not self.scan_results:
            self.scan()
        nearby = {}
        for item in self.scan_results:
            ssid = item.get("ssid")
            if not ssid:
                continue
            if ssid not in nearby or item.get("rssi", -999) > nearby[ssid].get("rssi", -999):
                nearby[ssid] = item
        return nearby

    def listed_networks(self):
        nearby = self.nearby_by_ssid()
        items = []
        for profile in self.profiles:
            ssid = profile.get("ssid", "")
            detected = ssid in nearby
            label = ssid
            if not detected:
                label = "X " + label
            elif ssid == self.current_ssid():
                label = "* " + label
            items.append({
                "ssid": ssid,
                "label": label,
                "detected": detected,
                "rssi": nearby.get(ssid, {}).get("rssi"),
                "current": ssid == self.current_ssid(),
                "override": ssid == self.override_ssid,
            })
        return items

    def choose_profile(self):
        if self.override_ssid:
            profile = self.get_profile(self.override_ssid)
            if profile:
                return profile
        nearby = self.nearby_by_ssid()
        best = None
        best_rssi = -999
        for profile in self.profiles:
            ssid = profile.get("ssid")
            rssi = nearby.get(ssid, {}).get("rssi", -999)
            if rssi > best_rssi:
                best = profile
                best_rssi = rssi
        return best or (self.profiles[0] if self.profiles else None)

    def connect_best(self, timeout_sec=15):
        self.scan()
        profile = self.choose_profile()
        if not profile:
            raise Exception("No WiFi profiles configured")
        return self.connect(profile.get("ssid"), profile.get("password", ""), timeout_sec)

    def connect(self, ssid, password="", timeout_sec=15):
        if self.current_ssid() == ssid and self.is_connected():
            return self.wlan.ifconfig()[0]
        print("Connecting WiFi:", ssid)
        try:
            self.wlan.disconnect()
        except Exception:
            pass
        self.wlan.connect(ssid, password)
        deadline = time.time() + timeout_sec if hasattr(time, "time") else None
        while True:
            status = self.wlan.status()
            if status < 0 or status >= 3:
                break
            if deadline is not None and time.time() >= deadline:
                break
            time.sleep(1)
        if self.wlan.status() != 3:
            raise Exception("WiFi connection failed: {}".format(ssid))
        return self.wlan.ifconfig()[0]

    def ensure_connected(self):
        if self.is_connected():
            return True
        try:
            self.connect_best(timeout_sec=10)
            return True
        except Exception as exc:
            print("WiFi reconnect failed:", exc)
            return False

    def connect_override(self):
        if not self.override_ssid:
            return self.ensure_connected()
        profile = self.get_profile(self.override_ssid)
        if not profile:
            return False
        try:
            self.connect(profile.get("ssid"), profile.get("password", ""), timeout_sec=10)
            return True
        except Exception as exc:
            print("WiFi override connect failed:", exc)
            return False

    def is_connected(self):
        try:
            return self.wlan.status() == 3
        except Exception:
            return False

    def current_ssid(self):
        try:
            return self.wlan.config("essid")
        except Exception:
            return ""


def normalize_profiles(value):
    profiles = []
    if isinstance(value, dict):
        iterable = [{"ssid": ssid, "password": password} for ssid, password in value.items()]
    else:
        iterable = value or []
    for item in iterable:
        if isinstance(item, dict):
            ssid = str(item.get("ssid", "")).strip()
            if ssid:
                profiles.append({"ssid": ssid, "password": str(item.get("password", ""))})
    return profiles


def normalize_scan(raw):
    results = []
    for entry in raw or []:
        try:
            ssid = entry[0].decode("utf-8") if hasattr(entry[0], "decode") else str(entry[0])
            results.append({
                "ssid": ssid,
                "bssid": entry[1],
                "channel": entry[2],
                "rssi": entry[3],
                "security": entry[4],
                "hidden": entry[5],
            })
        except Exception:
            pass
    return results

def sync_time_ntp():
    try:
        ntptime.host = "pool.ntp.org"
        ntptime.settime()
        print("NTP time synced:", time.localtime())
        return True
    except Exception as exc:
        print("NTP sync failed:", exc)
        return False