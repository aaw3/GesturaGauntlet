import machine
import uasyncio as asyncio
import time

class GauntletButton:
    def __init__(self, pin_num=13):
        # We use PULL_UP, meaning the pin reads 1 normally, and 0 when pressed.
        self.button = machine.Pin(pin_num, machine.Pin.IN, machine.Pin.PULL_UP)

    async def monitor(self, gui, mqtt_client):
        print("--- Button Monitor Started (GP13) ---")
        debug_counter = 0
        
        while True:
            try:
                val = self.button.value()
                
                # --- HIGH FREQUENCY DEBUG PRINT ---
                # This prints every ~200ms so you can see the real-time state
                debug_counter += 1
                if debug_counter >= 4: 
                    status = "LOW (PRESSED)" if val == 0 else "HIGH (OPEN)"
                    print(f"DEBUG: PIN 13 IS {status}")
                    debug_counter = 0

                # 1. Detect if the button is pressed down (0 = Pressed for PULL_UP)
                if val == 0: 
                    print(">>> PHYSICAL BUTTON PRESS DETECTED! <<<")
                    gui.update_state(action="BUTTON PRESSED")
                    press_start = time.ticks_ms()
                    
                    # 2. Wait in this loop until the user lets go of the button
                    while self.button.value() == 0:
                        await asyncio.sleep_ms(20)
                    
                    # 3. Calculate exactly how many milliseconds they held it
                    duration = time.ticks_diff(time.ticks_ms(), press_start)
                    print(f"Button Released. Duration: {duration}ms")
                    
                    # --- HOLD FOR 1 SECOND: RECALIBRATE ---
                    if duration >= 1000:
                        print(">>> TRIGGERING RECALIBRATION <<<")
                        gui.update_state(action="CALIBRATING...", calibrate_req=True)
                        # The sensor_task in main.py will handle the actual MPU call
                        await asyncio.sleep_ms(3000)
                        gui.update_state(action="CALIBRATED!")
                        await asyncio.sleep_ms(1000)
                        gui.update_state(action="PASSIVE MODE")
                        
                    # --- SHORT PRESS ---
                    elif duration > 50: 
                        print(">>> SHORT PRESS ACTION <<<")
                        gui.update_state(action="ACTION SENT")
                        if mqtt_client:
                            mqtt_client.publish(b"gauntlet/action", b"single_press")
                            
            except Exception as e:
                print(f"Button Action Failed: {e}")
                
            # A small 50ms pause at the end of the loop so we don't hog the Pico's processor
            await asyncio.sleep_ms(50)