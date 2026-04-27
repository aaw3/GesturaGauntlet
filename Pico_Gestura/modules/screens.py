from modules.device_models import adjust_value, display_value


class ListScreen:
    kind = "list"

    def __init__(self, title, items=None):
        self.title = title
        self.items = items or []
        self.selected_index = 0
        self.scroll_offset = 0

    def selected_item(self):
        if not self.items:
            return None
        self.selected_index = max(0, min(self.selected_index, len(self.items) - 1))
        return self.items[self.selected_index]

    def move(self, delta=1, visible_rows=4):
        if not self.items:
            return False
        old_index = self.selected_index
        self.selected_index = (self.selected_index + delta) % len(self.items)
        self._keep_visible(visible_rows)
        return old_index != self.selected_index

    def _keep_visible(self, visible_rows):
        if self.selected_index < self.scroll_offset:
            self.scroll_offset = self.selected_index
        bottom = self.scroll_offset + visible_rows - 1
        if self.selected_index > bottom:
            self.scroll_offset = self.selected_index - visible_rows + 1


class DeviceDetailScreen:
    kind = "device"

    def __init__(self, device):
        self.device = device
        self.action_index = 0
        self.values = {}
        for capability in device.capabilities:
            self.values[capability.id] = capability.value

    def selected_action(self):
        return self.device.action_at(self.action_index)

    def cycle_action(self):
        if not self.device.capabilities:
            return False
        self.action_index = (self.action_index + 1) % len(self.device.capabilities)
        return True

    def current_value(self):
        action = self.selected_action()
        if action is None:
            return None
        return self.values.get(action.id, action.value)

    def value_label(self):
        return display_value(self.selected_action(), self.current_value())

    def adjust_current(self, direction=1):
        action = self.selected_action()
        if action is None:
            return False
        old = self.current_value()
        self.values[action.id] = adjust_value(action, old, direction)
        return old != self.values[action.id]

    def toggle_current_local(self):
        action = self.selected_action()
        if action is None or action.kind != "boolean":
            return False
        self.values[action.id] = not bool(self.current_value())
        return True


class StatusScreen:
    kind = "status"

    def __init__(self):
        self.title = "Status"
        self.selected_index = 0
        self.scroll_offset = 0

    def move(self, delta=1, visible_rows=5):
        old = self.selected_index
        self.selected_index = max(0, self.selected_index + delta)
        if self.selected_index < self.scroll_offset:
            self.scroll_offset = self.selected_index
        if self.selected_index >= self.scroll_offset + visible_rows:
            self.scroll_offset = self.selected_index - visible_rows + 1
        return old != self.selected_index
