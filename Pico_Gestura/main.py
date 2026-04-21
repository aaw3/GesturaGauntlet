import machine
import uasyncio as asyncio
import time
import ujson
from lib.umqtt.simple import MQTTClient
from lib.env import load_env, _parse_mqtt_server
from system_init import hardware_check, connect_wifi
from modules.gui import GauntletGUI
from modules.mpu6050 import MPU6050
from modules.button import GauntletButton
from modules.datastore import StateStore
from modules.fsr import FSR
 
# Load env vars
env = load_env()

# --- CONFIGURATION ---
WIFI_SSID = env.get("WIFI_SSID")
WIFI_PASS = env.get("WIFI_PASS")

print("SSID:", repr(WIFI_SSID))

MQTT_SERVER = env.get("MQTT_SERVER", "")
CLIENT_ID = "GesturaPico"
 
led = machine.Pin("LED", machine.Pin.OUT)
 
def trigger_hardware_panic(error_code):
    print(f"FATAL ERROR: {error_code}")
    while True:
        led.toggle()
        time.sleep(0.1)
 
 
MQTT_HOST, MQTT_PORT = _parse_mqtt_server(MQTT_SERVER)
print(f"MQTT target: {MQTT_HOST}:{MQTT_PORT}")
 
# Global MQTT Client
mqtt_client = MQTTClient(CLIENT_ID, MQTT_HOST, port=MQTT_PORT, keepalive=60)
 
def mqtt_callback(topic, msg):
    """Fires instantly when the Node server sends a mode change."""
    if topic == b'gauntlet/mode':
        new_mode = msg.decode('utf-8').upper()
        global_gui.update_state(mode=new_mode)
        print(f"Mode instantly changed to: {new_mode}")
 
async def network_task(gui, store):
    """Maintains the MQTT connection and publishes data."""
    mqtt_client.set_callback(mqtt_callback)

    reconnect_delay_ms = 500
    max_delay_ms = 5000

    while True:
        try:
            mqtt_client.connect()
            mqtt_client.subscribe(b"gauntlet/mode")
            gui.update_state(connected=True)
            print("Connected to MQTT Broker!")
            reconnect_delay_ms = 500
        except Exception as e:
            print("MQTT Connection Failed:", e)
            gui.update_state(connected=False)
            await asyncio.sleep_ms(reconnect_delay_ms)
            reconnect_delay_ms = min(max_delay_ms, reconnect_delay_ms * 2)
            continue

        while True:
            try:
                # Check for incoming mode changes from the dashboard
                mqtt_client.check_msg()

                # Publish live sensor data in both passive and active modes.
                # The backend decides how to use it for dashboard telemetry,
                # focus scoring, and Kasa light control.
                state = store.snapshot()
                payload = ujson.dumps({
<<<<<<< HEAD
=======
                    "mode": state.get("mode", "UNKNOWN"),
>>>>>>> kasa_backend
                    "x": state.get("accel_x", 0.0),
                    "y": state.get("accel_y", 0.0),
                    "z": state.get("accel_z", 0.0),
                    "gx": state.get("gyro_x", 0.0),
                    "gy": state.get("gyro_y", 0.0),
<<<<<<< HEAD
                    "gz": state.get("gyro_z", 0.0),
                    "pressure": state.get("pressure", 0.0)
=======
                    "gz": state.get("gyro_z", 0.0)
>>>>>>> kasa_backend
                }).encode("utf-8")
                mqtt_client.publish(b"gauntlet/sensors", payload)

            except Exception as e:
                print("MQTT Error:", e)
                gui.update_state(connected=False)
                try:
                    mqtt_client.disconnect()
                except Exception:
                    pass
                break

            # Yield control. 20ms = 50Hz publish rate for buttery smooth UI tracking
            await asyncio.sleep_ms(20)
 
async def sensor_task(gui, mpu, fsr, store):
    """Constantly reads the physical I2C motion sensor and FSR."""
    
    # Track the last time we printed to the terminal
    last_print_time = time.ticks_ms()

    while True:
        try:
            # Check for calibration request
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
            
            # Update FSR state and events
            fsr.tick()
            pressure = fsr.get_pressure_percentage()
            
            # Apply runtime re-zeroing for gyro (alpha=0.999 for slower drift)
            mpu.runtime_re_zero(gyro_data['x'], gyro_data['y'], gyro_data['z'], alpha=0.999)

            store.update(
                accel_x=accel_data['x'],
                accel_y=accel_data['y'],
                accel_z=accel_data['z'],
                gyro_x=gyro_data['x'],
                gyro_y=gyro_data['y'],
                gyro_z=gyro_data['z'],
                pressure=pressure
            )
            
            current_time = time.ticks_ms()
            if time.ticks_diff(current_time, last_print_time) >= 500:
                raw_v = fsr.read_voltage()
                smoothed_v = fsr.current_v_smoothed
                state = fsr.get_state()
                
                # Debug info: Raw V, Smoothed V (used for logic), State, and %
                # Threshold for STATE_FULL (2) is approx 0.340V
                print(f"FSR -> Raw:{raw_v:.3f}V Smoothed:{smoothed_v:.3f}V STATE:{state} P:{pressure:.1f}%")

                last_print_time = current_time

        except Exception as e:
            print(f"Sensor Task Error: {e}")
            
        await asyncio.sleep_ms(20) # Read at 50Hz
 
async def main():
    print("--- Booting Gestura Gauntlet OS ---")
    
    try:
        i2c, devices = hardware_check()
        ip = connect_wifi(WIFI_SSID, WIFI_PASS)
        
        # Initialize the hardware
        mpu_addr = 0x68 if 0x68 in devices else 0x69 if 0x69 in devices else None
        if mpu_addr is None:
            raise Exception("MPU6050 not found on I2C (expected 0x68 or 0x69). Check wiring/AD0.")
        mpu = MPU6050(i2c, addr=mpu_addr)
        
        # Initialize FSR on GP26
        fsr = FSR(26)

        global global_gui
        state_store = StateStore()
        global_gui = GauntletGUI(i2c, state_store)

        # --- FSR Event Handlers ---
        def on_fsr_double_press():
            current_mode = state_store.get("mode")
            new_mode = "ACTIVE" if current_mode == "PASSIVE" else "PASSIVE"
            global_gui.update_state(mode=new_mode)
            print(f"!!! FSR DOUBLE PRESS: Toggling mode to {new_mode} !!!")
            if mqtt_client:
                try:
                    mqtt_client.publish(b"gauntlet/mode", new_mode.encode())
                except Exception as e:
                    print(f"MQTT FSR Publish Error: {e}")

        fsr.subscribe(FSR.EVENT_HARD_DOUBLE_PRESS, on_fsr_double_press)
        
    except Exception as e:
        trigger_hardware_panic(str(e))
 
    global_gui.update_state(connected=True, mode="PASSIVE", action="Boot Calibrate")
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
        action_button.monitor(global_gui, mqtt_client, state_store),
        mode_button.monitor(global_gui, mqtt_client, state_store)
    )
 
if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("System halted manually.")
