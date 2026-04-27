import math
import network
import time
import uasyncio as asyncio

from lib.endpoint_cache import EndpointCache
from lib.env import http_to_ws_url, ws_to_http_url
from lib.http_client import get_json
from lib.websocket_client import SimpleWebSocketClient
from modules.device_models import normalize_devices, normalize_managers
from modules.navigation import AppState, NavigationController
from modules.status import StatusState, route_label


class RuntimeApp:
    def __init__(self, env, mpu, input_reader, wifi_manager=None):
        self.env = env
        self.mpu = mpu
        self.input_reader = input_reader
        self.wifi_manager = wifi_manager
        self.glove_ws_url = env.get("GLOVE_WS_URL", "ws://localhost:3001/glove")
        self.glove_id = env.get("GLOVE_ID", "primary_glove")
        self.pico_api_token = env.get("PICO_API_TOKEN", "")
        self.metric_interval_sec = int(env.get("METRIC_INTERVAL_SEC", "300"))
        self.action_send_interval_ms = int(env.get("ACTION_SEND_INTERVAL_MS", "250"))
        self.endpoint_cache_path = env.get("ENDPOINT_CACHE_PATH", "endpoint_cache.json")
        self.ca_der_path = env.get("CA_DER_PATH", "")
        self.status = StatusState(env.get("WIFI_SSID", ""))
        self.status.update(battery=env.get("BATTERY_LABEL", "--"))
        self.state = AppState(self.status)
        self.state.wifi_manager = wifi_manager
        self.navigation = NavigationController(self.state)
        self.transport = None
        self.active_endpoint = None
        self.config_source = "offline"
        self.mappings = []
        self.devices = []
        self.managers = []
        self.route_states = []
        self.sensor = {
            "accel_x": 0.0,
            "accel_y": 0.0,
            "accel_z": 0.0,
            "gyro_x": 0.0,
            "gyro_y": 0.0,
            "gyro_z": 0.0,
            "roll": 0.0,
            "pitch": 0.0,
            "roll_deg": 0.0,
            "pitch_deg": 0.0,
            "pressure": 0.0,
        }
        self.messages_sent = 0
        self.messages_failed = 0
        self.last_action_values = {}
        self.background_tasks = []

    def start_background_tasks(self):
        self.background_tasks = [
            asyncio.create_task(self.network_task()),
            asyncio.create_task(self.sensor_task()),
            asyncio.create_task(self.wifi_task()),
        ]
        return self.background_tasks

    async def update(self, input_events):
        self.sensor["pressure"] = self.input_reader.bottom_pressure()
        self.navigation.handle_events(input_events)
        if self.wifi_manager:
            if self.state.wifi_reconnect_requested:
                self.status.update(connected=False, route="OFFLINE")
                if self.wifi_manager.connect_best(timeout_sec=10):
                    self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), last_error="")
                    self.active_endpoint = None
                self.state.wifi_reconnect_requested = False
                self.state.mark_dirty()
            elif self.wifi_manager.override_ssid and self.wifi_manager.current_ssid() != self.wifi_manager.override_ssid:
                self.status.update(connected=False, route="OFFLINE")
                if self.wifi_manager.connect_override():
                    self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), last_error="")
                    self.active_endpoint = None
                self.state.mark_dirty()
        for action in self.navigation.pop_pending_actions():
            self.send_action(action)
        await asyncio.sleep_ms(0)

    def send_action(self, action):
        if not self.transport:
            self.state.message = "No connection"
            self.state.mark_dirty()
            return False
        try:
            self.transport.send_json({
                "type": "mapped_action",
                "gloveId": self.glove_id,
                "ts": time.ticks_ms(),
                "action": action,
            })
            self.messages_sent += 1
            self.state.message = "Sent {}".format(action.get("capabilityId", "action"))
            self.state.mark_dirty()
            return True
        except Exception as exc:
            self.messages_failed += 1
            self.status.update(last_error=str(exc), connected=False)
            self.state.message = "Send failed"
            self.state.mark_dirty()
            return False

    async def network_task(self):
        reconnect_delay_ms = 500
        max_delay_ms = 5000
        last_metrics_ms = 0
        last_action_ms = 0
        last_config_refresh_ms = 0
        pending_metrics_sent_at = None

        while True:
            try:
                if not self.active_endpoint:
                    self.active_endpoint = self.bootstrap_runtime_config()
                if not self.active_endpoint:
                    self.set_connection(False, "OFFLINE")
                    await asyncio.sleep_ms(reconnect_delay_ms)
                    reconnect_delay_ms = min(max_delay_ms, reconnect_delay_ms * 2)
                    continue

                ws_url = self.build_glove_ws_url(self.active_endpoint)
                self.transport = SimpleWebSocketClient(ws_url, ca_der_path=self.ca_der_path)
                self.transport.connect()
                self.transport.send_json({
                    "type": "hello",
                    "gloveId": self.glove_id,
                    "ts": time.ticks_ms(),
                })
                self.set_connection(True, "READY")
                reconnect_delay_ms = 500
            except Exception as exc:
                print("WebSocket connection failed:", exc)
                self.messages_failed += 1
                self.transport = None
                self.active_endpoint = None
                self.status.update(last_error=str(exc))
                self.set_connection(False, "OFFLINE")
                await asyncio.sleep_ms(reconnect_delay_ms)
                reconnect_delay_ms = min(max_delay_ms, reconnect_delay_ms * 2)
                continue

            while True:
                try:
                    incoming = self.transport.receive_json(timeout=0.01)
                    if incoming:
                        if incoming.get("type") == "passive_metrics_ack" and pending_metrics_sent_at is not None:
                            self.status.update(rtt_ms=time.ticks_diff(time.ticks_ms(), pending_metrics_sent_at))
                            pending_metrics_sent_at = None
                            self.state.mark_dirty()
                        self.handle_server_message(incoming)

                    current_ms = time.ticks_ms()
                    if (
                        self.state.mode == "ACTIVE"
                        and time.ticks_diff(current_ms, last_action_ms) >= self.action_send_interval_ms
                    ):
                        for action in self.build_mapped_actions():
                            self.send_action(action)
                            last_action_ms = current_ms

                    if time.ticks_diff(current_ms, last_config_refresh_ms) >= 60_000:
                        self.refresh_runtime_config()
                        last_config_refresh_ms = current_ms

                    if time.ticks_diff(current_ms, last_metrics_ms) >= self.metric_interval_sec * 1000:
                        pending_metrics_sent_at = current_ms
                        self.transport.send_json({
                            "type": "passive_metrics",
                            "gloveId": self.glove_id,
                            "ts": current_ms,
                            "metrics": [self.build_device_metrics()],
                        })
                        self.messages_sent += 1
                        last_metrics_ms = current_ms
                except Exception as exc:
                    print("WebSocket error:", exc)
                    self.messages_failed += 1
                    self.status.update(last_error=str(exc))
                    self.set_connection(False, "OFFLINE")
                    self.active_endpoint = None
                    try:
                        self.transport.close()
                    except Exception:
                        pass
                    self.transport = None
                    break

                await asyncio.sleep_ms(20)

    async def sensor_task(self):
        while True:
            try:
                accel_data = self.mpu.get_accel()
                gyro_data = self.mpu.get_gyro()
                orientation = calculate_orientation(accel_data)
                self.mpu.runtime_re_zero(gyro_data["x"], gyro_data["y"], gyro_data["z"], alpha=0.999)
                self.sensor.update({
                    "accel_x": accel_data["x"],
                    "accel_y": accel_data["y"],
                    "accel_z": accel_data["z"],
                    "gyro_x": gyro_data["x"],
                    "gyro_y": gyro_data["y"],
                    "gyro_z": gyro_data["z"],
                    "roll": orientation["roll"],
                    "pitch": orientation["pitch"],
                    "roll_deg": orientation["roll_deg"],
                    "pitch_deg": orientation["pitch_deg"],
                })
            except Exception as exc:
                self.status.update(last_error=str(exc))
            await asyncio.sleep_ms(20)

    async def wifi_task(self):
        while True:
            if self.wifi_manager:
                if self.wifi_manager.scan():
                    self.state.mark_dirty()
                if not self.wifi_manager.is_connected():
                    self.status.update(connected=False, route="OFFLINE", last_error="WiFi disconnected")
                    self.state.mark_dirty()
                    if self.wifi_manager.ensure_connected():
                        self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), last_error="")
                        self.active_endpoint = None
                        self.state.mark_dirty()
                else:
                    self.status.update(wifi_ssid=self.wifi_manager.current_ssid())
            await asyncio.sleep_ms(15_000)

    def handle_server_message(self, message):
        message_type = message.get("type")
        if message_type == "request_sensor_snapshot":
            if self.transport:
                self.transport.send_json(self.build_sensor_snapshot())
            return
        if message_type in ("welcome", "config_snapshot", "mode_update"):
            mode = str(message.get("mode", "")).upper()
            if mode in ("ACTIVE", "PASSIVE"):
                self.state.mode = mode
                self.state.mark_dirty()
            config = message.get("config")
            if isinstance(config, dict):
                self.update_runtime_config(config, "websocket")

    def build_mapped_actions(self):
        actions = []
        for mapping in self.mappings:
            if not mapping.get("enabled", True):
                continue
            source = mapping.get("inputSource", "")
            if source not in ("glove.roll", "glove.pitch"):
                continue
            value = self.sensor.get("roll" if source == "glove.roll" else "pitch", 0.0)
            mapped_value = apply_mapping_transform(value, mapping)
            key = mapping.get("id") or "{}:{}".format(mapping.get("targetDeviceId"), mapping.get("targetCapabilityId"))
            previous = self.last_action_values.get(key)
            if previous is not None and abs(float(mapped_value) - float(previous)) < effective_step(mapping):
                continue
            self.last_action_values[key] = mapped_value
            actions.append({
                "mappingId": mapping.get("id"),
                "deviceId": mapping.get("targetDeviceId"),
                "capabilityId": mapping.get("targetCapabilityId"),
                "commandType": command_type_for_mapping(mapping),
                "value": mapped_value,
                "inputSource": source,
            })
        return actions

    def build_sensor_snapshot(self):
        payload = {
            "type": "sensor_snapshot",
            "gloveId": self.glove_id,
            "ts": time.ticks_ms(),
            "mode": self.state.mode.lower(),
        }
        payload.update(self.sensor)
        return payload

    def build_device_metrics(self):
        return {
            "type": "glove_status",
            "wifi_rssi": get_wifi_rssi(),
            "uptime_sec": time.ticks_ms() // 1000,
            "mode": self.state.mode.lower(),
            "selected_device_id": self.state.selected_device_id or "",
            "selected_action": str(self.state.selected_action_index),
            "rtt_ms": self.status.rtt_ms,
            "messages_sent": self.messages_sent,
            "messages_failed": self.messages_failed,
        }

    def bootstrap_runtime_config(self):
        cache = EndpointCache(self.endpoint_cache_path)
        if not cache.data.get("nodes"):
            try:
                metadata = self.fetch_json(self.central_glove_api_url("endpoints"))
                cache.update_if_changed(metadata, ca_der_path=self.ca_der_path)
            except Exception as exc:
                self.status.update(last_error=str(exc))

        attempts = []
        seen = {}
        for interface in cache.interfaces():
            if not is_allowed_endpoint(interface):
                continue
            url = self.config_url_for_endpoint(interface.get("url", ""))
            if not seen.get(url):
                attempts.append(("edge", url, interface))
                seen[url] = True

        central_url = self.central_glove_api_url("config")
        if not seen.get(central_url):
            attempts.append(("central", central_url, None))

        for source, url, interface in attempts:
            try:
                config = self.fetch_json(url)
                endpoints = self.update_runtime_config(config, source)
                if endpoints:
                    cache.update_if_changed(endpoints, ca_der_path=self.ca_der_path)
                if interface:
                    cache.set_last_good(interface.get("nodeId", ""))
                return interface.get("url") if interface else self.glove_ws_url
            except Exception as exc:
                self.status.update(last_error=str(exc))

        self.update_runtime_config({"mappings": [], "devices": [], "managers": []}, "offline")
        return None

    def refresh_runtime_config(self):
        if not self.active_endpoint:
            return False
        try:
            config = self.fetch_json(self.config_url_for_endpoint(self.active_endpoint))
            self.update_runtime_config(config, self.config_source)
            return True
        except Exception as exc:
            self.status.update(last_error=str(exc))
            return False

    def update_runtime_config(self, config, source):
        wifi_networks = config.get("wifiNetworks", [])
        if self.wifi_manager and wifi_networks:
            if self.wifi_manager.sync_profiles(wifi_networks):
                self.state.mark_dirty()
        self.config_source = source
        self.mappings = config.get("mappings", [])
        self.devices = normalize_devices(config.get("devices", []))
        self.managers = normalize_managers(config.get("managers", []))
        self.route_states = config.get("routeStates", [])
        endpoints = config.get("endpoints")
        node_name = first_node_name(endpoints)
        self.status.update(
            node_name=node_name or self.status.node_name,
            route=route_label(self.active_endpoint or self.glove_ws_url, source, self.status.connected),
            degraded=False,
            last_error="",
        )
        self.navigation.update_inventory(self.managers, self.devices, self.mappings)
        return endpoints

    def set_connection(self, connected, message):
        self.status.update(
            connected=connected,
            route=route_label(self.active_endpoint, self.config_source, connected),
        )
        self.state.message = message
        self.state.mark_dirty()

    def build_glove_ws_url(self, base_url=None):
        source_url = base_url or self.glove_ws_url
        url = http_to_ws_url(source_url).split("?", 1)[0]
        separator = "&" if "?" in url else "?"
        url = "{}{}gloveId={}".format(url, separator, self.glove_id)
        if self.pico_api_token:
            url = "{}&api_key={}".format(url, self.pico_api_token)
        return url

    def with_pico_auth(self, url):
        if not self.pico_api_token:
            return url
        separator = "&" if "?" in url else "?"
        return "{}{}api_key={}".format(url, separator, self.pico_api_token)

    def fetch_json(self, url):
        return get_json(self.with_pico_auth(url), ca_der_path=self.ca_der_path)

    def central_glove_api_url(self, suffix):
        base = ws_to_http_url(self.glove_ws_url).split("?", 1)[0]
        if base.endswith("/glove"):
            base = base[:-len("/glove")]
        return "{}/api/gloves/{}/{}".format(base.rstrip("/"), self.glove_id, suffix)

    def config_url_for_endpoint(self, endpoint_url):
        http_url = ws_to_http_url(endpoint_url).split("?", 1)[0].rstrip("/")
        if http_url.endswith("/glove"):
            http_url = http_url[:-len("/glove")]
        return "{}/api/gloves/{}/config".format(http_url, self.glove_id)


