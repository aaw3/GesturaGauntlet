import time
from modules import ssd1306
from modules.device_models import display_value


class SSD1306Renderer:
    def __init__(self, i2c, width=128, height=64):
        self.width = width
        self.height = height
        self.oled = ssd1306.SSD1306_I2C(width, height, i2c)
        self.last_scroll_ms = time.ticks_ms()
        self.scroll_offset = 0

    def render_if_dirty(self, state):
        if state.status.rotate_if_due():
            state.mark_dirty()
        if self._scroll_if_due(state):
            state.mark_dirty()
        if not state.dirty:
            return
        self.render(state)
        state.dirty = False

    def render(self, state):
        self.oled.fill(0)
        screen = state.current_screen
        if screen and screen.kind != "status":
            self._status_row(state)
            y = 12
        else:
            y = 0

        if screen is None:
            self.oled.text("No screen", 0, y)
        elif screen.kind == "list":
            self._list_screen(screen, y)
        elif screen.kind == "device":
            self._device_screen(screen, y)
        elif screen.kind == "status":
            self._status_screen(state, y)
        else:
            self.oled.text("Unknown", 0, y)

        if state.message:
            self.oled.text(truncate(state.message, 16), 0, 56)
        self.oled.show()

    def _status_row(self, state):
        self.oled.text(truncate(state.status.status_label(), 16), 0, 0)
        self.oled.hline(0, 10, self.width, 1)

    def _list_screen(self, screen, y):
        self.oled.text(truncate(screen.title, 16), 0, y)
        visible = 4
        start = screen.scroll_offset
        for row in range(visible):
            index = start + row
            if index >= len(screen.items):
                break
            item = screen.items[index]
            marker = ">" if index == screen.selected_index else " "
            label = item.get("label", "")
            self.oled.text(marker + scroll_or_truncate(label, 14, self.scroll_offset), 0, y + 12 + (row * 10))
        if not screen.items:
            self.oled.text("No items", 0, y + 14)

    def _device_screen(self, screen, y):
        device = screen.device
        action = screen.selected_action()
        self.oled.text(truncate(device.name, 16), 0, y)
        if action is None:
            self.oled.text("No actions", 0, y + 14)
            return
        value = screen.current_value()
        self.oled.text("Act {}".format(truncate(action.label, 11)), 0, y + 12)
        self.oled.text("Val {}".format(truncate(display_value(action, value), 11)), 0, y + 24)
        if action.kind in ("range", "color"):
            self._progress_bar(0, y + 40, 92, 8, value, action.min(), action.max())
            self.oled.text(truncate(action.unit(), 4), 98, y + 39)
        elif action.kind == "boolean":
            self.oled.text("Bottom toggles", 0, y + 40)
        elif action.kind == "enum":
            self.oled.text("Hold cycles", 0, y + 40)
        else:
            self.oled.text("Bottom runs", 0, y + 40)

    def _status_screen(self, state, y):
        self.oled.text("Status", 0, y)
        rows = state.status.full_rows()
        start = state.current_screen.scroll_offset
        for row in range(5):
            index = start + row
            if index >= len(rows):
                break
            label, value = rows[index]
            text = "{} {}".format(label, value)
            self.oled.text(scroll_or_truncate(text, 16, self.scroll_offset), 0, y + 12 + (row * 10))

    def _progress_bar(self, x, y, width, height, value, minimum, maximum):
        self.oled.rect(x, y, width, height, 1)
        span = maximum - minimum
        if span <= 0:
            fill = 0
        else:
            fill = int((float(value) - minimum) * (width - 2) / span)
        fill = max(0, min(width - 2, fill))
        if fill > 0:
            self.oled.fill_rect(x + 1, y + 1, fill, height - 2, 1)

    def _scroll_if_due(self, state):
        now = time.ticks_ms()
        if time.ticks_diff(now, self.last_scroll_ms) < 350:
            return False
        self.last_scroll_ms = now
        self.scroll_offset = (self.scroll_offset + 1) % 24
        screen = state.current_screen
        return bool(screen and has_long_text(screen, state))


def has_long_text(screen, state):
    if screen.kind == "list":
        return any(len(str(item.get("label", ""))) > 14 for item in screen.items)
    if screen.kind == "device":
        return len(screen.device.name) > 16
    if screen.kind == "status":
        return any(len("{} {}".format(label, value)) > 16 for label, value in state.status.full_rows())
    return False


def truncate(text, max_chars):
    text = str(text or "")
    if len(text) <= max_chars:
        return text
    return text[:max_chars]


def scroll_or_truncate(text, max_chars, offset):
    text = str(text or "")
    if len(text) <= max_chars:
        return text
    padded = text + "   "
    start = offset % len(padded)
    doubled = padded + padded
    return doubled[start:start + max_chars]
