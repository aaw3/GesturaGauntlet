from modules.device_models import build_action, group_devices_by_manager
from modules.debug import DebugPrinter
from modules.screens import DeviceDetailScreen, ListScreen, StatusScreen


class AppState:
    def __init__(self, status):
        self.current_screen = None
        self.screen_stack = []
        self.managers = []
        self.devices = []
        self.mappings = []
        self.status = status
        self.mode = "PASSIVE"
        self.dirty = True
        self.pending_actions = []
        self.message = "Booting"
        self.selected_manager_id = None
        self.selected_device_id = None
        self.selected_action_index = 0
        self.wifi_manager = None
        self.wifi_reconnect_requested = False

    def mark_dirty(self):
        self.dirty = True


class NavigationController:
    def __init__(self, state, debug_config=None):
        self.state = state
        self.fsr_debug = DebugPrinter(debug_config, "fsr")
        self.show_main()

    def update_inventory(self, managers, devices, mappings):
        self.state.managers = managers
        self.state.devices = devices
        self.state.mappings = mappings or []
        self.state.status.update(
            manager_count=len(managers),
            device_count=len(devices),
            mapping_count=len(mappings or []),
        )
        self.refresh_current_screen()
        self.state.mark_dirty()

    def handle_events(self, events):
        changed = False
        for event in events:
            screen = self.state.current_screen
            screen_kind = screen.kind if screen else "none"
            action = describe_event_action(event.get("type"), screen_kind)
            event_changed = self.handle_event(event)
            self._debug_event(event, screen_kind, action, event_changed)
            changed = event_changed or changed
        if changed:
            self.state.mark_dirty()
        return changed

    def handle_event(self, event):
        name = event.get("type")
        screen = self.state.current_screen

        if name == "top_double":
            return self.back()

        if screen is None:
            self.show_main()
            return True

        if screen.kind == "list":
            if name == "top_click":
                return screen.move(1, visible_rows=VISIBLE_LIST_ROWS)
            if name == "bottom_hold":
                return screen.move(1, visible_rows=VISIBLE_LIST_ROWS)
            if name == "bottom_click":
                return self.enter_selected()
            return False

        if screen.kind == "status":
            if name in ("top_click", "bottom_hold"):
                rows = self.state.status.full_rows()
                if not rows:
                    return False
                screen.move(1, visible_rows=VISIBLE_STATUS_ROWS)
                if screen.selected_index >= len(rows):
                    screen.selected_index = 0
                    screen.scroll_offset = 0
                return True
            return False

        if screen.kind == "device":
            if name in ("top_click", "top_hold"):
                changed = screen.cycle_action()
                self.state.selected_action_index = screen.action_index
                return changed
            if name == "bottom_hold":
                return screen.adjust_current(1)
            if name == "bottom_click":
                return self.apply_device_action(screen)
        return False

    def _debug_event(self, event, screen_kind, action, changed):
        if not self.fsr_debug.enabled():
            return
        print(
            "[DEBUG][fsr] event={} source={} screen={} action={} changed={}".format(
                event.get("type", "?"),
                event.get("source", "?"),
                screen_kind,
                action,
                changed,
            )
        )

    def enter_selected(self):
        item = self.state.current_screen.selected_item()
        if not item:
            self.state.message = "Nothing here"
            return True
        kind = item.get("kind")
        if kind == "main_devices":
            return self.push_manager_list()
        if kind == "main_status":
            return self.push(StatusScreen())
        if kind == "main_wifi":
            return self.push_wifi_list()
        if kind == "main_diag":
            return self.push_info_list("Diagnostics", self.diagnostic_items())
        if kind == "main_stats":
            return self.push_info_list("Stats", self.stat_items())
        if kind == "manager":
            return self.push_device_list(item.get("managerId"))
        if kind == "device":
            return self.push_device_detail(item.get("deviceId"))
        if kind == "wifi":
            return self.select_wifi(item.get("ssid"))
        if kind == "wifi_auto":
            return self.select_wifi_auto()
        return False

    def apply_device_action(self, screen):
        action = screen.selected_action()
        if action is None:
            self.state.message = "No actions"
            return True
        if action.kind == "boolean":
            screen.toggle_current_local()
        self.state.pending_actions.append(build_action(screen.device, action, screen.current_value()))
        self.state.message = "Action queued"
        return True

    def pop_pending_actions(self):
        pending = self.state.pending_actions
        self.state.pending_actions = []
        return pending

    def back(self):
        if not self.state.screen_stack:
            self.show_main()
            return True
        self.state.current_screen = self.state.screen_stack.pop()
        return True

    def push(self, screen):
        if self.state.current_screen:
            self.state.screen_stack.append(self.state.current_screen)
        self.state.current_screen = screen
        return True

    def show_main(self):
        self.state.screen_stack = []
        self.state.current_screen = ListScreen("Main", [
            {"label": "Devices", "kind": "main_devices"},
            {"label": "Status", "kind": "main_status"},
            {"label": "WiFi", "kind": "main_wifi"},
            {"label": "Diagnostics", "kind": "main_diag"},
            {"label": "Stats", "kind": "main_stats"},
        ])
        self.state.mark_dirty()

    def push_manager_list(self):
        if not self.state.managers:
            self.state.message = "No managers"
            return self.push_info_list("Devices", [{"label": "No managers", "kind": "info"}])
        items = []
        grouped = group_devices_by_manager(self.state.devices)
        for manager in self.state.managers:
            count = len(grouped.get(manager.id, []))
            items.append({
                "label": "{} ({})".format(manager.name, count),
                "kind": "manager",
                "managerId": manager.id,
            })
        return self.push(ListScreen("Managers", items))

    def push_device_list(self, manager_id):
        self.state.selected_manager_id = manager_id
        devices = [device for device in self.state.devices if device.manager_id == manager_id]
        if not devices:
            return self.push_info_list("Devices", [{"label": "No devices", "kind": "info"}])
        items = [{"label": device.name, "kind": "device", "deviceId": device.id} for device in devices]
        return self.push(ListScreen("Devices", items))

    def push_device_detail(self, device_id):
        for device in self.state.devices:
            if device.id == device_id:
                self.state.selected_device_id = device.id
                return self.push(DeviceDetailScreen(device))
        self.state.message = "Device missing"
        return True

    def push_info_list(self, title, rows):
        return self.push(ListScreen(title, rows))

    def push_wifi_list(self):
        manager = self.state.wifi_manager
        if not manager:
            return self.push_info_list("WiFi", [{"label": "No WiFi manager", "kind": "info"}])
        manager.scan()
        items = manager.listed_networks()
        if not items:
            items = [{"label": "Auto strongest", "kind": "wifi_auto"}, {"label": "No profiles", "kind": "info"}]
        else:
            items = [{"label": "Auto strongest", "kind": "wifi_auto"}] + [
                {
                    "label": "{} {}".format(item.get("label"), item.get("rssi", "")),
                    "kind": "wifi",
                    "ssid": item.get("ssid"),
                }
                for item in items
            ]
        return self.push(ListScreen("WiFi", items))

    def select_wifi(self, ssid):
        manager = self.state.wifi_manager
        if not manager or not ssid:
            return False
        manager.set_override(ssid)
        self.state.wifi_reconnect_requested = True
        self.state.message = "WiFi override"
        self.state.status.update(wifi_ssid=ssid, wifi_connected=False, connected=False, ws_connected=False, route="OFFLINE")
        return True

    def select_wifi_auto(self):
        manager = self.state.wifi_manager
        if not manager:
            return False
        manager.clear_override()
        self.state.wifi_reconnect_requested = True
        self.state.message = "WiFi auto"
        self.state.status.update(wifi_connected=False, connected=False, ws_connected=False, route="OFFLINE")
        return True

    def refresh_current_screen(self):
        screen = self.state.current_screen
        if not screen:
            return
        if screen.kind == "list" and screen.title == "Managers":
            self.state.current_screen = ListScreen("Managers", [
                {"label": manager.name, "kind": "manager", "managerId": manager.id}
                for manager in self.state.managers
            ])

    def wifi_items(self):
        status = self.state.status
        return [
            {"label": "SSID {}".format(status.wifi_ssid), "kind": "info"},
            {"label": "Route {}".format(status.route), "kind": "info"},
            {"label": "RTT {}ms".format(status.rtt_ms), "kind": "info"},
            {"label": "Cloud {}".format("OK" if status.connected else "OFF"), "kind": "info"},
        ]

    def diagnostic_items(self):
        status = self.state.status
        if status.last_error:
            error = status.last_error
        elif not status.connected:
            error = "No connection"
        elif not self.state.mappings:
            error = "No mappings"
        else:
            error = "OK"
        return [
            {"label": "Conn {}".format("OK" if status.connected else "OFF"), "kind": "info"},
            {"label": "Edge {}".format("OK" if "EDGE" in status.route else "UNAVAIL"), "kind": "info"},
            {"label": "Cloud {}".format("OK" if status.route == "CLOUD" else "UNAVAIL"), "kind": "info"},
            {"label": "Maps {}".format(len(self.state.mappings) if self.state.mappings else "NONE"), "kind": "info"},
            {"label": "Err {}".format(error), "kind": "info"},
        ]

    def stat_items(self):
        return [
            {"label": "Managers {}".format(len(self.state.managers)), "kind": "info"},
            {"label": "Devices {}".format(len(self.state.devices)), "kind": "info"},
            {"label": "Mappings {}".format(len(self.state.mappings)), "kind": "info"},
            {"label": "Mode {}".format(self.state.mode), "kind": "info"},
        ]


VISIBLE_LIST_ROWS = 3
VISIBLE_STATUS_ROWS = 4


def describe_event_action(event_type, screen_kind):
    if event_type == "top_double":
        return "back"
    if screen_kind == "list":
        if event_type == "top_click":
            return "next_menu_item"
        if event_type == "bottom_hold":
            return "scroll_next_menu_item"
        if event_type == "bottom_click":
            return "enter_selected_menu_item"
        if event_type == "bottom_double":
            return "ignored_click_already_sent"
    if screen_kind == "status":
        if event_type in ("top_click", "bottom_hold"):
            return "scroll_status_rows"
    if screen_kind == "device":
        if event_type == "top_click":
            return "next_device_action"
        if event_type == "top_hold":
            return "cycle_device_action"
        if event_type == "bottom_hold":
            return "adjust_selected_action_value"
        if event_type == "bottom_click":
            return "queue_selected_action"
        if event_type == "bottom_double":
            return "ignored_click_already_sent"
    return "ignored"
