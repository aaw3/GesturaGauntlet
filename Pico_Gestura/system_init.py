import network
import time
import machine

def hardware_check():
    print("Checking I2C bus...")
    # Initialize I2C on pins 4 and 5 (Pico 2W defaults)
    i2c = machine.I2C(0, scl=machine.Pin(5), sda=machine.Pin(4), freq=400000)
    devices = i2c.scan()
    
    if not devices:
        raise Exception("No I2C devices found! Check OLED wiring.")
        
    print(f"I2C devices found at: {[hex(d) for d in devices]}")
    return i2c, devices

def connect_wifi(ssid, password):
    print(f"Connecting to {ssid}...")
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(ssid, password)
    
    max_wait = 15
    while max_wait > 0:
        if wlan.status() < 0 or wlan.status() >= 3:
            break
        max_wait -= 1
        time.sleep(1)
        
    if wlan.status() != 3:
        raise Exception("Wi-Fi connection failed! Check credentials.")
        
    ip = wlan.ifconfig()[0]
    print(f"Wi-Fi Connected! IP: {ip}")
    return ip
