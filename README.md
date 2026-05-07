# Gestura Gauntlet

Gestura Gauntlet is a wearable smart-glove control system for smart-room devices. The current codebase includes Pico W firmware, a central Node.js control plane, an authenticated dashboard, a 3D simulator, edge node agents, simulator and Kasa device managers, Postgres persistence, and optional InfluxDB/Grafana telemetry.

This README describes the repository as it exists now. The old MQTT/Firebase architecture is not the current runtime path.

## Current Architecture

```text
Pico W glove
  -> /glove WebSocket or HTTP action fallback
  -> node-agent on the LAN, or central backend directly

node-agent
  -> Socket.IO /nodes connection to gestura-backend
  -> local manager attachment server on port 3201
  -> local /glove edge WebSocket and HTTP glove action endpoints

sim-manager / kasa-manager
  -> Socket.IO attachment to node-agent
  -> expose device inventory and execute actions

gestura-backend
  -> Express REST API
  -> Socket.IO dashboard and node namespaces
  -> ws status and glove WebSocket hubs
  -> Postgres persistence when DATABASE_URL is configured
  -> optional InfluxDB telemetry sink

Dashboard
  -> Next.js authenticated dashboard
  -> analytics view and configuration view
  -> expects backend /api and websocket routes on the same origin or behind a proxy

Simulator
  -> Next.js + React Three Fiber smart-room UI
  -> local REST API for simulated devices and state
```

## Repository Layout

| Path | Purpose |
| --- | --- |
| `Pico_Gestura/` | MicroPython firmware for the Raspberry Pi Pico W glove. |
| `gestura-backend/` | Central Express/Socket.IO backend, auth, routing, persistence, telemetry, and glove APIs. |
| `Dashboard/` | Next.js dashboard for analytics, auth, manager/device inventory, mappings, Wi-Fi configuration, and test actions. |
| `Simulator/` | 3D smart-room simulator and simulated device API. |
| `node-agent/` | Edge bridge that registers with the backend and accepts local manager/glove connections. |
| `sim-manager/` | Manager service that adapts the simulator API into the manager contract. |
| `kasa-manager/` | Manager service for TP-Link Kasa plugs and bulbs. |
| `shared/` | Shared TypeScript route/topology types. |
| `grafana/` | Grafana provisioning for the InfluxDB datasource. |
| `hardware_tests/` | Standalone Arduino Nano IMU/LCD test sketch; not the main Pico firmware. |
| `compose-example.yml` | Full local stack example. |
| `manager-edge-compose-example.yml` | Edge-only node-agent + Kasa manager example. |

## Implemented Features

- Pico W firmware reads an MPU-6050 IMU, two FSR pressure inputs, and renders status/navigation on an SSD1306 OLED.
- Pico firmware fetches runtime config from the central backend or an edge node, caches endpoint metadata, and sends mapped actions by WebSocket or HTTP fallback.
- The backend persists managers, nodes, devices, mappings, scenes, route metrics, telemetry events, passive metric uploads, and glove Wi-Fi config in Postgres when configured.
- Dashboard login uses an HMAC-signed cookie. Passwords are expected as `scrypt$<saltHex>$<hashHex>`.
- Dashboard analytics shows mode, transport state, imported devices, selected target/action, and live/requested sensor snapshots.
- Dashboard configuration manages nodes, managers, devices, mappings, glove Wi-Fi networks, and test actions.
- Node agents register with the backend over Socket.IO and host edge-local glove and manager endpoints.
- Simulator and Kasa managers attach to node-agent over Socket.IO and implement the manager action contract.
- Route and action telemetry can be written to InfluxDB and viewed through Grafana.

## Not Implemented or Legacy

- MQTT is not used by the current backend, Pico firmware, node-agent, simulator manager, or Kasa manager. Some old config such as `MQTT_SERVER` may still exist locally, but the active runtime uses WebSocket, Socket.IO, and HTTP.
- Firebase Realtime Database is not used. The current persistence layer is Postgres, with in-memory fallback when `DATABASE_URL` is not set.
- Passive mode exists as a system/glove mode, and passive metric ingestion exists, but the old "Focus Score" and automatic break-enforcement behavior are not implemented in the current code.
- The dashboard currently calls relative paths such as `/api/status`, `/api/auth/login`, `/api/ws/status`, and Socket.IO on `/socket.io`. For browser use, serve the dashboard and backend behind a same-origin proxy, or add Next.js rewrites.

## Tech Stack

- Hardware: Raspberry Pi Pico W, MPU-6050 IMU, two FSR pressure sensors, SSD1306 128x64 OLED.
- Firmware: MicroPython with `uasyncio`.
- Backend: Node.js, Express 5, Socket.IO, `ws`.
- Frontend: Next.js 16, React 19, Tailwind CSS, shadcn-style UI components.
- Simulator: Next.js, React Three Fiber, Three.js.
- Persistence: Postgres with SQL migrations in `gestura-backend/migrations/`.
- Telemetry: optional InfluxDB 2.x plus Grafana.
- Device integrations: simulated smart-room devices and TP-Link Kasa plugs/bulbs.

