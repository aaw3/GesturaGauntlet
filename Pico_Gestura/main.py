import machine
import network
import uasyncio as asyncio
import time
import ujson
import math
from lib.endpoint_cache import EndpointCache
from lib.env import http_to_ws_url, load_env, ws_to_http_url
from lib.http_client import get_json
from lib.websocket_client import SimpleWebSocketClient
from system_init import hardware_check, connect_wifi
from modules.gui import GauntletGUI
from modules.mpu6050 import MPU6050
from modules.button import GauntletButton
from modules.datastore import StateStore
from modules.fsr import FSR

env = load_env()

WIFI_SSID = env.get("WIFI_SSID")
WIFI_PASS = env.get("WIFI_PASS")
GLOVE_WS_URL = env.get("GLOVE_WS_URL", "ws://localhost:3001/glove")
GLOVE_ID = env.get("GLOVE_ID", "primary_glove")
PICO_API_TOKEN = env.get("PICO_API_TOKEN", "")
METRICS_INTERVAL_SEC = int(env.get("METRIC_INTERVAL_SEC", "300"))
ACTION_SEND_INTERVAL_MS = int(env.get("ACTION_SEND_INTERVAL_MS", "250"))
ENDPOINT_CACHE_PATH = env.get("ENDPOINT_CACHE_PATH", "endpoint_cache.json")
CA_DER_PATH = env.get("CA_DER_PATH", "")

led = machine.Pin("LED", machine.Pin.OUT)
global_gui = None


def trigger_hardware_panic(error_code):
    print("FATAL ERROR:", error_code)
    while True:
        led.toggle()
        time.sleep(0.1)


def build_glove_ws_url(base_url=None):
    source_url = base_url or GLOVE_WS_URL
    url = http_to_ws_url(source_url).split("?", 1)[0]
    separator = "&" if "?" in url else "?"
    url = "{}{}gloveId={}".format(url, separator, GLOVE_ID)
    if PICO_API_TOKEN:
        url = "{}&api_key={}".format(url, PICO_API_TOKEN)
    return url


def with_pico_auth(url):
    if not PICO_API_TOKEN:
        return url
    separator = "&" if "?" in url else "?"
    return "{}{}api_key={}".format(url, separator, PICO_API_TOKEN)


def central_glove_api_url(suffix):
    base = ws_to_http_url(GLOVE_WS_URL).split("?", 1)[0]
    if base.endswith("/glove"):
        base = base[:-len("/glove")]
    return "{}/api/gloves/{}/{}".format(base.rstrip("/"), GLOVE_ID, suffix)


def config_url_for_endpoint(endpoint_url):
    http_url = ws_to_http_url(endpoint_url).split("?", 1)[0].rstrip("/")
    if http_url.endswith("/glove"):
        http_url = http_url[:-len("/glove")]
    return "{}/api/gloves/{}/config".format(http_url, GLOVE_ID)


def is_allowed_endpoint(interface):
    url = interface.get("url", "")
    kind = interface.get("kind", "")
    if url.startswith("wss://"):
        return True
    return kind == "lan" and url.startswith("ws://")


def fetch_json(url):
    return get_json(with_pico_auth(url), ca_der_path=CA_DER_PATH)


def update_runtime_config(store, config, source):
    endpoints = config.get("endpoints")
    store.update(
        mappings=config.get("mappings", []),
        devices=config.get("devices", []),
        managers=config.get("managers", []),
        route_states=config.get("routeStates", []),
        endpoint_metadata=endpoints,
        degraded=False,
        config_source=source,
    )
    return endpoints


