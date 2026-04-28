import math
import network
import time
import ujson
import uasyncio as asyncio

from lib.endpoint_cache import EndpointCache
from lib.env import http_to_ws_url, ws_to_http_url
from lib.http_client import get_json
from lib.websocket_client import SimpleWebSocketClient
from modules.debug import DebugPrinter
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
        self.ws_heartbeat_ms = int(env.get("WS_HEARTBEAT_MS", "20000"))
        self.action_ack_timeout_ms = int(env.get("ACTION_ACK_TIMEOUT_MS", "5000"))
        self.endpoint_cache_path = env.get("ENDPOINT_CACHE_PATH", "endpoint_cache.json")
        self.ca_der_path = env.get("CA_DER_PATH", "")
        self.status = StatusState(env.get("WIFI_SSID", ""))
        self.status.update(battery=env.get("BATTERY_LABEL", "--"))
        if wifi_manager:
            self.status.update(
                wifi_connected=wifi_manager.is_connected(),
                wifi_ssid=wifi_manager.current_ssid() or env.get("WIFI_SSID", ""),
            )
        self.state = AppState(self.status)
        self.state.wifi_manager = wifi_manager
        debug_config = env.get("DEBUG_CONFIG")
        self.navigation = NavigationController(self.state, debug_config=debug_config)
        self.imu_debug = DebugPrinter(env.get("DEBUG_CONFIG"), "imu")
        self.wifi_debug = DebugPrinter(debug_config, "wifi")
        self.action_debug = DebugPrinter(debug_config, "action")
        self.ws_debug = DebugPrinter(debug_config, "ws")
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
        self.action_seq = 0
        self.pending_action_acks = {}
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
                self.status.update(wifi_connected=False, connected=False, ws_connected=False, route="OFFLINE")
                if self.wifi_manager.connect_best(timeout_sec=10):
                    self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), wifi_connected=True, last_error="")
                    self.active_endpoint = None
                self.state.wifi_reconnect_requested = False
                self.state.mark_dirty()
            elif self.wifi_manager.override_ssid and self.wifi_manager.current_ssid() != self.wifi_manager.override_ssid:
                self.status.update(wifi_connected=False, connected=False, ws_connected=False, route="OFFLINE")
                if self.wifi_manager.connect_override():
                    self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), wifi_connected=True, last_error="")
                    self.active_endpoint = None
                self.state.mark_dirty()
        for action in self.navigation.pop_pending_actions():
            if self.action_debug.enabled():
                print("[DEBUG][action] dequeued {}".format(safe_json(action)))
            self.send_action(action)
        await asyncio.sleep_ms(0)

    def send_action(self, action):
        if self.action_debug.enabled():
            print(
                "[DEBUG][action] send requested connected={} transport={} endpoint={} route={} action={}".format(
                    self.status.connected,
                    "yes" if self.transport else "no",
                    self.active_endpoint or "none",
                    self.status.route,
                    describe_action(action),
                )
            )
        if not self.socket_ready():
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] send blocked: ws unhealthy active_endpoint={} ws_connected={} wifi_connected={} last_error={} transport_error={}".format(
                        self.active_endpoint or "none",
                        self.status.ws_connected,
                        self.status.wifi_connected,
                        self.status.last_error or "none",
                        getattr(self.transport, "last_error", "") if self.transport else "none",
                    )
                )
            self.state.message = "No connection"
            self.state.mark_dirty()
            return False
        self.action_seq += 1
        action_id = "{}-{}".format(time.ticks_ms(), self.action_seq)
        payload = {
            "type": "mapped_action",
            "gloveId": self.glove_id,
            "ts": time.ticks_ms(),
            "actionId": action_id,
            "action": action,
        }
        try:
            if self.action_debug.enabled():
                print("[DEBUG][action] payload {}".format(safe_json(payload)))
            self.transport.send_json(payload)
            self.messages_sent += 1
            self.pending_action_acks[action_id] = {
                "sent_at": time.ticks_ms(),
                "action": action,
            }
            self.state.message = "Sent {}".format(action.get("capabilityId", "action"))
            self.state.mark_dirty()
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] send ok sent={} failed={} device={} capability={}".format(
                        self.messages_sent,
                        self.messages_failed,
                        action.get("deviceId", "?"),
                        action.get("capabilityId", "?"),
                    )
                )
            return True
        except Exception as exc:
            self.messages_failed += 1
            self.mark_ws_unhealthy("send_action", exc)
            self.state.message = "Send failed"
            self.state.mark_dirty()
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] send failed type={} error={} sent={} failed={} transport={} endpoint={} ws_url={}".format(
                        type(exc).__name__,
                        repr(exc),
                        self.messages_sent,
                        self.messages_failed,
                        "yes" if self.transport else "no",
                        self.active_endpoint or "none",
                        redact_url(self.build_glove_ws_url(self.active_endpoint)) if self.active_endpoint else "none",
                    )
                )
            return False

    async def network_task(self):
        reconnect_delay_ms = 500
        max_delay_ms = 5000
        last_metrics_ms = 0
        last_action_ms = 0
        last_config_refresh_ms = 0
        last_heartbeat_ms = 0
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
                if self.ws_debug.enabled():
                    print("[DEBUG][ws] connecting endpoint={} ws_url={}".format(
                        self.active_endpoint,
                        redact_url(ws_url),
                    ))
                self.transport = SimpleWebSocketClient(ws_url, ca_der_path=self.ca_der_path)
                self.transport.connect()
                if self.ws_debug.enabled():
                    print("[DEBUG][ws] connected; sending hello gloveId={}".format(self.glove_id))
                self.transport.send_json({
                    "type": "hello",
                    "gloveId": self.glove_id,
                    "ts": time.ticks_ms(),
                })
                self.set_connection(True, "READY")
                if self.ws_debug.enabled():
                    print("[DEBUG][ws] ready route={} endpoint={}".format(self.status.route, self.active_endpoint))
                reconnect_delay_ms = 500
            except Exception as exc:
                print("WebSocket connection failed:", repr(exc))
                self.messages_failed += 1
                self.transport = None
                self.active_endpoint = None
                self.status.update(last_error=str(exc))
                self.set_connection(False, "OFFLINE")
                if self.ws_debug.enabled():
                    print(
                        "[DEBUG][ws] connect failed type={} error={} next_retry_ms={} failed_count={}".format(
                            type(exc).__name__,
                            repr(exc),
                            reconnect_delay_ms,
                            self.messages_failed,
                        )
                    )
                await asyncio.sleep_ms(reconnect_delay_ms)
                reconnect_delay_ms = min(max_delay_ms, reconnect_delay_ms * 2)
                continue

            while True:
                try:
                    incoming = self.transport.receive_json(timeout=0.01)
                    if incoming:
                        if self.ws_debug.enabled():
                            print("[DEBUG][ws] incoming {}".format(safe_json(incoming)))
                        if incoming.get("type") == "passive_metrics_ack" and pending_metrics_sent_at is not None:
                            self.status.update(rtt_ms=time.ticks_diff(time.ticks_ms(), pending_metrics_sent_at))
                            pending_metrics_sent_at = None
                            self.state.mark_dirty()
                        self.handle_server_message(incoming)

                    current_ms = time.ticks_ms()
                    if time.ticks_diff(current_ms, last_heartbeat_ms) >= self.ws_heartbeat_ms:
                        if not self.send_ws_heartbeat(current_ms):
                            raise RuntimeError("WebSocket heartbeat failed")
                        last_heartbeat_ms = current_ms

                    if self.check_action_ack_timeouts(current_ms):
                        raise RuntimeError("Action ACK timeout")

                    if (
                        self.state.mode == "ACTIVE"
                        and time.ticks_diff(current_ms, last_action_ms) >= self.action_send_interval_ms
                    ):
                        for action in self.build_mapped_actions():
                            if self.action_debug.enabled():
                                print("[DEBUG][action] mapped from imu {}".format(safe_json(action)))
                            self.send_action(action)
                            last_action_ms = current_ms

                    if time.ticks_diff(current_ms, last_config_refresh_ms) >= 60_000:
                        self.refresh_runtime_config()
                        last_config_refresh_ms = current_ms

                    if time.ticks_diff(current_ms, last_metrics_ms) >= self.metric_interval_sec * 1000:
                        pending_metrics_sent_at = current_ms
                        metrics_payload = {
                            "type": "passive_metrics",
                            "gloveId": self.glove_id,
                            "ts": current_ms,
                            "metrics": [self.build_device_metrics()],
                        }
                        if self.ws_debug.enabled():
                            print("[DEBUG][ws] sending metrics {}".format(safe_json(metrics_payload)))
                        self.transport.send_json(metrics_payload)
                        self.messages_sent += 1
                        last_metrics_ms = current_ms
                except Exception as exc:
                    print("WebSocket error:", repr(exc))
                    self.messages_failed += 1
                    self.mark_ws_unhealthy("network_loop", exc)
                    self.active_endpoint = None
                    if self.ws_debug.enabled():
                        print(
                            "[DEBUG][ws] loop error type={} error={} sent={} failed={}".format(
                                type(exc).__name__,
                                repr(exc),
                                self.messages_sent,
                                self.messages_failed,
                            )
                        )
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
                if self.imu_debug.should_print():
                    print(
                        "[DEBUG][imu] accel=({:.3f},{:.3f},{:.3f}) gyro=({:.3f},{:.3f},{:.3f}) roll={:.1f} pitch={:.1f}".format(
                            accel_data["x"],
                            accel_data["y"],
                            accel_data["z"],
                            gyro_data["x"],
                            gyro_data["y"],
                            gyro_data["z"],
                            orientation["roll_deg"],
                            orientation["pitch_deg"],
                        )
                    )
            except Exception as exc:
                self.status.update(last_error=str(exc))
            await asyncio.sleep_ms(20)

    async def wifi_task(self):
        while True:
            if self.wifi_manager:
                if self.wifi_debug.should_print():
                    print(
                        "[DEBUG][wifi] status={} connected={} ssid={} ifconfig={} route={} endpoint={}".format(
                            self._wifi_status_code(),
                            self.wifi_manager.is_connected(),
                            self.wifi_manager.current_ssid(),
                            self._wifi_ifconfig(),
                            self.status.route,
                            self.active_endpoint or "none",
                        )
                    )
                if self.wifi_manager.scan():
                    if self.wifi_debug.enabled():
                        print("[DEBUG][wifi] scan profiles={} found={}".format(
                            len(self.wifi_manager.profiles),
                            len(self.wifi_manager.scan_results),
                        ))
                    self.state.mark_dirty()
                if not self.wifi_manager.is_connected():
                    self.status.update(wifi_connected=False, last_error="WiFi disconnected")
                    self.state.mark_dirty()
                    if self.wifi_debug.enabled():
                        print("[DEBUG][wifi] disconnected; attempting reconnect")
                    if self.wifi_manager.ensure_connected():
                        self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), wifi_connected=True, last_error="")
                        self.active_endpoint = None
                        self.state.mark_dirty()
                        if self.wifi_debug.enabled():
                            print("[DEBUG][wifi] reconnect ok ssid={} ip={}".format(
                                self.wifi_manager.current_ssid(),
                                self._wifi_ifconfig()[0],
                            ))
                    elif self.wifi_debug.enabled():
                        print("[DEBUG][wifi] reconnect failed status={}".format(self._wifi_status_code()))
                else:
                    self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), wifi_connected=True)
            await asyncio.sleep_ms(15_000)

    def handle_server_message(self, message):
        message_type = message.get("type")
        if self.ws_debug.enabled():
            print("[DEBUG][ws] handle message type={}".format(message_type or "unknown"))
        if message_type == "request_sensor_snapshot":
            if self.transport:
                if self.ws_debug.enabled():
                    print("[DEBUG][ws] sending sensor snapshot")
                self.transport.send_json(self.build_sensor_snapshot())
            return
        if message_type == "mapped_action_ack":
            action_id = message.get("actionId", "")
            pending = self.pending_action_acks.get(action_id)
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] ack accepted={} actionId={} mappingId={} rtt_ms={}".format(
                        bool(message.get("accepted", message.get("ok", False))),
                        action_id,
                        message.get("mappingId", ""),
                        time.ticks_diff(time.ticks_ms(), pending.get("sent_at", time.ticks_ms())) if pending else "?",
                    )
                )
            return
        if message_type == "mapped_action_result":
            action_id = message.get("actionId", "")
            pending = self.pending_action_acks.pop(action_id, None)
            ok = bool(message.get("ok"))
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] result ok={} actionId={} mappingId={} rtt_ms={} result={}".format(
                        ok,
                        action_id,
                        message.get("mappingId", ""),
                        time.ticks_diff(time.ticks_ms(), pending.get("sent_at", time.ticks_ms())) if pending else "?",
                        safe_json(message.get("result", {})),
                    )
                )
            if not ok:
                self.status.update(last_error="Action rejected")
                self.state.message = "Action rejected"
                self.state.mark_dirty()
            return
        if message_type == "error":
            if self.action_debug.enabled() or self.ws_debug.enabled():
                print("[DEBUG][ws] server error {}".format(safe_json(message)))
            self.status.update(last_error=str(message.get("message", "server error")))
            self.state.message = "Server error"
            self.state.mark_dirty()
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
                if self.action_debug.enabled():
                    print(
                        "[DEBUG][action] skip mapping={} delta={:.4f} step={:.4f}".format(
                            key,
                            abs(float(mapped_value) - float(previous)),
                            effective_step(mapping),
                        )
                    )
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
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] built mapping={} source={} value={} mapped={}".format(
                        key,
                        source,
                        value,
                        mapped_value,
                    )
                )
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
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] fetching endpoint metadata {}".format(self.central_glove_api_url("endpoints")))
                metadata = self.fetch_json(self.central_glove_api_url("endpoints"))
                cache.update_if_changed(metadata, ca_der_path=self.ca_der_path)
            except Exception as exc:
                self.status.update(last_error=str(exc))
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] endpoint metadata failed: {}".format(exc))

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
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] config attempt source={} url={}".format(source, url))
                config = self.fetch_json(url)
                endpoints = self.update_runtime_config(config, source)
                if endpoints:
                    cache.update_if_changed(endpoints, ca_der_path=self.ca_der_path)
                if interface:
                    cache.set_last_good(interface.get("nodeId", ""))
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] config ok source={} endpoint={}".format(
                        source,
                        interface.get("url") if interface else self.glove_ws_url,
                    ))
                return interface.get("url") if interface else self.glove_ws_url
            except Exception as exc:
                self.status.update(last_error=str(exc))
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] config failed source={} url={} error={}".format(source, url, exc))

        self.update_runtime_config({"mappings": [], "devices": [], "managers": []}, "offline")
        if self.wifi_debug.enabled():
            print("[DEBUG][wifi] all route/config attempts failed; Route OFFLINE")
        return None

    def refresh_runtime_config(self):
        if not self.active_endpoint:
            return False
        try:
            if self.ws_debug.enabled():
                print("[DEBUG][ws] refreshing config endpoint={}".format(self.active_endpoint))
            config = self.fetch_json(self.config_url_for_endpoint(self.active_endpoint))
            self.update_runtime_config(config, self.config_source)
            if self.ws_debug.enabled():
                print("[DEBUG][ws] refresh config ok")
            return True
        except Exception as exc:
            self.status.update(last_error=str(exc))
            if self.ws_debug.enabled():
                print("[DEBUG][ws] refresh config failed {}".format(repr(exc)))
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
        if self.ws_debug.enabled():
            print(
                "[DEBUG][ws] config source={} managers={} devices={} mappings={} endpoints={}".format(
                    source,
                    len(self.managers),
                    len(self.devices),
                    len(self.mappings),
                    "yes" if endpoints else "no",
                )
            )
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
            ws_connected=connected,
            route=route_label(self.active_endpoint, self.config_source, connected),
        )
        self.state.message = message
        self.state.mark_dirty()
        if self.ws_debug.enabled():
            print(
                "[DEBUG][ws] connection connected={} message={} route={} endpoint={} last_error={}".format(
                    connected,
                    message,
                    self.status.route,
                    self.active_endpoint or "none",
                    self.status.last_error or "none",
                )
            )

    def socket_ready(self):
        return bool(self.transport and self.transport.is_healthy() and self.status.ws_connected)

    def send_ws_heartbeat(self, now):
        if not self.transport:
            return False
        try:
            self.transport.ping("hb:{}".format(now))
            if self.ws_debug.enabled():
                print("[DEBUG][ws] heartbeat ping sent endpoint={}".format(self.active_endpoint or "none"))
            return True
        except Exception as exc:
            self.messages_failed += 1
            self.mark_ws_unhealthy("heartbeat", exc)
            if self.ws_debug.enabled():
                print("[DEBUG][ws] heartbeat failed {}".format(repr(exc)))
            return False

    def check_action_ack_timeouts(self, now):
        expired = []
        for action_id, pending in self.pending_action_acks.items():
            if time.ticks_diff(now, pending.get("sent_at", now)) > self.action_ack_timeout_ms:
                expired.append(action_id)
        for action_id in expired:
            pending = self.pending_action_acks.pop(action_id, {})
            action = pending.get("action", {})
            self.messages_failed += 1
            self.status.update(last_error="Action ACK timeout")
            self.state.message = "ACK timeout"
            self.state.mark_dirty()
            self.mark_ws_unhealthy("action_ack_timeout", "actionId={}".format(action_id))
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] ack timeout actionId={} timeout_ms={} {}".format(
                        action_id,
                        self.action_ack_timeout_ms,
                        describe_action(action),
                    )
                )
        return bool(expired)

    def mark_ws_unhealthy(self, reason, exc=None):
        error_text = repr(exc) if exc is not None else str(reason)
        if self.transport:
            try:
                self.transport.mark_unhealthy(error_text)
            except Exception:
                pass
        self.status.update(
            connected=False,
            ws_connected=False,
            last_error="WSS {}: {}".format(reason, error_text),
        )
        self.set_connection(False, "OFFLINE")
        if self.ws_debug.enabled() or self.action_debug.enabled():
            print(
                "[DEBUG][ws] unhealthy reason={} error={} wifi_connected={} wlan_status={} endpoint={}".format(
                    reason,
                    error_text,
                    self.status.wifi_connected,
                    self._wifi_status_code(),
                    self.active_endpoint or "none",
                )
            )

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

    def _wifi_status_code(self):
        try:
            return self.wifi_manager.wlan.status() if self.wifi_manager else "none"
        except Exception as exc:
            return "err:{}".format(exc)

    def _wifi_ifconfig(self):
        try:
            return self.wifi_manager.wlan.ifconfig() if self.wifi_manager else ("", "", "", "")
        except Exception:
            return ("", "", "", "")

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


def safe_json(value):
    try:
        return ujson.dumps(value)
    except Exception:
        return str(value)


def describe_action(action):
    return "device={} capability={} command={} value={} mapping={}".format(
        action.get("deviceId", "?"),
        action.get("capabilityId", "?"),
        action.get("commandType", "?"),
        action.get("value", "?"),
        action.get("mappingId", "?"),
    )


def redact_url(url):
    text = str(url or "")
    for token_key in ("api_key=", "token="):
        index = text.find(token_key)
        if index >= 0:
            start = index + len(token_key)
            end = text.find("&", start)
            if end < 0:
                return text[:start] + "<redacted>"
            return text[:start] + "<redacted>" + text[end:]
    return text
