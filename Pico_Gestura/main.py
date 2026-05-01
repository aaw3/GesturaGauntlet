import machine
import time
import uasyncio as asyncio

from lib.env import load_env
from modules.app import RuntimeApp
from modules.debug import DebugConfig, DebugPrinter
from modules.fsr import FSR
from modules.input import FSRInputReader
from modules.mpu6050 import MPU6050
from modules.renderer import SSD1306Renderer
from modules.wifi_manager import WiFiManager, sync_time_ntp
from system_init import hardware_check


def trigger_hardware_panic(error_code):
    led = machine.Pin("LED", machine.Pin.OUT)
    print("FATAL ERROR:", error_code)
    while True:
        led.toggle()
        time.sleep(0.1)


async def main():
    env = load_env()
    debug_config = DebugConfig(env)
    env["DEBUG_CONFIG"] = debug_config
    fsr_debug = DebugPrinter(debug_config, "fsr")
    wifi_debug = DebugPrinter(debug_config, "wifi")
    i2c, devices = hardware_check()
    wifi_manager = WiFiManager(
        path=env.get("WIFI_CONFIG_PATH", "wifi_networks.json"),
        fallback_ssid=env.get("WIFI_SSID", ""),
        fallback_password=env.get("WIFI_PASS", ""),
    )
    if wifi_debug.enabled():
        print("[DEBUG][wifi] loaded profiles={} override={}".format(
            len(wifi_manager.profiles),
            wifi_manager.override_ssid or "auto",
        ))
    try:
        wifi_manager.connect_best()
        sync_time_ntp()
    except Exception as exc:
        if wifi_debug.enabled():
            print("[DEBUG][wifi] initial connect failed: {}".format(exc))
        raise
    if wifi_debug.enabled():
        print("[DEBUG][wifi] initial connect ok ssid={} ifconfig={}".format(
            wifi_manager.current_ssid(),
            wifi_manager.wlan.ifconfig(),
        ))

    mpu_addr = 0x68 if 0x68 in devices else 0x69 if 0x69 in devices else None
    if mpu_addr is None:
        raise Exception("MPU6050 not found on I2C (expected 0x68 or 0x69).")

    mpu = MPU6050(i2c, addr=mpu_addr)
    mpu.calibrate(samples=int(env.get("CALIBRATION_SAMPLES", "50")))

    top_fsr = build_fsr(env, "TOP", "27")
    bottom_fsr = build_fsr(env, "BOTTOM", "26")
    input_reader = FSRInputReader(
        top_fsr,
        bottom_fsr,
        debounce_ms=env_int(env, "FSR_DEBOUNCE_MS", 25),
        double_click_ms=env_int(env, "FSR_DOUBLE_CLICK_MS", 280),
        hold_ms=env_int(env, "FSR_HOLD_MS", 450),
        hold_repeat_ms=env_int(env, "FSR_HOLD_REPEAT_MS", 160),
    )
    app = RuntimeApp(env, mpu, input_reader, wifi_manager=wifi_manager)
    renderer = SSD1306Renderer(i2c)
    app.start_background_tasks()
    asyncio.create_task(fsr_loop(app, input_reader, fsr_debug))
    asyncio.create_task(ui_loop(app, renderer))

    while True:
        await asyncio.sleep_ms(1000)


async def fsr_loop(app, input_reader, fsr_debug):
    while True:
        started = time.ticks_ms()
        input_events = input_reader.read()
        if input_events and fsr_debug.should_print():
            for event in input_events:
                print(
                    "[DEBUG][fsr] generated event={} source={} duration_ms={}".format(
                        event.get("type", "?"),
                        event.get("source", "?"),
                        event.get("duration_ms", 0),
                    )
                )
        if fsr_debug.should_print():
            snapshot = input_reader.debug_snapshot()
            top = snapshot["top"]
            bottom = snapshot["bottom"]
            print(
                "[DEBUG][fsr] top(pin={}, raw={}, pct={:.1f}, state={}/{}) bottom(pin={}, raw={}, pct={:.1f}, state={}/{})".format(
                    top.get("pin", "?"),
                    top.get("raw", 0),
                    top.get("pressure", 0.0),
                    top.get("state", "?"),
                    top.get("state_label", "?"),
                    bottom.get("pin", "?"),
                    bottom.get("raw", 0),
                    bottom.get("pressure", 0.0),
                    bottom.get("state", "?"),
                    bottom.get("state_label", "?"),
                )
            )
        app.handle_input_events(input_events)
        app.record_loop_timing("fsr_loop_ms", started)
        elapsed = time.ticks_diff(time.ticks_ms(), started)
        await asyncio.sleep_ms(max(0, app.fsr_loop_interval_ms - elapsed))


async def ui_loop(app, renderer):
    while True:
        started = time.ticks_ms()
        renderer.render_if_dirty(app.state)
        app.record_loop_timing("ui_loop_ms", started)
        elapsed = time.ticks_diff(time.ticks_ms(), started)
        await asyncio.sleep_ms(max(0, app.ui_loop_interval_ms - elapsed))

def build_fsr(env, prefix, default_pin):
    return FSR(
        int(env.get("{}_FSR_PIN".format(prefix), default_pin)),
        v_min=env_float(env, "{}_FSR_V_MIN".format(prefix), env_float(env, "FSR_V_MIN", 0.005)),
        v_max=env_float(env, "{}_FSR_V_MAX".format(prefix), env_float(env, "FSR_V_MAX", 0.4)),
        half_ratio=env_float(env, "{}_FSR_HALF_RATIO".format(prefix), env_float(env, "FSR_HALF_RATIO", 0.25)),
        full_ratio=env_float(env, "{}_FSR_FULL_RATIO".format(prefix), env_float(env, "FSR_FULL_RATIO", 0.55)),
        smoothing_samples=env_int(
            env,
            "{}_FSR_SMOOTHING_SAMPLES".format(prefix),
            env_int(env, "FSR_SMOOTHING_SAMPLES", 3),
        ),
    )


def env_int(env, key, default):
    try:
        return int(env.get(key, str(default)))
    except (TypeError, ValueError):
        return default


def env_float(env, key, default):
    try:
        return float(env.get(key, str(default)))
    except (TypeError, ValueError):
        return default


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("System halted manually.")
    except Exception as exc:
        trigger_hardware_panic(str(exc))