def bootstrap_runtime_config(store):
    cache = EndpointCache(ENDPOINT_CACHE_PATH)

    if not cache.data.get("nodes"):
        try:
            metadata = fetch_json(central_glove_api_url("endpoints"))
            cache.update_if_changed(metadata, ca_der_path=CA_DER_PATH)
            store.update(endpoint_metadata=metadata)
            print("Loaded endpoint metadata from central")
        except Exception as exc:
            print("Central endpoint metadata fetch failed:", exc)

    attempts = []
    seen = {}
    for interface in cache.interfaces():
        if not is_allowed_endpoint(interface):
            continue
        url = config_url_for_endpoint(interface.get("url", ""))
        if not seen.get(url):
            attempts.append(("edge", url, interface))
            seen[url] = True

    central_url = central_glove_api_url("config")
    if not seen.get(central_url):
        attempts.append(("central", central_url, None))

    for source, url, interface in attempts:
        try:
            config = fetch_json(url)
            endpoints = update_runtime_config(store, config, source)
            if endpoints:
                cache.update_if_changed(endpoints, ca_der_path=CA_DER_PATH)
            if interface:
                cache.set_last_good(interface.get("nodeId", ""))
            print("Fetched glove config from", source, url)
            return interface.get("url") if interface else GLOVE_WS_URL
        except Exception as exc:
            print("Glove config fetch failed from {}: {}".format(url, exc))

    store.update(degraded=True, connected=False, mappings=[], action="OFFLINE")
    return None


async def network_task(gui, store):
    reconnect_delay_ms = 500
    max_delay_ms = 5000
    transport = None
    active_endpoint = store.get("active_endpoint")
    messages_sent = 0
    messages_failed = 0
    last_metrics_ms = 0
    last_action_ms = 0
    last_action_values = {}
    pending_metrics_sent_at = None

    while True:
        try:
            if not active_endpoint:
                active_endpoint = bootstrap_runtime_config(store)
                store.update(active_endpoint=active_endpoint)
            if not active_endpoint:
                gui.update_state(connected=False, action="OFFLINE")
                await asyncio.sleep_ms(reconnect_delay_ms)
                reconnect_delay_ms = min(max_delay_ms, reconnect_delay_ms * 2)
                continue

            ws_url = build_glove_ws_url(active_endpoint)
            transport = SimpleWebSocketClient(ws_url, ca_der_path=CA_DER_PATH)
            transport.connect()
            transport.send_json({
                "type": "hello",
                "gloveId": GLOVE_ID,
                "ts": time.ticks_ms(),
            })
            store.update(connected=True, transport=transport, degraded=False, active_endpoint=active_endpoint)
            gui.update_state(connected=True, action="READY")
            print("Connected to Gestura websocket:", ws_url)
            reconnect_delay_ms = 500
        except Exception as e:
            print("WebSocket connection failed:", e)
            messages_failed += 1
            active_endpoint = None
            store.update(connected=False, transport=None, active_endpoint=None)
            gui.update_state(connected=False)
            await asyncio.sleep_ms(reconnect_delay_ms)
            reconnect_delay_ms = min(max_delay_ms, reconnect_delay_ms * 2)
            continue

        while True:
            try:
                incoming = transport.receive_json(timeout=0.01)
                if incoming:
                    if incoming.get("type") == "passive_metrics_ack" and pending_metrics_sent_at is not None:
                        store.update(rtt_ms=time.ticks_diff(time.ticks_ms(), pending_metrics_sent_at))
                        pending_metrics_sent_at = None
                    handle_server_message(incoming, gui, store)

                state = store.snapshot()
                current_ms = time.ticks_ms()
                if (
                    state.get("mode") == "ACTIVE"
                    and time.ticks_diff(current_ms, last_action_ms) >= ACTION_SEND_INTERVAL_MS
                ):
                    actions = build_mapped_actions(state, last_action_values)
                    actions.extend(build_event_actions(state, store.drain_inputs()))
                    for action in actions:
                        transport.send_json({
                            "type": "mapped_action",
                            "gloveId": GLOVE_ID,
                            "ts": current_ms,
                            "action": action,
                        })
                        messages_sent += 1
                    if actions:
                        last_action_ms = current_ms
                elif state.get("mode") != "ACTIVE":
                    store.drain_inputs()

                if time.ticks_diff(current_ms, last_metrics_ms) >= METRICS_INTERVAL_SEC * 1000:
                    metric_payload = build_device_metrics(
                        state,
                        messages_sent,
                        messages_failed,
                    )
                    pending_metrics_sent_at = current_ms
                    transport.send_json({
                        "type": "passive_metrics",
                        "gloveId": GLOVE_ID,
                        "ts": current_ms,
                        "metrics": [metric_payload],
                    })
                    messages_sent += 1
                    last_metrics_ms = current_ms
            except Exception as e:
                print("WebSocket error:", e)
                messages_failed += 1
                gui.update_state(connected=False)
                store.update(connected=False, transport=None)
                active_endpoint = None
                try:
                    transport.close()
                except Exception:
                    pass
                break

            await asyncio.sleep_ms(20)


