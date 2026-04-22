const { fetchJson } = require('../utils');

function createExternalManager({ info, baseUrl, authToken }) {
  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};

  return {
    getInfo() {
      return {
        ...info,
        integrationType: 'external',
        baseUrl,
      };
    },

    async listDevices() {
      return fetchJson(`${baseUrl}/api/devices`, { headers });
    },

    async getDeviceState(deviceId) {
      return fetchJson(`${baseUrl}/api/devices/${encodeURIComponent(deviceId)}/state`, {
        headers,
      });
    },

    async executeAction(action) {
      return fetchJson(
        `${baseUrl}/api/devices/${encodeURIComponent(action.deviceId)}/actions/${encodeURIComponent(action.capabilityId)}`,
        {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(action),
        }
      );
    },
  };
}

async function validateExternalManager({ name, baseUrl, authToken }) {
  const errors = [];
  if (!baseUrl || !String(baseUrl).trim()) errors.push('Base URL is required');
  if (errors.length > 0) return { ok: false, errors };

  const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
  let managerInfo;
  let devices;

  try {
    managerInfo = await fetchJson(`${baseUrl}/api/manager`, { headers });
  } catch (err) {
    return { ok: false, errors: [`GET /api/manager failed: ${err.message}`] };
  }

  if (!managerInfo.id) errors.push('Manager info missing id');
  if (!managerInfo.name) errors.push('Manager info missing name');
  if (!managerInfo.kind) errors.push('Manager info missing kind');
  if (!managerInfo.version) errors.push('Manager info missing version');
  if (managerInfo.integrationType && managerInfo.integrationType !== 'external') {
    errors.push('Manager integrationType must be external');
  }

  try {
    devices = await fetchJson(`${baseUrl}/api/devices`, { headers });
  } catch (err) {
    return {
      ok: false,
      managerInfo,
      errors: [...errors, `GET /api/devices failed: ${err.message}`],
    };
  }

  if (!Array.isArray(devices)) {
    errors.push('GET /api/devices must return an array');
    devices = [];
  }

  for (const device of devices) {
    if (!device.id) errors.push('Device missing id');
    if (!device.name) errors.push(`Device ${device.id || '<unknown>'} missing name`);
    if (!device.type) errors.push(`Device ${device.id || '<unknown>'} missing type`);
    if (!Array.isArray(device.capabilities)) {
      errors.push(`Device ${device.id || '<unknown>'} missing capabilities array`);
      continue;
    }

    for (const capability of device.capabilities) {
      if (!capability.id) errors.push(`Device ${device.id} has capability missing id`);
      if (!capability.label) errors.push(`Device ${device.id} has capability missing label`);
      if (!capability.kind) errors.push(`Device ${device.id} has capability missing kind`);
    }
  }

  return {
    ok: errors.length === 0,
    managerInfo: {
      ...managerInfo,
      name: String(name || '').trim() || managerInfo.name,
      integrationType: 'external',
      baseUrl,
    },
    devices,
    deviceCount: devices.length,
    errors,
  };
}

module.exports = { createExternalManager, validateExternalManager };
