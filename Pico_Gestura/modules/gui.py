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
        conn_text = "WIFI: OK" if state["connected"] else "WIFI: X"
        self.oled.text(conn_text, 0, 0)
        
        mode = state["mode"].upper()
        self.oled.text(f"MODE: {mode}", 0, 16)
        
        # Action/Status
        action = state.get("action", "")
        if action:
            self.oled.text(action, 0, 32)
        
        # Calibration Status
        if state.get("calibrate_req"):
            self.oled.text("CALIBRATING...", 0, 48)
        else:
            # Center Content (Conditional based on mode)
            if mode == "PASSIVE":
                self.oled.text(f"X: {state['accel_x']:.2f} Y: {state['accel_y']:.2f}", 0, 48)
                self.oled.text(f"Z: {state['accel_z']:.2f}", 0, 56)
            elif mode == "ACTIVE":
                self.oled.text(">>> ACTIVE <<<", 16, 48)
            
        self.oled.show()

    async def display_task(self):
        """Runs continuously to refresh the screen."""
        while True:
            self.render()
            await asyncio.sleep_ms(100) # 10 FPS