def build_device_metrics(state, messages_sent, messages_failed):
    return {
        "type": "glove_status",
        "wifi_rssi": get_wifi_rssi(),
        "uptime_sec": time.ticks_ms() // 1000,
        "mode": str(state.get("mode", "PASSIVE")).lower(),
        "selected_device_id": state.get("selected_device_id", ""),
        "selected_action": state.get("selected_action", state.get("action", "")),
        "rtt_ms": state.get("rtt_ms", 0),
        "messages_sent": messages_sent,
        "messages_failed": messages_failed,
    }


def build_sensor_snapshot(state):
    return {
        "type": "sensor_snapshot",
        "gloveId": GLOVE_ID,
        "ts": time.ticks_ms(),
        "mode": str(state.get("mode", "PASSIVE")).lower(),
        "roll": state.get("roll", 0.0),
        "pitch": state.get("pitch", 0.0),
        "roll_deg": state.get("roll_deg", 0.0),
        "pitch_deg": state.get("pitch_deg", 0.0),
        "x": state.get("accel_x", 0.0),
        "y": state.get("accel_y", 0.0),
        "z": state.get("accel_z", 0.0),
        "gx": state.get("gyro_x", 0.0),
        "gy": state.get("gyro_y", 0.0),
        "gz": state.get("gyro_z", 0.0),
        "pressure": state.get("pressure", 0.0),
    }


def build_mapped_actions(state, last_values):
    actions = []
    for mapping in state.get("mappings", []):
        if not mapping.get("enabled", True):
            continue
        source = mapping.get("inputSource", "")
        if source not in ("glove.roll", "glove.pitch"):
            continue
        value = input_value_for_source(source, state)
        if value is None:
            continue
        mapped_value = apply_mapping_transform(value, mapping)
        key = mapping.get("id") or "{}:{}".format(mapping.get("targetDeviceId"), mapping.get("targetCapabilityId"))
        previous = last_values.get(key)
        if previous is not None and abs(float(mapped_value) - float(previous)) < effective_step(mapping):
            continue
        last_values[key] = mapped_value
        actions.append({
            "mappingId": mapping.get("id"),
            "deviceId": mapping.get("targetDeviceId"),
            "capabilityId": mapping.get("targetCapabilityId"),
            "commandType": command_type_for_mapping(mapping),
            "value": mapped_value,
            "inputSource": source,
        })
    return actions


def build_event_actions(state, events):
    if not events:
        return []
    actions = []
    mappings = state.get("mappings", [])
    for event in events:
        source = event.get("source")
        if not source:
            continue
        for mapping in mappings:
            if not mapping.get("enabled", True):
                continue
            if mapping.get("inputSource") != source:
                continue
            value = apply_mapping_transform(event.get("value", 1), mapping)
            actions.append({
                "mappingId": mapping.get("id"),
                "deviceId": mapping.get("targetDeviceId"),
                "capabilityId": mapping.get("targetCapabilityId"),
                "commandType": command_type_for_mapping(mapping),
                "value": value,
                "inputSource": source,
                "event": event,
            })
    return actions


def input_value_for_source(source, state):
    if source == "glove.roll":
        return state.get("roll", 0.0)
    if source == "glove.pitch":
        return state.get("pitch", 0.0)
    return None


def command_type_for_mapping(mapping):
    mode = str(mapping.get("mode", "")).lower()
    if mode == "toggle":
        return "toggle"
    if mode == "scene":
        return "scene"
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


def handle_server_message(message, gui, store):
    message_type = message.get("type")
    if message_type == "request_sensor_snapshot":
        transport = store.get("transport")
        if transport:
            transport.send_json(build_sensor_snapshot(store.snapshot()))
        return
    if message_type in ("welcome", "config_snapshot", "mode_update"):
        mode = str(message.get("mode", "")).upper()
        if mode in ("ACTIVE", "PASSIVE"):
            store.update(mode=mode)
            gui.update_state(mode=mode)
        config = message.get("config")
        if isinstance(config, dict):
            update_runtime_config(store, config, "websocket")


