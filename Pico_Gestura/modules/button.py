import machine
import uasyncio as asyncio
import time

class GauntletButton:
    def __init__(self, pin_num, name="Button"):
        self.pin_num = pin_num
        self.name = name
        # We use PULL_UP, meaning the pin reads 1 normally, and 0 when pressed.
        self.button = machine.Pin(pin_num, machine.Pin.IN, machine.Pin.PULL_UP)

    async def monitor(self, gui, store):
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
                            
                            transport_client = store.get("transport")
                            if transport_client:
                                try:
                                    transport_client.send_json({
                                        "type": "mode_set",
                                        "mode": new_mode.lower(),
                                        "button": self.name.lower().replace(" ", "_"),
                                    })
                                except Exception as e:
                                    print(f"Failed to send mode change: {e}")
                        
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
                                if store.get("mode") == "ACTIVE":
                                    store.enqueue_input(
                                        "bottom_tap",
                                        1,
                                        button=self.name.lower().replace(" ", "_"),
                                        duration_ms=duration,
                                    )
                                transport_client = store.get("transport")
                                if transport_client and store.get("mode") != "ACTIVE":
                                    try:
                                        transport_client.send_json({
                                            "type": "button_action",
                                            "action": "single_press",
                                            "button": self.name.lower().replace(" ", "_"),
                                        })
                                    except Exception as e:
                                        print(f"Failed to send button action: {e}")
                        
                        last_release_time = release_time
                            
            except Exception as e:
                print(f"Button ({self.name}) Error: {e}")
                
            await asyncio.sleep_ms(50)
