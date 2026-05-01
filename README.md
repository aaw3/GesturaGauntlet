# 🦾 The Gestura Gauntlet

**A wearable IoT smart glove and central hub for spatial gesture control and ambient productivity tracking.**

## 📖 Overview
The Gestura Gauntlet is an IoT ecosystem designed to replace static desk controls (like mice or voice assistants) with intuitive physical hand movements. It features a wearable edge node (a smart glove) that communicates with a localized Node.js server via MQTT to control smart home environment variables.

The system operates in two main modes:
1. **Active Mode (Gesture Control):** Point, pinch, and twist to physically control smart desk peripherals (e.g., dimming lights, toggling power).
2. **Passive Mode (Productivity Tracking):** Runs a background variance analysis on hand micro-movements to calculate a dynamic "Focus Score," automatically altering room environments to enforce breaks or snap the user out of unproductive fidgeting loops.

## 🛠️ Tech Stack
* **Edge Hardware:** Raspberry Pi Pico W, MPU-6050 IMU, 2x Resistive Flex Sensors, 0.96" OLED Display.
* **Edge Firmware:** MicroPython 
* **Communications:** MQTT over Wi-Fi, HTTP/REST
* **Backend Hub:** Node.js
* **Database:** Firebase Realtime Database
* **Frontend Dashboard:** React.js
* **Actuators:** Kasa Smart Wi-Fi Plug, Kasa Smart Wi-Fi LED Bulb

## 🚀 Getting Started

*(Instructions for flashing the Pico W, starting the Node server, and running the React dashboard will be added as the project develops during the sprint).*

Pico debug logging can be enabled in `Pico_Gestura/.env`:

```
DEBUG=true
DEBUG_LIST=fsr
DEBUG_INTERVAL_MS=500
```

Use `DEBUG_LIST=fsr`, `DEBUG_LIST=imu`, `DEBUG_LIST=fsr,imu`, or `DEBUG_LIST=all` to choose which Pico sensor inputs print to the serial console.

OLED Pin OUT:
Wiring Instructions:

VCC ➔ 3.3V Out (Pico Physical Pin 36) - Red Wire

GND ➔ GND (Pico Physical Pin 38) - Black Wire

SCL ➔ GP5 (Pico Physical Pin 7) - White Wire

SDA ➔ GP4 (Pico Physical Pin 6) - Yellow Wire


Goals: use the pressure sensor as a selector for which device to use by cycling through as awell as going into and out of active mode (double Click)
OR if we squeeze above a certian pressure it will go to active mode, lighter pressure will be passive mode
