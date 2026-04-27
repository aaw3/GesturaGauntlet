class StateStore:
    def __init__(self):
        self._state = {
            "connected": False,
            "mode": "INIT",
            "action": "BOOTING...",
            "calibrate_req": False,
            "accel_x": 0.0,
            "accel_y": 0.0,
            "accel_z": 0.0,
            "gyro_x": 0.0,
            "gyro_y": 0.0,
            "gyro_z": 0.0,
            "roll": 0.0,
            "pitch": 0.0,
            "roll_deg": 0.0,
            "pitch_deg": 0.0,
            "input_events": [],
        }

    def update(self, **kwargs):
        for key, value in kwargs.items():
            # Support dynamic creation of keys just in case, or ensure they exist
            self._state[key] = value

    def get(self, key, default=None):
        return self._state.get(key, default)

    def enqueue_input(self, source, value=1, **metadata):
        events = self._state.get("input_events") or []
        event = {"source": source, "value": value}
        event.update(metadata)
        events.append(event)
        self._state["input_events"] = events[-10:]

    def drain_inputs(self):
        events = self._state.get("input_events") or []
        self._state["input_events"] = []
        return list(events)

    def snapshot(self):
        return dict(self._state)