def is_allowed_endpoint(interface):
    url = interface.get("url", "")
    kind = interface.get("kind", "")
    if url.startswith("wss://"):
        return True
    return kind == "lan" and url.startswith("ws://")


def first_node_name(endpoints):
    try:
        nodes = endpoints.get("nodes", [])
        for node in nodes:
            if node.get("online", True):
                return node.get("name") or node.get("nodeId")
    except Exception:
        pass
    return ""


def command_type_for_mapping(mapping):
    mode = str(mapping.get("mode", "")).lower()
    if mode == "toggle":
        return "toggle"
    if mode == "scene":
        return "execute"
    return "set"


def apply_mapping_transform(value, mapping):
    transform = mapping.get("transform", {}) or {}
    minimum = float(transform.get("min", 0))
    maximum = float(transform.get("max", 100))
    deadzone = abs(float(transform.get("deadzone", 0)))
    offset = float(transform.get("offset", 0))
    if abs(float(value)) < deadzone:
        value = 0
    normalized = max(-1, min(1, float(value) + offset))
    if transform.get("invert"):
        normalized = -normalized
    mapped = minimum + ((normalized + 1) / 2) * (maximum - minimum)
    step = float(transform.get("step", 0) or 0)
    if step > 0:
        mapped = round(mapped / step) * step
    return max(minimum, min(maximum, mapped))


def effective_step(mapping):
    transform = mapping.get("transform", {}) or {}
    step = float(transform.get("step", 0) or 0)
    return step if step > 0 else 0.01


def calculate_orientation(accel_data):
    ax = float(accel_data.get("x", 0.0))
    ay = float(accel_data.get("y", 0.0))
    az = float(accel_data.get("z", 0.0))
    roll_deg = math.atan2(ay, az) * 57.2957795
    pitch_deg = math.atan2(-ax, math.sqrt((ay * ay) + (az * az))) * 57.2957795
    return {
        "roll": clamp(roll_deg / 90.0, -1.0, 1.0),
        "pitch": clamp(pitch_deg / 90.0, -1.0, 1.0),
        "roll_deg": roll_deg,
        "pitch_deg": pitch_deg,
    }


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def get_wifi_rssi():
    try:
        wlan = network.WLAN(network.STA_IF)
        if hasattr(wlan, "status"):
            return wlan.status("rssi")
    except Exception:
        pass
    return None
