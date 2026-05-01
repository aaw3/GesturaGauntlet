import math
import network
import time
import ujson
import uasyncio as asyncio

from lib.endpoint_cache import EndpointCache
from lib.env import http_to_ws_url, ws_to_http_url
from lib.http_client import get_json, post_json
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
        self.metric_interval_sec = max(15, int(env.get("METRIC_INTERVAL_SEC", "300")))
        self.action_send_interval_ms = int(env.get("ACTION_SEND_INTERVAL_MS", "75"))
        self.ws_heartbeat_enabled = env_bool(env.get("WS_HEARTBEAT_ENABLED", "false"))
        self.ws_heartbeat_ms = int(env.get("WS_HEARTBEAT_MS", "20000"))
        self.ws_first_heartbeat_delay_ms = int(env.get("WS_FIRST_HEARTBEAT_DELAY_MS", "30000"))
        self.ws_offline_timeout_ms = int(env.get("WS_OFFLINE_TIMEOUT_MS", "90000"))
        self.ws_action_fresh_ms = int(env.get("WS_ACTION_FRESH_MS", "60000"))
        self.ws_force_fresh_action_socket = env_bool(env.get("WS_FORCE_FRESH_ACTION_SOCKET", "false"))
        self.ws_action_response_timeout_ms = int(env.get("WS_ACTION_RESPONSE_TIMEOUT_MS", "1500"))
        self.ws_send_cooldown_ms = int(env.get("WS_SEND_COOLDOWN_MS", "1500"))
        self.ws_failed_send_cooldown_ms = int(env.get("WS_FAILED_SEND_COOLDOWN_MS", "5000"))
        self.ws_reconnect_base_delay_ms = int(env.get("WS_RECONNECT_BASE_DELAY_MS", "1000"))
        self.ws_reconnect_max_delay_ms = int(env.get("WS_RECONNECT_MAX_DELAY_MS", "60000"))
        self.ws_connect_timeout_sec = float(env.get("WS_CONNECT_TIMEOUT_SEC", "1.0"))
        self.ws_soak_test = env_bool(env.get("WS_SOAK_TEST", "false"))
        self.passive_metrics_enabled = False
        if self.ws_soak_test:
            self.ws_heartbeat_ms = max(self.ws_heartbeat_ms, 30000)
        self.action_ack_timeout_ms = int(env.get("ACTION_ACK_TIMEOUT_MS", "5000"))
        self.fsr_loop_interval_ms = int(env.get("FSR_LOOP_INTERVAL_MS", "20"))
        self.ui_loop_interval_ms = int(env.get("UI_LOOP_INTERVAL_MS", "150"))
        self.network_loop_interval_ms = int(env.get("NETWORK_LOOP_INTERVAL_MS", "20"))
        self.action_queue_max = int(env.get("ACTION_QUEUE_MAX", "16"))
        self.action_queue_timeout_ms = int(env.get("ACTION_QUEUE_TIMEOUT_MS", "8000"))
        self.action_transport = str(env.get("PICO_ACTION_TRANSPORT", "auto") or "auto").lower()
        self.http_action_fallback = env_bool(env.get("PICO_HTTP_ACTION_FALLBACK", "true"))
        self.http_action_timeout = float(env.get("PICO_HTTP_ACTION_TIMEOUT_SEC", "1.0"))
        self.timing_log_interval_ms = int(env.get("TIMING_LOG_INTERVAL_MS", "5000"))
        self.endpoint_cache_path = env.get("ENDPOINT_CACHE_PATH", "endpoint_cache.json")
        self.ca_der_path = env.get("CA_DER_PATH", "")
        self.status = StatusState(env.get("WIFI_SSID", ""))
        self.battery_enabled = env_bool(env.get("BATTERY_ENABLED", "false"))
        if self.battery_enabled:
            battery_label = env.get("BATTERY_LABEL", "")
            self.status.update(battery=battery_label if battery_label else None)
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
        self.active_interface = None
        self.config_source = "offline"
        self.mappings = []
        self.devices = []
        self.managers = []
        self.route_states = []
        self.runtime_config_loaded = False
        self.runtime_config_hash = ""
        self.runtime_config_version = 0
        self.endpoint_hash = ""
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
        self.ws_send_in_progress = False
        self.last_ws_send_failed_ms = 0
        self.last_successful_ws_send_ms = 0
        self.last_rx_ms = 0
        self.last_tx_ms = 0
        self.last_pong_ms = 0
        self.ws_connected_at_ms = 0
        self.ws_connect_failures = 0
        self.next_ws_connect_allowed_ms = 0
        self.last_action_values = {}
        self.last_mapping_send_ms = {}
        self.action_seq = 0
        self.action_queue = []
        self.pending_action_acks = {}
        self.background_tasks = []
        self.loop_timing = {
            "fsr_loop_ms": 0,
            "ui_loop_ms": 0,
            "network_loop_ms": 0,
            "max_loop_block_ms": 0,
            "last_log_ms": time.ticks_ms(),
        }
        self.last_connection_log = {}
        self.last_log_message = ""
        self.last_log_repeat = 0
        self.last_failed_action_log_id = ""

    def start_background_tasks(self):
        self.background_tasks = [
            asyncio.create_task(self.network_task()),
            asyncio.create_task(self.sensor_task()),
            asyncio.create_task(self.wifi_task()),
        ]
        return self.background_tasks

    async def update(self, input_events):
        self.handle_input_events(input_events)
        await asyncio.sleep_ms(0)

    def handle_input_events(self, input_events):
        self.sensor["pressure"] = self.input_reader.bottom_pressure()
        self.navigation.handle_events(input_events)
        for action in self.navigation.pop_pending_actions():
            self.enqueue_action(action, "ui")

    def enqueue_action(self, action, source="input"):
        if self.ws_soak_test:
            if self.action_debug.should_print():
                print("[DEBUG][action] skipped reason=ws_soak_test")
            return False
        now = time.ticks_ms()
        if source == "mapping":
            mapping_id = action.get("mappingId")
            for queued in self.action_queue:
                queued_action = queued.get("action", {})
                if mapping_id and queued_action.get("mappingId") == mapping_id:
                    queued["action"] = action
                    queued["queued_at"] = now
                    if self.action_debug.should_print():
                        print("[DEBUG][action] queue_replace mapping={} depth={} {}".format(
                            mapping_id,
                            len(self.action_queue),
                            describe_action(action),
                        ))
                    return True
        if len(self.action_queue) >= self.action_queue_max:
            dropped = self.action_queue.pop(0)
            self.messages_failed += 1
            if self.action_debug.should_print():
                print("[DEBUG][action] queue_drop oldest age_ms={}".format(
                    time.ticks_diff(now, dropped.get("queued_at", now)),
                ))
        self.action_seq += 1
        action_id = "{}-{}".format(now, self.action_seq)
        self.action_queue.append({
            "id": action_id,
            "action": action,
            "queued_at": now,
            "source": source,
            "attempts": 0,
        })
        self.state.message = "Action queued"
        self.state.mark_dirty()
        if self.action_debug.should_print():
            print("[DEBUG][action] queued id={} depth={} {}".format(action_id, len(self.action_queue), describe_action(action)))
        return True

    def send_action(self, action):
        if self.action_debug.enabled():
            print(
                "[DEBUG][action] send requested connected={} transport={} endpoint={} route={} action={}".format(
                    self.status.connected,
                    "yes" if self.transport else "no",
                    redact_url(self.active_endpoint) if self.active_endpoint else "none",
                    self.status.route,
                    describe_action(action),
                )
            )
        if not self.ensure_action_socket():
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] send blocked: ws unhealthy active_endpoint={} ws_connected={} wifi_connected={} last_error={} transport_error={}".format(
                        redact_url(self.active_endpoint) if self.active_endpoint else "none",
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
            self.send_ws_json(payload, "mapped_action")
            self.pending_action_acks[action_id] = {
                "sent_at": time.ticks_ms(),
                "action": action,
                "acked": False,
            }
            response_ok = self.wait_for_action_response(action_id, self.ws_action_response_timeout_ms)
            if not response_ok:
                self.pending_action_acks.pop(action_id, None)
                if self.action_debug.enabled():
                    print("[DEBUG][action] dropped after send actionId={} reason=no_ack_or_result".format(action_id))
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
                        redact_url(self.active_endpoint) if self.active_endpoint else "none",
                        redact_url(self.build_glove_ws_url(self.active_endpoint)) if self.active_endpoint else "none",
                    )
                )
            return False

    def consume_queued_action(self, now):
        if not self.action_queue:
            return False
        queued = self.action_queue[0]
        age_ms = time.ticks_diff(now, queued.get("queued_at", now))
        if age_ms > self.action_queue_timeout_ms:
            self.action_queue.pop(0)
            self.messages_failed += 1
            self.status.update(last_error="Action queue timeout")
            self.state.message = "Action expired"
            self.state.mark_dirty()
            if self.action_debug.should_print():
                print("[DEBUG][action] expired id={} age_ms={}".format(queued.get("id"), age_ms))
            return True

        drop_after_attempt = False
        if self.action_transport == "http":
            ok = self.send_action_http(queued)
            drop_after_attempt = True
        elif self.action_transport == "ws":
            ok = self.send_action_ws_queued(queued)
        elif self.endpoint_uses_http():
            ok = self.send_action_http(queued)
            drop_after_attempt = True
        else:
            ok = self.send_action_ws_queued(queued)
            if not ok and self.http_action_fallback:
                ok = self.send_action_http(queued)
                drop_after_attempt = True

        if ok or drop_after_attempt:
            self.action_queue.pop(0)
        else:
            queued["attempts"] = int(queued.get("attempts", 0)) + 1
        return True

    def send_action_ws_queued(self, queued):
        if not self.socket_ready():
            return False
        action = queued.get("action", {})
        payload = {
            "type": "mapped_action",
            "gloveId": self.glove_id,
            "ts": time.ticks_ms(),
            "actionId": queued.get("id"),
            "action": action,
        }
        try:
            self.send_ws_json(payload, "mapped_action")
            self.pending_action_acks[queued.get("id")] = {
                "sent_at": time.ticks_ms(),
                "action": action,
                "acked": False,
            }
            self.state.message = "Sent {}".format(action.get("capabilityId", "action"))
            self.state.mark_dirty()
            return True
        except Exception as exc:
            self.messages_failed += 1
            self.mark_ws_unhealthy("queued_send", exc)
            return False

    def send_action_http(self, queued):
        action = queued.get("action", {})
        if not self.active_endpoint:
            return False
        started = time.ticks_ms()
        try:
            payload = {
                "type": "mapped_action",
                "gloveId": self.glove_id,
                "actionId": queued.get("id"),
                "action": action,
            }
            payload.update(action)
            result = post_json(
                self.with_pico_auth(self.action_url_for_endpoint(self.active_endpoint, action)),
                payload,
                ca_der_path=self.ca_der_path,
                timeout=self.http_action_timeout,
            )
            self.status.update(rtt_ms=time.ticks_diff(time.ticks_ms(), started))
            self.messages_sent += 1
            self.last_successful_ws_send_ms = time.ticks_ms()
            if result.get("result"):
                self.apply_confirmed_action_result(result.get("result") or {})
            elif result.get("deviceId") and result.get("capabilityId"):
                self.apply_confirmed_action_result(result)
            self.status.update(connected=True, last_error="", degraded=False)
            self.state.message = "Sent {}".format(action.get("capabilityId", "action"))
            self.state.mark_dirty()
            return True
        except Exception as exc:
            self.status.update(rtt_ms=time.ticks_diff(time.ticks_ms(), started))
            self.messages_failed += 1
            self.status.update(last_error="HTTP action failed: {}".format(exc), degraded=True)
            action_id = queued.get("id", "")
            if action_id != self.last_failed_action_log_id and self.action_debug.should_print():
                self.last_failed_action_log_id = action_id
                print("[DEBUG][action] http failed id={} error={}".format(queued.get("id"), repr(exc)))
            return False

    async def network_task(self):
        reconnect_delay_ms = self.ws_reconnect_base_delay_ms
        last_action_ms = 0
        last_config_refresh_ms = 0
        last_heartbeat_ms = 0
        last_soak_log_ms = 0

        while True:
            try:
                if not self.active_endpoint:
                    self.log_config_refetch_reason("no_config" if not self.runtime_config_loaded else "no_endpoint")
                    self.active_endpoint = self.bootstrap_runtime_config()
                if not self.active_endpoint:
                    self.set_connection(False, "OFFLINE")
                    await asyncio.sleep_ms(reconnect_delay_ms)
                    reconnect_delay_ms = min(self.ws_reconnect_max_delay_ms, reconnect_delay_ms * 2)
                    continue

                if self.endpoint_uses_http() or self.action_transport == "http":
                    current_ms = time.ticks_ms()
                    self.set_connection(True, "HTTP")
                    self.consume_queued_action(current_ms)
                    if (
                        not self.ws_soak_test
                        and self.state.mode == "ACTIVE"
                        and time.ticks_diff(current_ms, last_action_ms) >= self.action_send_interval_ms
                    ):
                        for action in self.build_mapped_actions():
                            self.enqueue_action(action, "mapping")
                        last_action_ms = current_ms
                        self.consume_queued_action(current_ms)
                    if (
                        time.ticks_diff(current_ms, last_config_refresh_ms) >= 60_000
                        and not self.runtime_config_loaded
                    ):
                        self.log_config_refetch_reason("no_config")
                        self.refresh_runtime_config("no_config")
                        last_config_refresh_ms = current_ms
                    self.record_loop_timing("network_loop_ms", current_ms)
                    await asyncio.sleep_ms(self.network_loop_interval_ms)
                    continue

                if not self.socket_ready():
                    if not self.connect_ws("receive_channel"):
                        current_ms = time.ticks_ms()
                        if (
                            not self.ws_soak_test
                            and self.state.mode == "ACTIVE"
                            and time.ticks_diff(current_ms, last_action_ms) >= self.action_send_interval_ms
                        ):
                            for action in self.build_mapped_actions():
                                self.enqueue_action(action, "mapping")
                            last_action_ms = current_ms
                        self.consume_queued_action(current_ms)
                        self.record_loop_timing("network_loop_ms", current_ms)
                        await asyncio.sleep_ms(self.ws_connect_backoff_ms())
                        continue
                reconnect_delay_ms = self.ws_reconnect_base_delay_ms
            except Exception as exc:
                print("WebSocket connection failed:", repr(exc))
                self.messages_failed += 1
                self.close_transport()
                self.status.update(last_error=str(exc))
                self.set_connection(False, "OFFLINE")
                if self.ws_debug.enabled():
                    print(
                        "[DEBUG][ws] connect failed reconnect_reason=connect_failed type={} error={} next_retry_ms={} failed_count={}".format(
                            type(exc).__name__,
                            repr(exc),
                            reconnect_delay_ms,
                            self.messages_failed,
                        )
                    )
                await asyncio.sleep_ms(reconnect_delay_ms)
                reconnect_delay_ms = min(self.ws_reconnect_max_delay_ms, reconnect_delay_ms * 2)
                continue

            while True:
                try:
                    incoming = self.transport.receive_json(timeout=0.01)
                    self.sync_transport_activity()
                    if incoming:
                        if self.ws_debug.enabled():
                            print("[DEBUG][ws] incoming {}".format(safe_json(incoming)))
                        self.handle_server_message(incoming)

                    current_ms = time.ticks_ms()
                    if (
                        self.ws_soak_test
                        and time.ticks_diff(current_ms, last_soak_log_ms) >= 60_000
                    ):
                        last_soak_log_ms = current_ms
                        print(
                            "[DEBUG][ws] soak_status connected_ms={} five_min_stable={} last_rx_ms={} last_tx_ms={} last_pong_ms={}".format(
                                time.ticks_diff(current_ms, self.ws_connected_at_ms),
                                "true" if time.ticks_diff(current_ms, self.ws_connected_at_ms) >= 300_000 else "false",
                                self.last_rx_ms,
                                self.last_tx_ms,
                                self.last_pong_ms,
                            )
                        )
                    if self.ws_heartbeat_enabled and self.should_send_heartbeat(current_ms, last_heartbeat_ms):
                        if not self.can_attempt_ws_send(current_ms, "ping"):
                            last_heartbeat_ms = current_ms
                        elif not self.send_ws_heartbeat(current_ms):
                            last_heartbeat_ms = current_ms
                            if self.ws_debug.enabled():
                                print("[DEBUG][ws] heartbeat failed ignored for best_effort_receive")
                        else:
                            last_heartbeat_ms = current_ms

                    if self.check_action_ack_timeouts(current_ms):
                        raise RuntimeError("Action ACK timeout")

                    if (
                        not self.ws_soak_test
                        and
                        self.state.mode == "ACTIVE"
                        and time.ticks_diff(current_ms, last_action_ms) >= self.action_send_interval_ms
                    ):
                        for action in self.build_mapped_actions():
                            if self.action_debug.should_print():
                                print("[DEBUG][action] mapped from imu {}".format(safe_json(action)))
                            self.enqueue_action(action, "mapping")
                            last_action_ms = current_ms

                    self.consume_queued_action(current_ms)

                    if (
                        time.ticks_diff(current_ms, last_config_refresh_ms) >= 60_000
                        and not self.runtime_config_loaded
                    ):
                        self.log_config_refetch_reason("no_config")
                        self.refresh_runtime_config("no_config")
                        last_config_refresh_ms = current_ms

                    if not self.transport or not self.transport.is_healthy():
                        break
                except Exception as exc:
                    print("WebSocket error:", repr(exc))
                    self.messages_failed += 1
                    self.mark_ws_unhealthy("network_loop", exc)
                    if self.ws_debug.enabled():
                        print(
                            "[DEBUG][ws] loop error reconnect_reason=ws_send_or_receive_failed type={} error={} sent={} failed={} last_successful_ws_send_ms={}".format(
                                type(exc).__name__,
                                repr(exc),
                                self.messages_sent,
                                self.messages_failed,
                                self.last_successful_ws_send_ms,
                            )
                        )
                    try:
                        self.transport.close()
                    except Exception:
                        pass
                    self.transport = None
                    await asyncio.sleep_ms(self.ws_connect_backoff_ms())
                    break

                self.record_loop_timing("network_loop_ms", current_ms)
                await asyncio.sleep_ms(self.network_loop_interval_ms)

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
                if self.state.wifi_reconnect_requested:
                    self.status.update(wifi_connected=False, connected=False, ws_connected=False, route="OFFLINE")
                    if self.wifi_manager.override_ssid:
                        connected = self.wifi_manager.connect_override()
                    else:
                        connected = self.wifi_manager.connect_best(timeout_sec=5)
                    if connected:
                        self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), wifi_connected=True, last_error="")
                        self.active_endpoint = None
                        self.active_interface = None
                    self.state.wifi_reconnect_requested = False
                    self.state.mark_dirty()
                elif self.wifi_manager.override_ssid and self.wifi_manager.current_ssid() != self.wifi_manager.override_ssid:
                    self.status.update(wifi_connected=False, connected=False, ws_connected=False, route="OFFLINE")
                    if self.wifi_manager.connect_override():
                        self.status.update(wifi_ssid=self.wifi_manager.current_ssid(), wifi_connected=True, last_error="")
                        self.active_endpoint = None
                        self.active_interface = None
                    self.state.mark_dirty()
                if self.wifi_debug.should_print():
                    print(
                        "[DEBUG][wifi] status={} connected={} ssid={} ifconfig={} route={} endpoint={}".format(
                            self._wifi_status_code(),
                            self.wifi_manager.is_connected(),
                            self.wifi_manager.current_ssid(),
                            self._wifi_ifconfig(),
                            self.status.route,
                            redact_url(self.active_endpoint) if self.active_endpoint else "none",
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
                        self.active_interface = None
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
                self.send_ws_json(self.build_sensor_snapshot(), "sensor_snapshot")
            return
        if message_type == "refresh_config":
            reason = str(message.get("reason", "server_requested") or "server_requested")
            self.log_config_refetch_reason(reason)
            self.refresh_runtime_config(reason)
            return
        if message_type == "mapped_action_ack":
            action_id = message.get("actionId", "")
            pending = self.pending_action_acks.get(action_id)
            rtt_ms = None
            if pending is not None:
                pending["acked"] = True
                rtt_ms = time.ticks_diff(time.ticks_ms(), pending.get("sent_at", time.ticks_ms()))
                self.status.update(rtt_ms=rtt_ms)
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] ack accepted={} actionId={} mappingId={} rtt_ms={}".format(
                        bool(message.get("accepted", message.get("ok", False))),
                        action_id,
                        message.get("mappingId", ""),
                        rtt_ms if rtt_ms is not None else "?",
                    )
                )
            return
        if message_type == "mapped_action_result":
            action_id = message.get("actionId", "")
            pending = self.pending_action_acks.pop(action_id, None)
            rtt_ms = None
            if pending is not None:
                rtt_ms = time.ticks_diff(time.ticks_ms(), pending.get("sent_at", time.ticks_ms()))
                self.status.update(rtt_ms=rtt_ms)
            ok = bool(message.get("ok"))
            result = message.get("result", {}) or {}
            if ok:
                self.apply_confirmed_action_result(result)
            if self.action_debug.enabled():
                print(
                    "[DEBUG][action] result ok={} actionId={} mappingId={} rtt_ms={} result={}".format(
                        ok,
                        action_id,
                        message.get("mappingId", ""),
                        rtt_ms if rtt_ms is not None else "?",
                        safe_json(result),
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
        now = time.ticks_ms()
        for mapping in self.mappings:
            if not mapping.get("enabled", True):
                continue
            source = mapping.get("inputSource", "")
            sensor_key = mapping_sensor_key(source)
            if not sensor_key:
                continue
            if not self.mapping_input_active(source):
                continue
            value = self.sensor.get(sensor_key, 0.0)
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
            min_interval_ms = mapping_min_interval_ms(mapping)
            last_sent_ms = self.last_mapping_send_ms.get(key, 0)
            if last_sent_ms and time.ticks_diff(now, last_sent_ms) < min_interval_ms:
                continue
            self.last_action_values[key] = mapped_value
            self.last_mapping_send_ms[key] = now
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

    def mapping_input_active(self, source):
        if source == "top_hold_roll":
            return self.input_reader.is_held("top")
        if source == "bottom_hold_roll":
            return self.input_reader.is_held("bottom")
        return True

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
            "action_queue_depth": len(self.action_queue),
            "fsr_loop_ms": self.loop_timing.get("fsr_loop_ms", 0),
            "ui_loop_ms": self.loop_timing.get("ui_loop_ms", 0),
            "network_loop_ms": self.loop_timing.get("network_loop_ms", 0),
            "max_loop_block_ms": self.loop_timing.get("max_loop_block_ms", 0),
        }

    def bootstrap_runtime_config(self):
        cache = EndpointCache(self.endpoint_cache_path)
        try:
            if self.wifi_debug.enabled():
                print("[DEBUG][wifi] fetching endpoint metadata {}".format(redact_url(self.central_glove_api_url("endpoints"))))
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
            url = self.config_url_for_interface(interface)
            if not seen.get(url):
                attempts.append(("edge", url, interface))
                seen[url] = True

        central_url = self.central_glove_api_url("config")
        if not seen.get(central_url):
            attempts.append(("central", central_url, None))

        for source, url, interface in attempts:
            try:
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] config attempt source={} url={}".format(source, redact_url(url)))
                config = self.fetch_json(url)
                self.active_interface = interface
                endpoints = self.update_runtime_config(config, source)
                if endpoints:
                    cache.update_if_changed(endpoints, ca_der_path=self.ca_der_path)
                if interface:
                    cache.set_last_good(interface.get("nodeId", ""))
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] config ok source={} endpoint={}".format(
                        source,
                        redact_url(interface_endpoint(interface)) if interface else redact_url(self.glove_ws_url),
                    ))
                if interface:
                    return interface_endpoint(interface)
                return self.glove_ws_url
            except Exception as exc:
                self.status.update(last_error=str(exc))
                if self.wifi_debug.enabled():
                    print("[DEBUG][wifi] config failed source={} url={} error={}".format(source, redact_url(url), exc))

        self.update_runtime_config({"mappings": [], "devices": [], "managers": []}, "offline")
        self.runtime_config_loaded = False
        if self.wifi_debug.enabled():
            print("[DEBUG][wifi] all route/config attempts failed; Route OFFLINE")
        return None

    def refresh_runtime_config(self, reason="manual"):
        if not self.active_endpoint:
            return False
        try:
            if self.ws_debug.enabled():
                self.debug_log("[DEBUG][ws] refreshing config reason={} endpoint={}".format(reason, redact_url(self.active_endpoint)))
            config = self.fetch_json(self.config_url_for_active_endpoint())
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
        previous_hash = self.runtime_config_hash
        next_hash = str(config.get("configHash") or config.get("hash") or "")
        next_version = int(config.get("configVersion", config.get("version", self.runtime_config_version)) or 0)
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
        if next_hash:
            self.runtime_config_hash = next_hash
        self.runtime_config_version = next_version
        self.runtime_config_loaded = True
        if isinstance(endpoints, dict):
            self.endpoint_hash = str(endpoints.get("hash") or self.endpoint_hash or "")
        node_name = active_node_name(endpoints, self.active_interface)
        if self.ws_debug.enabled():
            print(
                "[DEBUG][ws] config source={} managers={} devices={} mappings={} endpoints={} hash_changed={} config_hash={} config_version={} endpoint_hash={}".format(
                    source,
                    len(self.managers),
                    len(self.devices),
                    len(self.mappings),
                    "yes" if endpoints else "no",
                    "true" if next_hash and next_hash != previous_hash else "false",
                    self.runtime_config_hash or "none",
                    self.runtime_config_version,
                    self.endpoint_hash or "none",
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

    def apply_confirmed_action_result(self, result):
        device_id = result.get("deviceId")
        capability_id = result.get("capabilityId")
        if not device_id or not capability_id or "appliedValue" not in result:
            return False
        applied_value = result.get("appliedValue")
        changed = False
        for device in self.devices:
            if device.id != device_id:
                continue
            for capability in device.capabilities:
                if capability.id == capability_id:
                    capability.value = applied_value
                    changed = True
                    break
        screen = self.state.current_screen
        if screen and getattr(screen, "kind", "") == "device" and getattr(screen.device, "id", "") == device_id:
            changed = screen.set_value(capability_id, applied_value) or changed
        if changed:
            self.state.message = "{} confirmed".format(capability_id)
            self.state.mark_dirty()
            if self.action_debug.enabled():
                print("[DEBUG][action] confirmed device={} capability={} appliedValue={}".format(
                    device_id,
                    capability_id,
                    applied_value,
                ))
        return changed

    def set_connection(self, connected, message):
        route = route_label(self.active_endpoint, self.config_source, connected)
        changed = (
            self.status.connected != connected
            or self.status.ws_connected != connected
            or self.status.route != route
            or self.last_connection_log.get("endpoint") != self.active_endpoint
            or self.last_connection_log.get("last_error") != self.status.last_error
            or self.state.message != message
        )
        self.status.update(
            connected=connected,
            ws_connected=connected,
            route=route,
        )
        self.state.message = message
        if changed:
            self.state.mark_dirty()
        now = time.ticks_ms()
        heartbeat_due = time.ticks_diff(now, self.last_connection_log.get("logged_at", 0)) >= 10_000
        if self.ws_debug.enabled() and (changed or heartbeat_due):
            self.debug_log(
                "[DEBUG][ws] connection event={} connected={} message={} route={} endpoint={} last_error={}".format(
                    "change" if changed else "heartbeat",
                    connected,
                    message,
                    self.status.route,
                    redact_url(self.active_endpoint) if self.active_endpoint else "none",
                    self.status.last_error or "none",
                ),
                force=heartbeat_due and not changed,
            )
            self.last_connection_log = {
                "connected": connected,
                "route": route,
                "endpoint": self.active_endpoint,
                "last_error": self.status.last_error,
                "logged_at": now,
            }

    def socket_ready(self):
        return bool(self.transport and self.transport.is_healthy() and self.status.ws_connected)

    def connect_ws(self, reason, force=False):
        now = time.ticks_ms()
        if not force and self.next_ws_connect_allowed_ms and time.ticks_diff(now, self.next_ws_connect_allowed_ms) < 0:
            if self.ws_debug.enabled() or self.action_debug.enabled():
                print("[DEBUG][ws] connect skipped reason={} circuit_open wait_ms={} failures={}".format(
                    reason,
                    time.ticks_diff(self.next_ws_connect_allowed_ms, now),
                    self.ws_connect_failures,
                ))
            return False
        if not self.active_endpoint:
            if not self.runtime_config_loaded:
                self.log_config_refetch_reason("no_config")
                self.active_endpoint = self.bootstrap_runtime_config()
            else:
                self.log_config_refetch_reason("no_endpoint")
                self.active_endpoint = self.glove_ws_url
                self.active_interface = None
        if not self.active_endpoint:
            return False
        self.close_transport()
        ws_url = self.build_glove_ws_url(self.active_endpoint)
        try:
            if self.ws_debug.enabled() or self.action_debug.enabled():
                print("[DEBUG][ws] connecting reason={} endpoint={} ws_url={}".format(
                    reason,
                    redact_url(self.active_endpoint),
                    redact_url(ws_url),
                ))
            self.transport = SimpleWebSocketClient(ws_url, timeout=self.ws_connect_timeout_sec, ca_der_path=self.ca_der_path)
            self.transport.connect()
            self.ws_connected_at_ms = time.ticks_ms()
            self.sync_transport_activity()
            self.send_ws_json({
                "type": "hello",
                "gloveId": self.glove_id,
                "ts": time.ticks_ms(),
            }, "hello")
            self.status.update(last_error="", degraded=False)
            self.set_connection(True, "READY")
            self.ws_connect_failures = 0
            self.next_ws_connect_allowed_ms = 0
            if self.ws_debug.enabled() or self.action_debug.enabled():
                print("[DEBUG][ws] connect ok reason={} route={} endpoint={} passive_metrics=false heartbeat={}".format(
                    reason,
                    self.status.route,
                    redact_url(self.active_endpoint),
                    "true" if self.ws_heartbeat_enabled else "false",
                ))
            return True
        except Exception as exc:
            self.messages_failed += 1
            self.close_transport()
            self.note_ws_connect_failure(reason, exc)
            self.status.update(last_error=str(exc))
            self.set_connection(False, "OFFLINE")
            return False

    def ensure_action_socket(self):
        now = time.ticks_ms()
        if self.socket_ready():
            if self.recent_ws_activity(now):
                if not self.ws_force_fresh_action_socket or not self.action_socket_is_stale(now):
                    return True
            else:
                self.mark_ws_unhealthy("activity_timeout", "idle_ms={}".format(
                    time.ticks_diff(now, max(self.last_rx_ms, self.last_tx_ms, self.last_successful_ws_send_ms))
                ))
        if self.action_debug.enabled() or self.ws_debug.enabled():
            print("[DEBUG][ws] action socket refresh needed ready={} force_fresh={} age_ms={} idle_ms={} threshold_ms={}".format(
                "true" if self.socket_ready() else "false",
                "true" if self.ws_force_fresh_action_socket else "false",
                time.ticks_diff(now, self.ws_connected_at_ms) if self.ws_connected_at_ms else -1,
                time.ticks_diff(now, max(self.last_rx_ms, self.last_tx_ms, self.last_successful_ws_send_ms)),
                self.ws_action_fresh_ms,
            ))
        return self.connect_ws("action_fresh_socket")

    def action_socket_is_stale(self, now):
        if not self.ws_connected_at_ms:
            return True
        age_ms = time.ticks_diff(now, self.ws_connected_at_ms)
        idle_ms = time.ticks_diff(now, max(self.last_rx_ms, self.last_tx_ms, self.last_successful_ws_send_ms))
        return age_ms > self.ws_action_fresh_ms or idle_ms > self.ws_action_fresh_ms

    def wait_for_action_response(self, action_id, timeout_ms):
        deadline = time.ticks_add(time.ticks_ms(), timeout_ms)
        while time.ticks_diff(deadline, time.ticks_ms()) > 0:
            try:
                incoming = self.transport.receive_json(timeout=0.01) if self.transport else None
                self.sync_transport_activity()
                if incoming:
                    if self.ws_debug.enabled() or self.action_debug.enabled():
                        print("[DEBUG][ws] incoming while_waiting_action {}".format(safe_json(incoming)))
                    self.handle_server_message(incoming)
                    pending = self.pending_action_acks.get(action_id)
                    if pending is None:
                        return True
                    if pending.get("acked"):
                        self.pending_action_acks.pop(action_id, None)
                        return True
            except Exception as exc:
                if self.action_debug.enabled() or self.ws_debug.enabled():
                    print("[DEBUG][action] wait response failed actionId={} error={}".format(action_id, repr(exc)))
                return False
        if self.action_debug.enabled() or self.ws_debug.enabled():
            print("[DEBUG][action] wait response timeout actionId={} timeout_ms={}".format(action_id, timeout_ms))
        return False

    def close_transport(self):
        if self.transport:
            try:
                self.transport.close()
            except Exception:
                pass
        self.transport = None
        self.status.update(ws_connected=False)

    def note_ws_connect_failure(self, reason, exc):
        self.ws_connect_failures += 1
        delay_ms = self.ws_connect_backoff_ms()
        self.next_ws_connect_allowed_ms = time.ticks_add(time.ticks_ms(), delay_ms)
        if self.ws_debug.enabled() or self.action_debug.enabled():
            print("[DEBUG][ws] connect failed reason={} error={} failures={} next_retry_ms={}".format(
                reason,
                repr(exc),
                self.ws_connect_failures,
                delay_ms,
            ))

    def ws_connect_backoff_ms(self):
        failures = max(0, self.ws_connect_failures - 1)
        delay = self.ws_reconnect_base_delay_ms
        while failures > 0 and delay < self.ws_reconnect_max_delay_ms:
            delay *= 2
            failures -= 1
        return min(self.ws_reconnect_max_delay_ms, delay)

    def send_ws_heartbeat(self, now):
        if not self.transport:
            return False
        try:
            self.send_ws_ping("hb:{}".format(now), "ping")
            if self.ws_debug.enabled():
                print("[DEBUG][ws] heartbeat ping sent endpoint={} last_successful_ws_send_ms={}".format(
                    redact_url(self.active_endpoint) if self.active_endpoint else "none",
                    self.last_successful_ws_send_ms,
                ))
            return True
        except Exception as exc:
            self.messages_failed += 1
            if self.ws_debug.enabled():
                print("[DEBUG][ws] heartbeat failed ignored {}".format(repr(exc)))
            return False

    def should_send_heartbeat(self, now, last_heartbeat_ms):
        if time.ticks_diff(now, self.ws_connected_at_ms) < self.ws_first_heartbeat_delay_ms:
            return False
        last_activity_ms = max(self.last_rx_ms, self.last_tx_ms, self.last_successful_ws_send_ms)
        if time.ticks_diff(now, last_activity_ms) < self.ws_heartbeat_ms:
            return False
        return time.ticks_diff(now, last_heartbeat_ms) >= self.ws_heartbeat_ms

    def sync_transport_activity(self):
        if not self.transport:
            return
        self.last_rx_ms = getattr(self.transport, "last_rx_ms", self.last_rx_ms) or self.last_rx_ms
        self.last_tx_ms = getattr(self.transport, "last_tx_ms", self.last_tx_ms) or self.last_tx_ms
        self.last_pong_ms = getattr(self.transport, "last_pong_ms", self.last_pong_ms) or self.last_pong_ms

    def recent_ws_activity(self, now):
        return time.ticks_diff(now, max(self.last_rx_ms, self.last_tx_ms, self.last_successful_ws_send_ms)) < self.ws_offline_timeout_ms

    def can_attempt_ws_send(self, now, kind):
        if self.ws_send_in_progress:
            if self.ws_debug.enabled():
                print("[DEBUG][ws] send skipped kind={} reason=send_in_progress".format(kind))
            return False
        if self.last_ws_send_failed_ms and time.ticks_diff(now, self.last_ws_send_failed_ms) < self.ws_failed_send_cooldown_ms:
            if self.ws_debug.enabled():
                print("[DEBUG][ws] send skipped kind={} reason=recent_send_failure last_successful_ws_send_ms={}".format(
                    kind,
                    self.last_successful_ws_send_ms,
                ))
            return False
        if time.ticks_diff(now, self.last_successful_ws_send_ms) < self.ws_send_cooldown_ms:
            if self.ws_debug.enabled():
                print("[DEBUG][ws] send skipped kind={} reason=send_cooldown last_successful_ws_send_ms={}".format(
                    kind,
                    self.last_successful_ws_send_ms,
                ))
            return False
        return True

    def send_ws_json(self, payload, kind, throttle=False):
        if not self.transport:
            raise RuntimeError("websocket is not connected")
        now = time.ticks_ms()
        if self.ws_send_in_progress:
            raise RuntimeError("websocket send already in progress: {}".format(kind))
        if throttle and not self.can_attempt_ws_send(now, kind):
            raise RuntimeError("websocket send skipped: {}".format(kind))
        encoded = ujson.dumps(payload)
        payload_bytes = len(encoded)
        self.log_ws_send_start(kind, payload_bytes)
        self.ws_send_in_progress = True
        started = time.ticks_ms()
        try:
            self.transport.send_text(encoded)
            self.messages_sent += 1
            self.last_successful_ws_send_ms = time.ticks_ms()
            self.sync_transport_activity()
            self.log_ws_send_finish(kind, payload_bytes, started, True)
        except Exception:
            self.last_ws_send_failed_ms = time.ticks_ms()
            self.sync_transport_activity()
            self.log_ws_send_finish(kind, payload_bytes, started, False)
            raise
        finally:
            self.ws_send_in_progress = False

    def send_ws_ping(self, payload, kind):
        if not self.transport:
            raise RuntimeError("websocket is not connected")
        now = time.ticks_ms()
        if not self.can_attempt_ws_send(now, kind):
            raise RuntimeError("websocket ping skipped: {}".format(kind))
        payload_bytes = len(payload.encode("utf-8") if isinstance(payload, str) else payload)
        self.log_ws_send_start(kind, payload_bytes)
        self.ws_send_in_progress = True
        started = time.ticks_ms()
        try:
            self.transport.ping(payload)
            self.messages_sent += 1
            self.last_successful_ws_send_ms = time.ticks_ms()
            self.sync_transport_activity()
            self.log_ws_send_finish(kind, payload_bytes, started, True)
        except Exception:
            self.last_ws_send_failed_ms = time.ticks_ms()
            self.sync_transport_activity()
            self.log_ws_send_finish(kind, payload_bytes, started, False)
            raise
        finally:
            self.ws_send_in_progress = False

    def log_ws_send_start(self, kind, payload_bytes):
        if self.ws_debug.enabled() or self.action_debug.enabled():
            print(
                "[DEBUG][ws] send_start kind={} bytes={} last_rx_ms={} last_tx_ms={} last_pong_ms={}".format(
                    kind,
                    payload_bytes,
                    self.last_rx_ms,
                    self.last_tx_ms,
                    self.last_pong_ms,
                )
            )

    def log_ws_send_finish(self, kind, payload_bytes, started_ms, ok):
        if self.ws_debug.enabled() or self.action_debug.enabled():
            print(
                "[DEBUG][ws] send_finish kind={} bytes={} duration_ms={} success={} last_rx_ms={} last_tx_ms={} last_pong_ms={}".format(
                    kind,
                    payload_bytes,
                    time.ticks_diff(time.ticks_ms(), started_ms),
                    "true" if ok else "false",
                    self.last_rx_ms,
                    self.last_tx_ms,
                    self.last_pong_ms,
                )
            )

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
        if reason != "heartbeat":
            self.ws_connect_failures += 1
            delay_ms = self.ws_connect_backoff_ms()
            self.next_ws_connect_allowed_ms = time.ticks_add(time.ticks_ms(), delay_ms)
        now = time.ticks_ms()
        recent_activity = self.recent_ws_activity(now)
        self.status.update(
            connected=recent_activity,
            ws_connected=False,
            last_error="WSS {}: {}".format(reason, error_text),
            degraded=recent_activity,
        )
        if recent_activity:
            self.status.update(route=route_label(self.active_endpoint, self.config_source, True))
            self.state.message = "RECONNECTING"
            self.state.mark_dirty()
        else:
            self.set_connection(False, "OFFLINE")
        if self.ws_debug.enabled() or self.action_debug.enabled():
            print(
                "[DEBUG][ws] unhealthy reconnect_reason={} error={} wifi_connected={} wlan_status={} endpoint={} recent_activity={} next_retry_ms={} last_successful_ws_send_ms={} last_rx_ms={} last_tx_ms={} last_pong_ms={}".format(
                    reason,
                    error_text,
                    self.status.wifi_connected,
                    self._wifi_status_code(),
                    redact_url(self.active_endpoint) if self.active_endpoint else "none",
                    "true" if recent_activity else "false",
                    self.ws_connect_backoff_ms(),
                    self.last_successful_ws_send_ms,
                    self.last_rx_ms,
                    self.last_tx_ms,
                    self.last_pong_ms,
                )
            )

    def log_config_refetch_reason(self, reason):
        if self.ws_debug.enabled() or self.wifi_debug.enabled():
            print(
                "[DEBUG][ws] config_refetch_reason={} has_config={} endpoint={} config_hash={} endpoint_hash={}".format(
                    reason,
                    "true" if self.runtime_config_loaded else "false",
                    redact_url(self.active_endpoint) if self.active_endpoint else "none",
                    self.runtime_config_hash or "none",
                    self.endpoint_hash or "none",
                )
            )

    def record_loop_timing(self, key, started_ms):
        duration = time.ticks_diff(time.ticks_ms(), started_ms)
        self.loop_timing[key] = duration
        if duration > self.loop_timing.get("max_loop_block_ms", 0):
            self.loop_timing["max_loop_block_ms"] = duration
        now = time.ticks_ms()
        if time.ticks_diff(now, self.loop_timing.get("last_log_ms", now)) >= self.timing_log_interval_ms:
            self.loop_timing["last_log_ms"] = now
            self.debug_log(
                "[TIMING] fsr_loop_ms={} ui_loop_ms={} network_loop_ms={} max_loop_block_ms={}".format(
                    self.loop_timing.get("fsr_loop_ms", 0),
                    self.loop_timing.get("ui_loop_ms", 0),
                    self.loop_timing.get("network_loop_ms", 0),
                    self.loop_timing.get("max_loop_block_ms", 0),
                )
            )
            self.loop_timing["max_loop_block_ms"] = 0

    def debug_log(self, message, force=False):
        if not force and message == self.last_log_message:
            self.last_log_repeat += 1
            if self.last_log_repeat % 25 == 0:
                print("{} repeated {}x".format(message, self.last_log_repeat))
            return
        if self.last_log_repeat:
            print("{} repeated {}x".format(self.last_log_message, self.last_log_repeat))
        self.last_log_message = message
        self.last_log_repeat = 0
        print(message)

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

    def endpoint_uses_http(self):
        endpoint = self.active_endpoint or self.glove_ws_url
        return str(endpoint).startswith("http://") or str(endpoint).startswith("https://")

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

    def config_url_for_interface(self, interface):
        template = interface.get("configHttpUrl", "")
        if template:
            return fill_endpoint_template(template, self.glove_id)
        return self.config_url_for_endpoint(interface_endpoint(interface))

    def config_url_for_active_endpoint(self):
        if self.active_interface:
            return self.config_url_for_interface(self.active_interface)
        return self.config_url_for_endpoint(self.active_endpoint)

    def action_url_for_endpoint(self, endpoint_url, action):
        if self.active_interface and self.active_interface.get("actionHttpUrl"):
            return fill_endpoint_template(
                self.active_interface.get("actionHttpUrl"),
                self.glove_id,
                action.get("deviceId", ""),
                action.get("capabilityId", ""),
            )
        if self.active_interface:
            raise RuntimeError("active edge interface missing actionHttpUrl")
        http_url = ws_to_http_url(endpoint_url).split("?", 1)[0].rstrip("/")
        if http_url.endswith("/glove"):
            http_url = http_url[:-len("/glove")]
        return "{}/api/gloves/{}/actions/{}/{}".format(
            http_url,
            self.glove_id,
            action.get("deviceId", ""),
            action.get("capabilityId", ""),
        )


def interface_endpoint(interface):
    return interface.get("gloveWsUrl") or interface.get("url") or interface.get("configHttpUrl") or ""


def fill_endpoint_template(template, glove_id, device_id="", capability_id=""):
    return (
        str(template or "")
        .replace(":gloveId", glove_id)
        .replace(":deviceId", device_id)
        .replace(":capabilityId", capability_id)
    )


def is_allowed_endpoint(interface):
    url = interface_endpoint(interface)
    kind = interface.get("kind", "")
    if interface.get("configHttpUrl") and interface.get("actionHttpUrl"):
        return True
    if url.startswith("wss://") or url.startswith("https://"):
        return True
    return kind == "lan" and (url.startswith("ws://") or url.startswith("http://"))


def active_node_name(endpoints, active_interface=None):
    if active_interface:
        node_id = active_interface.get("nodeId", "")
        node_name = active_interface.get("nodeName", "")
        if node_name:
            return node_name
        try:
            for node in endpoints.get("nodes", []):
                if node.get("nodeId") == node_id:
                    return node.get("name") or node.get("nodeId")
        except Exception:
            pass
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


def mapping_sensor_key(source):
    if source in ("glove.roll", "top_hold_roll", "bottom_hold_roll"):
        return "roll"
    if source == "glove.pitch":
        return "pitch"
    return None


def apply_mapping_transform(value, mapping):
    transform = mapping.get("transform", {}) or {}
    minimum = float(transform.get("min", 0))
    maximum = float(transform.get("max", 100))
    deadzone = abs(float(transform.get("deadzone", 0)))
    offset = float(transform.get("offset", 0))
    if abs(float(value)) < deadzone:
        value = 0
    scale = float(transform.get("scale", 1) or 1)
    normalized = max(-1, min(1, (float(value) * scale) + offset))
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


def mapping_min_interval_ms(mapping):
    transform = mapping.get("transform", {}) or {}
    interval = int(transform.get("intervalMs", transform.get("minIntervalMs", 0)) or 0)
    if interval > 0:
        return interval
    mode = str(mapping.get("mode", "")).lower()
    if mode.startswith("continuous"):
        return 50
    return 0


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


def env_bool(value):
    return str(value or "").lower() in ("1", "true", "yes", "on")