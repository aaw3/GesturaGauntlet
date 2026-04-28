import uasyncio as asyncio

from modules.navigation import AppState, NavigationController
from modules.renderer import SSD1306Renderer
from modules.status import StatusState


class GauntletGUI:
    """Compatibility wrapper for older tests; runtime UI uses renderer/app directly."""

    def __init__(self, i2c, state_store=None, width=128, height=64):
        self.status = StatusState()
        self.state = AppState(self.status)
        self.navigation = NavigationController(self.state)
        self.renderer = SSD1306Renderer(i2c, width, height)
        self._store = state_store

    def update_state(self, **kwargs):
        if self._store:
            self._store.update(**kwargs)
        if "mode" in kwargs:
            self.state.mode = str(kwargs["mode"]).upper()
        if "connected" in kwargs:
            self.status.connected = bool(kwargs["connected"])
        if "action" in kwargs:
            self.state.message = str(kwargs["action"])
        self.state.mark_dirty()

    def render(self):
        self.renderer.render_if_dirty(self.state)

    async def display_task(self):
        while True:
            self.render()
            await asyncio.sleep_ms(100)