async def sensor_task(gui, mpu, fsr, store):
    last_print_time = time.ticks_ms()

    while True:
        try:
            state = store.snapshot()
            if state.get("calibrate_req"):
                print("Sensor task: Starting calibration...")
                gui.update_state(action="CALIBRATING...")
                mpu.calibrate(samples=100)
                store.update(calibrate_req=False)
                gui.update_state(action="READY")
                print("Sensor task: Calibration finished.")

            accel_data = mpu.get_accel()
            gyro_data = mpu.get_gyro()
            orientation = calculate_orientation(accel_data)

            fsr.tick()
            pressure = fsr.get_pressure_percentage()

            mpu.runtime_re_zero(gyro_data["x"], gyro_data["y"], gyro_data["z"], alpha=0.999)

            store.update(
                accel_x=accel_data["x"],
                accel_y=accel_data["y"],
                accel_z=accel_data["z"],
                gyro_x=gyro_data["x"],
                gyro_y=gyro_data["y"],
                gyro_z=gyro_data["z"],
                roll=orientation["roll"],
                pitch=orientation["pitch"],
                roll_deg=orientation["roll_deg"],
                pitch_deg=orientation["pitch_deg"],
                pressure=pressure,
            )

            current_time = time.ticks_ms()
            if time.ticks_diff(current_time, last_print_time) >= 500:
                raw_v = fsr.read_voltage()
                smoothed_v = fsr.current_v_smoothed
                state = fsr.get_state()
                print(
                    "FSR -> Raw:{:.3f}V Smoothed:{:.3f}V STATE:{} P:{:.1f}%".format(
                        raw_v, smoothed_v, state, pressure
                    )
                )
                last_print_time = current_time
        except Exception as e:
            print("Sensor Task Error:", e)

        await asyncio.sleep_ms(20)


async def main():
    print("--- Booting Gestura Gauntlet OS ---")

    try:
        i2c, devices = hardware_check()
        connect_wifi(WIFI_SSID, WIFI_PASS)

        mpu_addr = 0x68 if 0x68 in devices else 0x69 if 0x69 in devices else None
        if mpu_addr is None:
            raise Exception("MPU6050 not found on I2C (expected 0x68 or 0x69). Check wiring/AD0.")
        mpu = MPU6050(i2c, addr=mpu_addr)
        fsr = FSR(26)

        global global_gui
        state_store = StateStore()
        global_gui = GauntletGUI(i2c, state_store)

        def on_fsr_double_press():
            current_mode = state_store.get("mode")
            new_mode = "ACTIVE" if current_mode == "PASSIVE" else "PASSIVE"
            state_store.update(mode=new_mode)
            global_gui.update_state(mode=new_mode)
            print("!!! FSR DOUBLE PRESS: Toggling mode to {} !!!".format(new_mode))
            transport = state_store.get("transport")
            if transport:
                try:
                    transport.send_json({
                        "type": "mode_set",
                        "gloveId": GLOVE_ID,
                        "mode": new_mode.lower(),
                        "button": "fsr_double_press",
                    })
                except Exception as e:
                    print("WebSocket FSR send error:", e)

        fsr.subscribe(FSR.EVENT_HARD_DOUBLE_PRESS, on_fsr_double_press)
    except Exception as e:
        trigger_hardware_panic(str(e))

    global_gui.update_state(connected=False, mode="PASSIVE", action="Boot Calibrate")
    global_gui.render()

    print("Performing Initial Calibration (Hold Steady)...")
    mpu.calibrate(samples=50)
    global_gui.update_state(action="Ready")

    action_button = GauntletButton(pin_num=13, name="Action")
    mode_button = GauntletButton(pin_num=12, name="Mode Toggle")
    time.sleep(1)

    print("Starting Parallel Tasks...")
    await asyncio.gather(
        global_gui.display_task(),
        sensor_task(global_gui, mpu, fsr, state_store),
        network_task(global_gui, state_store),
        action_button.monitor(global_gui, state_store),
        mode_button.monitor(global_gui, state_store),
    )


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("System halted manually.")