## Ports

| Service | Default port | Notes |
| --- | ---: | --- |
| `gestura-backend` | `3001` | REST API, dashboard Socket.IO, `/glove`, `/api/ws/status`, `/nodes`. |
| `Dashboard` | `3000` dev, `3100` compose | Needs same-origin backend routes or a proxy. |
| `Simulator` | `3101` | 3D UI plus simulated device API. |
| `sim-manager` | `3102` | Manager adapter API; also attaches to node-agent. |
| `node-agent` | `3201` | Manager attachment server plus edge `/glove` and glove action API. |
| `InfluxDB` | `8086` | Optional telemetry sink. |
| `Grafana` | `3000` | Compose maps Grafana to `localhost:3000`. |

## Backend Environment

Minimum useful backend environment:

```bash
PORT=3001
SESSION_SECRET=replace-with-long-random-secret
DASHBOARD_USERNAME=admin
DASHBOARD_PASSWORD_HASH=scrypt$<saltHex>$<hashHex>
NODE_SHARED_TOKEN=replace-with-node-token
PICO_API_TOKEN=replace-with-pico-token
```

Optional persistence and telemetry:

```bash
DATABASE_URL=postgres://gestura:gestura_dev_password@localhost:5432/gestura
DATABASE_SSL=false
INFLUXDB_URL=http://localhost:8086
INFLUXDB_TOKEN=gestura-influx-admin-token
INFLUXDB_ORG=gestura
INFLUXDB_BUCKET=gestura_metrics
```

Generate a dashboard password hash:

```bash
node -e "const crypto=require('crypto'); const password=process.argv[1]; const salt=crypto.randomBytes(16); const hash=crypto.scryptSync(password,salt,32); console.log('scrypt$'+salt.toString('hex')+'$'+hash.toString('hex'))" "your-dashboard-password"
```

If you put a hash inside Docker Compose YAML, escape each dollar sign as `$$`.

## Edge and Manager Environment

Node-agent:

```bash
CENTRAL_API_URL=http://localhost:3001
CENTRAL_WS_URL=http://localhost:3001
NODE_ID=dev-edge-1
NODE_NAME="Dev Edge 1"
NODE_TOKEN=replace-with-node-token
NODE_AGENT_PORT=3201
NODE_LAN_URLS=ws://localhost:3201/glove
MANAGER_SHARED_TOKEN=replace-with-manager-token
PICO_API_TOKEN=replace-with-pico-token
```

Simulator manager:

```bash
NODE_AGENT_WS_URL=http://localhost:3201
MANAGER_ID=sim-main
MANAGER_KIND=simulator
MANAGER_NAME="Simulator Main"
MANAGER_TOKEN=replace-with-manager-token
SIM_MANAGER_URL=http://0.0.0.0:3102
SIMULATOR_API_URL=http://localhost:3101
MANAGER_LAN_URL=http://localhost:3102
```

Kasa manager:

```bash
NODE_AGENT_WS_URL=http://localhost:3201
MANAGER_ID=kasa-main
MANAGER_KIND=kasa
MANAGER_NAME="Kasa Main"
MANAGER_TOKEN=replace-with-manager-token
MANAGER_LAN_URL=http://edge-node-host.local:3301
KASA_DISCOVERY_TIMEOUT_MS=3000
KASA_SCAN_INTERVAL_MS=300000
```

## Pico Firmware Environment

Start from `Pico_Gestura/.env.example`. Key values:

```bash
WIFI_SSID=your-ssid
WIFI_PASS=your-password
WIFI_CONFIG_PATH=wifi_networks.json

GLOVE_ID=primary_glove
# Direct central backend:
GLOVE_WS_URL=ws://<backend-host>:3001/glove
# Or LAN edge node-agent:
# GLOVE_WS_URL=ws://<node-agent-host>:3201/glove
PICO_API_TOKEN=replace-with-pico-token
ENDPOINT_CACHE_PATH=endpoint_cache.json

TOP_FSR_PIN=27
BOTTOM_FSR_PIN=26
FSR_HALF_RATIO=0.25
FSR_FULL_RATIO=0.55
FSR_DEBOUNCE_MS=25
FSR_DOUBLE_CLICK_MS=280
FSR_HOLD_MS=450
FSR_HOLD_REPEAT_MS=160

PICO_ACTION_TRANSPORT=auto
PICO_HTTP_ACTION_FALLBACK=true
CONTINUOUS_ROLL_REQUIRES_FSR=true
CONTINUOUS_ROLL_FSR_SOURCE=bottom
ROLL_AXIS=yz

DEBUG=false
DEBUG_LIST=fsr,imu,roll,wifi,ws,action
DEBUG_INTERVAL_MS=500
```

The Pico can connect directly to the central backend or to a node-agent edge endpoint. It receives device definitions and mappings from `/api/gloves/:gloveId/config`, renders the available managers/devices/actions on the OLED, and sends mapped actions for the selected capability.

