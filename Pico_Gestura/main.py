import machine
import time
import uasyncio as asyncio

from lib.env import load_env
from modules.app import RuntimeApp
from modules.fsr import FSR
from modules.input import FSRInputReader
from modules.mpu6050 import MPU6050
from modules.renderer import SSD1306Renderer
from modules.wifi_manager import WiFiManager
from system_init import hardware_check


def trigger_hardware_panic(error_code):
    led = machine.Pin("LED", machine.Pin.OUT)
    print("FATAL ERROR:", error_code)
    while True:
        led.toggle()
        time.sleep(0.1)


async def main():
    env = load_env()
    i2c, devices = hardware_check()
    wifi_manager = WiFiManager(
        path=env.get("WIFI_CONFIG_PATH", "wifi_networks.json"),
        fallback_ssid=env.get("WIFI_SSID", ""),
        fallback_password=env.get("WIFI_PASS", ""),
    )
    wifi_manager.connect_best()

    mpu_addr = 0x68 if 0x68 in devices else 0x69 if 0x69 in devices else None
    if mpu_addr is None:
        raise Exception("MPU6050 not found on I2C (expected 0x68 or 0x69).")

    mpu = MPU6050(i2c, addr=mpu_addr)
    mpu.calibrate(samples=int(env.get("CALIBRATION_SAMPLES", "50")))

    top_fsr = FSR(int(env.get("TOP_FSR_PIN", "27")))
    bottom_fsr = FSR(int(env.get("BOTTOM_FSR_PIN", "26")))
    input_reader = FSRInputReader(top_fsr, bottom_fsr)
    app = RuntimeApp(env, mpu, input_reader, wifi_manager=wifi_manager)
    renderer = SSD1306Renderer(i2c)
    app.start_background_tasks()

    while True:
        input_events = input_reader.read()
        await app.update(input_events)
        renderer.render_if_dirty(app.state)
        await asyncio.sleep_ms(25)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("System halted manually.")
    except Exception as exc:
        trigger_hardware_panic(str(exc))
