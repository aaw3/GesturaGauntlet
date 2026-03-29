class StateStore:
    def __init__(self):
        self._state = {
            "connected": False,
            "mode": "INIT",
            "accel_x": 0.0,
            "accel_y": 0.0,
            "accel_z": 0.0,
            "gyro_x": 0.0,
            "gyro_y": 0.0,
            "gyro_z": 0.0,
        }

    def update(self, **kwargs):
        for key, value in kwargs.items():
            if key in self._state:
                self._state[key] = value

    def get(self, key, default=None):
        return self._state.get(key, default)

    def snapshot(self):
        return dict(self._state)