## Hardware Wiring

The current Pico firmware uses I2C bus `0` with SCL on `GP5` and SDA on `GP4`.

OLED Pin OUT:
Wiring Instructions:

VCC ➔ 3.3V Out (Pico Physical Pin 36) - Red Wire

GND ➔ GND (Pico Physical Pin 38) - Black Wire

SCL ➔ GP5 (Pico Physical Pin 7) - White Wire

SDA ➔ GP4 (Pico Physical Pin 6) - Yellow Wire

MPU-6050:

| MPU-6050 pin | Pico connection |
| --- | --- |
| `VCC` | `3V3` |
| `GND` | `GND` |
| `SCL` | `GP5` |
| `SDA` | `GP4` |

The firmware accepts MPU-6050 I2C address `0x68` or `0x69`.

FSR pressure inputs:

| Input | Default ADC pin |
| --- | --- |
| Top FSR | `GP27` |
| Bottom FSR | `GP26` |

## Pico Controls

Current firmware controls are menu/action oriented:

- `top_click`: move to the next item in list screens, or cycle action on a device screen.
- `top_hold`: cycle action on a device screen.
- `top_double`: go back.
- `bottom_click`: enter selected list item, or queue the selected device action.
- `bottom_hold`: scroll list/status screens, or adjust the current action value on a device screen.
- Continuous roll mappings can run when the configured FSR source is pressed.

Active/passive mode is maintained by the backend and broadcast to dashboards and gloves. The dashboard can set mode, and the glove can process server mode updates.

## Running with Docker Compose

The full example stack is in `compose-example.yml`:

```bash
docker compose -f compose-example.yml up --build
```

Before using it for real testing, replace the example tokens and `DASHBOARD_PASSWORD_HASH`. The compose stack includes Postgres, InfluxDB, Grafana, backend, dashboard, simulator, sim-manager, and node-agent.

Important dashboard note: `compose-example.yml` starts the dashboard on `localhost:3100` and the backend on `localhost:3001`, but the dashboard code uses same-origin `/api` and websocket paths. For the dashboard to work in a browser, add a reverse proxy with routes like:

| Browser path | Upstream |
| --- | --- |
| `/api/*` | `gestura-backend:3001` |
| `/api/ws/status` | `gestura-backend:3001` |
| `/socket.io/*` | `gestura-backend:3001` |
| `/glove` | `gestura-backend:3001` |
| `/*` | `dashboard:3100` |

## Running Services Locally

Install and run each service in separate terminals.

Backend:

```bash
cd gestura-backend
npm install
SESSION_SECRET=dev-secret DASHBOARD_PASSWORD_HASH='scrypt$...' NODE_SHARED_TOKEN=dev-node-token PICO_API_TOKEN=dev-pico-token npm run dev
```

Node-agent:

```bash
cd node-agent
npm install
CENTRAL_API_URL=http://localhost:3001 CENTRAL_WS_URL=http://localhost:3001 NODE_ID=dev-edge-1 NODE_TOKEN=dev-node-token MANAGER_SHARED_TOKEN=dev-manager-token PICO_API_TOKEN=dev-pico-token NODE_LAN_URLS=ws://localhost:3201/glove npm start
```

Simulator:

```bash
cd Simulator
npm install
PORT=3101 npm run dev
```

Simulator manager:

```bash
cd sim-manager
npm install
npm install --prefix src
NODE_AGENT_WS_URL=http://localhost:3201 MANAGER_TOKEN=dev-manager-token SIMULATOR_API_URL=http://localhost:3101 npx tsx src/app.ts
```

Kasa manager:

```bash
cd kasa-manager
npm install
NODE_AGENT_WS_URL=http://localhost:3201 MANAGER_TOKEN=dev-manager-token npm start
```

Dashboard:

```bash
cd Dashboard
npm install
SESSION_SECRET=dev-secret PORT=3100 npm run dev
```

Use a same-origin proxy for dashboard API/websocket paths as described above.

## API and Runtime Notes

- Dashboard/auth APIs live under `/api/auth`.
- Backend status is available at `/api/status` and `/api/system/status`.
- Device manager inventory and actions are under `/api/managers`, `/api/devices`, `/api/mappings`, `/api/scenes`, `/api/nodes`, `/api/route-metrics`, and `/api/telemetry`.
- Glove configuration and actions are under `/api/gloves/:gloveId/...`.
- The central glove WebSocket is `/glove`.
- Dashboard realtime status WebSocket is `/api/ws/status`.
- Node-agent connects to the backend Socket.IO namespace `/nodes`.
- Managers attach to node-agent over Socket.IO on the node-agent base URL.

## Debugging

Pico debug logging is controlled in `Pico_Gestura/.env`:

```bash
DEBUG=true
DEBUG_LIST=fsr,imu,roll,wifi,ws,action
DEBUG_INTERVAL_MS=500
```

Use `DEBUG_LIST=all` or a comma-separated subset. Backend, node-agent, and managers also honor `DEBUG` in several paths.
