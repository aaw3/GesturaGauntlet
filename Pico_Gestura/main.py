import machine
import uasyncio as asyncio
import time
import ujson
from lib.umqtt.simple import MQTTClient
from lib.env import load_env
from system_init import hardware_check, connect_wifi
from modules.gui import GauntletGUI
from modules.mpu6050 import MPU6050
from modules.datastore import StateStore

# Load env vars
env = load_env()


# --- CONFIGURATION ---
WIFI_SSID = "UI-DeviceNet"
WIFI_PASS = "UI-DeviceNet"
MQTT_SERVER = env.get("MQTT_SERVER", "")
CLIENT_ID = "GesturaPico"

led = machine.Pin("LED", machine.Pin.OUT)

def trigger_hardware_panic(error_code):
    print(f"FATAL ERROR: {error_code}")
    while True:
        led.toggle()
        time.sleep(0.1)

# Global MQTT Client
mqtt_client = MQTTClient(CLIENT_ID, MQTT_SERVER, keepalive=60)

def mqtt_callback(topic, msg):
    """Fires instantly when the Node server sends a mode change."""
    if topic == b'gauntlet/mode':
        new_mode = msg.decode('utf-8').upper()
        global_gui.update_state(mode=new_mode)
        print(f"Mode instantly changed to: {new_mode}")

async def network_task(gui, store):
    """Maintains the MQTT connection and publishes data."""
    mqtt_client.set_callback(mqtt_callback)
    
    try:
        mqtt_client.connect()
        mqtt_client.subscribe(b"gauntlet/mode")
        gui.update_state(connected=True)
        print("Connected to MQTT Broker!")
    except Exception as e:
        print("MQTT Connection Failed:", e)
        gui.update_state(connected=False)
        return

    while True:
        try:
            # Check for incoming mode changes from the dashboard
            mqtt_client.check_msg()
            
            # Publish live sensor data if we are in passive mode
            state = store.snapshot()
            if state.get("mode") == "PASSIVE":
                payload = ujson.dumps({
                    "x": state.get("accel_x", 0.0),
                    "y": state.get("accel_y", 0.0),
                    "z": state.get("accel_z", 0.0),
                    "gx": state.get("gyro_x", 0.0),
                    "gy": state.get("gyro_y", 0.0),
                    "gz": state.get("gyro_z", 0.0)
                })
                mqtt_client.publish(b"gauntlet/sensors", payload)
                
        except Exception as e:
            print("MQTT Error:", e)
            
        # Yield control. 20ms = 50Hz publish rate for buttery smooth UI tracking
        await asyncio.sleep_ms(20)

async def sensor_task(gui, mpu, store):
    """Constantly reads the physical I2C motion sensor."""
    while True:
        try:
            accel_data = mpu.get_accel()
            gyro_data = mpu.get_gyro()
            store.update(
                accel_x=accel_data['x'],
                accel_y=accel_data['y'],
                accel_z=accel_data['z'],
                gyro_x=gyro_data['x'],
                gyro_y=gyro_data['y'],
                gyro_z=gyro_data['z']
            )
        except Exception as e:
            pass # Ignore occasional I2C read errors
            
        await asyncio.sleep_ms(20) # Read at 50Hz

async def main():
    print("--- Booting Gestura Gauntlet OS ---")
    
    try:
        i2c = hardware_check()
        ip = connect_wifi(WIFI_SSID, WIFI_PASS)
        
        # Initialize the hardware
        mpu = MPU6050(i2c)
        global global_gui
        state_store = StateStore()
        global_gui = GauntletGUI(i2c, state_store)
        
    except Exception as e:
        trigger_hardware_panic(str(e))

    global_gui.update_state(connected=True, mode="PASSIVE")
    global_gui.render()
    time.sleep(1)

    print("Starting Parallel Tasks...")
    await asyncio.gather(
        global_gui.display_task(),
        sensor_task(global_gui, mpu, state_store),
        network_task(global_gui, state_store)
    )

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("System halted manually.")
