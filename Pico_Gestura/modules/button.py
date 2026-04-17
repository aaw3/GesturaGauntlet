import machine
import uasyncio as asyncio
import time

class GauntletButton:
    def __init__(self, pin_num, name="Button"):
        self.pin_num = pin_num
        self.name = name
        # We use PULL_UP, meaning the pin reads 1 normally, and 0 when pressed.
        self.button = machine.Pin(pin_num, machine.Pin.IN, machine.Pin.PULL_UP)

    async def monitor(self, gui, mqtt_client, store):
        print(f"--- Button Monitor Started ({self.name} on GP{self.pin_num}) ---")
        
        last_release_time = 0
        
        while True:
            try:
                val = self.button.value()
            
                # 1. Detect if the button is pressed down (0 = Pressed for PULL_UP)
                if val == 0: 
                    press_start = time.ticks_ms()
                    
                    # 2. Wait in this loop until the user lets go of the button
                    while self.button.value() == 0:
                        await asyncio.sleep_ms(20)
                    
                    release_time = time.ticks_ms()
                    # 3. Calculate exactly how many milliseconds they held it
                    duration = time.ticks_diff(release_time, press_start)
                    
                    # Check for double tap
                    # If the time between this press and the last release is short
                    time_since_last = time.ticks_diff(press_start, last_release_time)
                    
                    if 50 < time_since_last < 400:
                        # DOUBLE TAP DETECTED
                        print(f">>> {self.name} DOUBLE TAP <<<")
                        if self.pin_num == 12:
                            # Toggle Mode
                            current_mode = store.get("mode")
                            new_mode = "ACTIVE" if current_mode == "PASSIVE" else "PASSIVE"
                            gui.update_state(mode=new_mode)
                            print(f"Mode toggled via button to: {new_mode}")
                            
                            if mqtt_client:
                                try:
                                    mqtt_client.publish(b"gauntlet/mode", new_mode.encode())
                                except Exception as e:
                                    print(f"Failed to publish mode change: {e}")
                        
                        # Reset last_release_time to prevent triple-tap being two double-taps
                        last_release_time = 0
                    else:
                        # Handle Single Press or Hold
                        if duration >= 1000:
                            # HOLD ACTION
                            if self.pin_num == 13:
                                print(">>> TRIGGERING RECALIBRATION <<<")
                                gui.update_state(action="CALIBRATING...", calibrate_req=True)
                                # sensor_task handles the actual calibration logic via store
                        elif duration > 50:
                            # SINGLE PRESS ACTION
                            if self.pin_num == 13:
                                print(">>> ACTION BUTTON SHORT PRESS <<<")
                                gui.update_state(action="ACTION SENT")
                                if mqtt_client:
                                    try:
                                        mqtt_client.publish(b"gauntlet/action", b"single_press")
                                    except:
                                        pass
                        
                        last_release_time = release_time
                            
            except Exception as e:
                print(f"Button ({self.name}) Error: {e}")
                
            await asyncio.sleep_ms(50)
