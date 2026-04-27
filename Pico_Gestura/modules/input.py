import time


class FSRInputReader:
    def __init__(
        self,
        top_fsr,
        bottom_fsr,
        debounce_ms=50,
        double_click_ms=420,
        hold_ms=650,
        hold_repeat_ms=220,
    ):
        self.top = ChannelState("top", top_fsr, debounce_ms, double_click_ms, hold_ms, hold_repeat_ms)
        self.bottom = ChannelState("bottom", bottom_fsr, debounce_ms, double_click_ms, hold_ms, hold_repeat_ms)

    def read(self):
        events = []
        events.extend(self.top.read())
        events.extend(self.bottom.read())
        return events

    def bottom_pressure(self):
        return self.bottom.pressure()


class ChannelState:
    def __init__(self, name, fsr, debounce_ms, double_click_ms, hold_ms, hold_repeat_ms):
        self.name = name
        self.fsr = fsr
        self.debounce_ms = debounce_ms
        self.double_click_ms = double_click_ms
        self.hold_ms = hold_ms
        self.hold_repeat_ms = hold_repeat_ms
        self.is_down = False
        self.down_at = 0
        self.last_transition_ms = 0
        self.pending_click_at = 0
        self.hold_active = False
        self.last_hold_ms = 0

    def read(self):
        now = time.ticks_ms()
        self.fsr.tick()
        down = self.fsr.get_state() == self.fsr.STATE_FULL
        events = []

        if down != self.is_down and time.ticks_diff(now, self.last_transition_ms) >= self.debounce_ms:
            self.last_transition_ms = now
            self.is_down = down
            if down:
                self.down_at = now
                self.hold_active = False
                self.last_hold_ms = now
            else:
                duration = time.ticks_diff(now, self.down_at)
                if not self.hold_active and duration >= self.debounce_ms:
                    if self.pending_click_at and time.ticks_diff(now, self.pending_click_at) <= self.double_click_ms:
                        events.append({"type": "{}_double".format(self.name), "source": self.name})
                        self.pending_click_at = 0
                    else:
                        self.pending_click_at = now

        if self.is_down:
            duration = time.ticks_diff(now, self.down_at)
            if duration >= self.hold_ms and time.ticks_diff(now, self.last_hold_ms) >= self.hold_repeat_ms:
                self.hold_active = True
                self.last_hold_ms = now
                self.pending_click_at = 0
                events.append({
                    "type": "{}_hold".format(self.name),
                    "source": self.name,
                    "duration_ms": duration,
                })

        if self.pending_click_at and time.ticks_diff(now, self.pending_click_at) > self.double_click_ms:
            events.append({"type": "{}_click".format(self.name), "source": self.name})
            self.pending_click_at = 0

        return events

    def pressure(self):
        try:
            return self.fsr.get_pressure_percentage()
        except Exception:
            return 0.0
