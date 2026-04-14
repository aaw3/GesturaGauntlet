import machine
import uasyncio as asyncio
import time

class GauntletButton:
    def __init__(self, pin_num=13):
        # We use PULL_UP, meaning the pin reads 1 normally, and 0 when pressed.
        self.button = machine.Pin(pin_num, machine.Pin.IN, machine.Pin.PULL_UP)

    async def monitor(self, gui, mqtt_client):
        print("--- Button Monitor Started ---")
        
        while True:
            try:
                # 1. Detect if the button is pressed down
                if self.button.value() == 0: 
                    # Record the exact millisecond the press started
                    press_start = time.ticks_ms()
                    
                    # 2. Wait in this loop until the user lets go of the button
                    while self.button.value() == 0:
                        await asyncio.sleep_ms(20)
                    
                    # 3. Calculate exactly how many milliseconds they held it
                    duration = time.ticks_diff(time.ticks_ms(), press_start)
                    
                    # --- HOLD FOR 1 SECOND: RECALIBRATE ---
                    # 1000 milliseconds = 1 second
                    if duration >= 1000:
                        print(">>> 1-SECOND HOLD: RESETTING TO ZERO <<<")
                        
                        # Step A: Tell the system to run the calibration mathematical offsets
                        gui.update_state(action="Calibrating...", calibrate_req=True)
                        
                        # Step B: Wait exactly 3 seconds, as you requested
                        # This freezes the button from doing anything else for 3 seconds
                        print("Waiting 3 seconds...")
                        await asyncio.sleep_ms(3000)
                        
                        # Step C: Go back to normal passive senses
                        print("Resuming main passive senses.")
                        gui.update_state(action="Passive Sensing")
                        
                    # --- SHORT PRESS (Less than 1 second) ---
                    # 50 milliseconds is our "debounce" to ignore electrical static
                    elif duration > 50: 
                        print(">>> SINGLE SHORT PRESS DETECTED <<<")
                        gui.update_state(action="Action Sent")
                        
                        # If we have an active network connection, send the MQTT command
                        if mqtt_client:
                            mqtt_client.publish(b"gauntlet/action", b"single_press")
                            
            except Exception as e:
                print(f"Button Action Failed: {e}")
                
            # A small 50ms pause at the end of the loop so we don't hog the Pico's processor
            await asyncio.sleep_ms(50)