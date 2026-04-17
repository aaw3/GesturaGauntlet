import machine
import uasyncio as asyncio
from modules import ssd1306

class GauntletGUI:
    def __init__(self, i2c, state_store, width=128, height=64):
        self.width = width
        self.height = height
        self.oled = ssd1306.SSD1306_I2C(self.width, self.height, i2c)
        self._store = state_store
        
    def update_state(self, **kwargs):
        self._store.update(**kwargs)

    def render(self):
        state = self._store.snapshot()
        self.oled.fill(0) 
        
        # Top Status Bar        
        mode = state["mode"].upper()
        self.oled.text(f"MODE: {mode}", 0, 0)
        
        # -----------------------------------------
        # ACTION CENTER (Rows 25-40)
        # This is where CALIBRATING and READY appear
        # -----------------------------------------
        action_text = state.get("action", "").upper()
        if action_text:
            # Draw a simple box or just center it
            self.oled.text(">> " + action_text, 0, 25)

        # -----------------------------------------
        # SENSOR DATA (Bottom)
        # -----------------------------------------
        if mode == "PASSIVE":
            # Show smaller coordinates at the bottom
            self.oled.text(f"X:{state['accel_x']:>5.2f} Y:{state['accel_y']:>5.2f}", 0, 45)
            self.oled.text(f"Z:{state['accel_z']:>5.2f}", 0, 55)
        elif mode == "ACTIVE":
            self.oled.text("GAUNTLET ACTIVE", 0, 50)
            
        self.oled.show()

    async def display_task(self):
        """Runs continuously to refresh the screen."""
        while True:
            self.render()
            await asyncio.sleep_ms(100) # 10 FPS
