def normalize_managers(managers):
    return [Manager(item) for item in managers or []]


def normalize_devices(devices):
    return [Device(item) for item in devices or []]


def group_devices_by_manager(devices):
    grouped = {}
    for device in devices:
        grouped.setdefault(device.manager_id, []).append(device)
    return grouped


class Manager:
    def __init__(self, data):
        self.raw = data or {}
        metadata = self.raw.get("metadata") or {}
        self.id = self.raw.get("id") or self.raw.get("managerId") or "manager"
        self.name = metadata.get("name") or self.raw.get("name") or self.id
        self.kind = self.raw.get("kind") or "manager"
        self.online = self.raw.get("online", True)


class Device:
    def __init__(self, data):
        self.raw = data or {}
        self.id = self.raw.get("id") or self.raw.get("deviceId") or "device"
        self.name = self.raw.get("name") or self.id
        self.manager_id = self.raw.get("managerId") or (self.raw.get("provenance") or {}).get("managerId") or "unknown"
        self.online = self.raw.get("online", "unknown")
        self.capabilities = [Capability(item) for item in self.raw.get("capabilities", [])]

    def action_count(self):
        return len(self.capabilities)

    def action_at(self, index):
        if not self.capabilities:
            return None
        return self.capabilities[index % len(self.capabilities)]


class Capability:
    def __init__(self, data):
        self.raw = data or {}
        self.id = self.raw.get("id") or "action"
        self.label = self.raw.get("label") or self.id
        self.kind = normalize_kind(self.raw.get("kind") or self.raw.get("type"))
        self.range = self.raw.get("range") or {}
        self.options = self.raw.get("options") or self.raw.get("values") or []
        self.value = default_value(self)

    def min(self):
        return number(self.range.get("min"), 0)

    def max(self):
        return number(self.range.get("max"), 100)

    def step(self):
        return number(self.range.get("step"), 1)

    def unit(self):
        return self.range.get("unit") or ""


def normalize_kind(kind):
    kind = str(kind or "").lower()
    if kind == "toggle":
        return "boolean"
    if kind in ("range", "boolean", "enum", "color", "trigger"):
        return kind
    if kind in ("discrete", "select"):
        return "enum"
    if kind == "scene":
        return "trigger"
    return "trigger"


def default_value(capability):
    if capability.kind == "boolean":
        return False
    if capability.kind == "range":
        return capability.min()
    if capability.kind == "color":
        return capability.min()
    if capability.kind == "enum":
        return 0
    return None


def adjust_value(capability, current, direction=1):
    if capability.kind in ("range", "color"):
        step = capability.step()
        next_value = number(current, capability.min()) + (step * direction)
        return clamp(next_value, capability.min(), capability.max())
    if capability.kind == "enum":
        count = len(capability.options)
        if count <= 0:
            return current
        return (int(number(current, 0)) + direction) % count
    return current


def display_value(capability, value):
    if capability is None:
        return "No action"
    if capability.kind == "boolean":
        return "ON" if value else "OFF"
    if capability.kind == "range":
        return "{}{}".format(format_number(value), capability.unit())
    if capability.kind == "color":
        return "Hue {}".format(format_number(value))
    if capability.kind == "enum":
        if capability.options:
            index = int(number(value, 0)) % len(capability.options)
            option = capability.options[index]
            if isinstance(option, dict):
                return str(option.get("label") or option.get("id") or option.get("value"))
            return str(option)
        return str(value)
    return "RUN"


def build_action(device, capability, value):
    if capability.kind == "boolean":
        return {
            "deviceId": device.id,
            "capabilityId": capability.id,
            "commandType": "toggle",
        }
    if capability.kind in ("range", "color"):
        return {
            "deviceId": device.id,
            "capabilityId": capability.id,
            "commandType": "set",
            "value": value,
        }
    if capability.kind == "enum":
        return {
            "deviceId": device.id,
            "capabilityId": capability.id,
            "commandType": "set",
            "value": enum_value(capability, value),
        }
    return {
        "deviceId": device.id,
        "capabilityId": capability.id,
        "commandType": "execute",
        "value": True,
    }


def enum_value(capability, value):
    if not capability.options:
        return value
    option = capability.options[int(number(value, 0)) % len(capability.options)]
    if isinstance(option, dict):
        return option.get("value", option.get("id"))
    return option


def number(value, fallback=0):
    try:
        return float(value)
    except Exception:
        return fallback


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def format_number(value):
    numeric = number(value, 0)
    if int(numeric) == numeric:
        return str(int(numeric))
    return "{:.1f}".format(numeric)
