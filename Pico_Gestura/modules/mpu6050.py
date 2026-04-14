import machine

class MPU6050:
    def __init__(self, i2c, addr=0x68):
        self.i2c = i2c
        self.addr = addr
        
        # 1. Wake up the MPU-6050 
        self.i2c.writeto_mem(self.addr, 0x6B, b'\x00')

        # 2. Calibration Offsets
        self.ax_offset = 0.0
        self.ay_offset = 0.0
        self.az_offset = 0.0 # Expected 1.0g when flat
        self.gx_offset = 0.0
        self.gy_offset = 0.0
        self.gz_offset = 0.0

    def calibrate(self, samples=50):
        """Perform a heavy calibration while the device is stationary and flat."""
        ax_sum = ay_sum = az_sum = 0
        gx_sum = gy_sum = gz_sum = 0
        
        for _ in range(samples):
            data_a = self._read_raw_accel()
            data_g = self._read_raw_gyro()
            ax_sum += data_a['x']
            ay_sum += data_a['y']
            az_sum += data_a['z']
            gx_sum += data_g['x']
            gy_sum += data_g['y']
            gz_sum += data_g['z']
            
        self.ax_offset = ax_sum / samples
        self.ay_offset = ay_sum / samples
        self.az_offset = (az_sum / samples) - 1.0 # Offset from 1.0g
        
        self.gx_offset = gx_sum / samples
        self.gy_offset = gy_sum / samples
        self.gz_offset = gz_sum / samples
        print(f"Calibrated! Offsets: A({self.ax_offset:.3f},{self.ay_offset:.3f},{self.az_offset:.3f}) G({self.gx_offset:.3f},{self.gy_offset:.3f},{self.gz_offset:.3f})")

    def runtime_re_zero(self, gx, gy, gz, alpha=0.99):
        """Slowly update gyro offsets if the device is perceived to be still."""
        # Simple threshold check: if gyro rotation is < 2 degrees/sec, assume still
        if abs(gx) < 2.0 and abs(gy) < 2.0 and abs(gz) < 2.0:
            # User formula: alpha * offset + (1 - alpha) * new_reading
            # This is applied to the raw-ish reading to update the baseline
            self.gx_offset = (alpha * self.gx_offset) + ((1 - alpha) * (gx + self.gx_offset))
            self.gy_offset = (alpha * self.gy_offset) + ((1 - alpha) * (gy + self.gy_offset))
            self.gz_offset = (alpha * self.gz_offset) + ((1 - alpha) * (gz + self.gz_offset))

    def _read_raw_accel(self):
        data = self.i2c.readfrom_mem(self.addr, 0x3B, 6)
        return {
            'x': self._bytes_to_int(data[0], data[1]) / 16384.0,
            'y': self._bytes_to_int(data[2], data[3]) / 16384.0,
            'z': self._bytes_to_int(data[4], data[5]) / 16384.0
        }

    def _read_raw_gyro(self):
        data = self.i2c.readfrom_mem(self.addr, 0x43, 6)
        return {
            'x': self._bytes_to_int(data[0], data[1]) / 131.0,
            'y': self._bytes_to_int(data[2], data[3]) / 131.0,
            'z': self._bytes_to_int(data[4], data[5]) / 131.0
        }

    def get_accel(self):
        raw = self._read_raw_accel()
        return {
            'x': raw['x'] - self.ax_offset,
            'y': raw['y'] - self.ay_offset,
            'z': raw['z'] - self.az_offset
        }

    def get_gyro(self):
        raw = self._read_raw_gyro()
        return {
            'x': raw['x'] - self.gx_offset,
            'y': raw['y'] - self.gy_offset,
            'z': raw['z'] - self.gz_offset
        }

    def _bytes_to_int(self, msb, lsb):
        # Bitwise shift to combine the two 8-bit numbers into a 16-bit number
        val = (msb << 8) | lsb
        
        # Handle Two's Complement for negative numbers
        if val >= 32768:
            val -= 65536
        return val
