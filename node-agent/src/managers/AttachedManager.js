class AttachedManager {
  constructor({ socket, info, devices = [] }) {
    this.socket = socket;
    this.info = info;
    this.devices = devices;
  }

  getInfo() {
    return this.info;
  }

  setDevices(devices = []) {
    this.devices = devices;
  }

  async listDevices() {
    if (this.socket.connected) {
      const response = await emitWithAck(this.socket, 'manager:listDevices', { managerId: this.info.id });
      if (Array.isArray(response)) this.devices = response;
    }
    return this.devices;
  }

  async getDeviceState(deviceId) {
    return emitWithAck(this.socket, 'manager:getDeviceState', { managerId: this.info.id, deviceId });
  }

  async executeAction(action) {
    return emitWithAck(this.socket, 'manager:executeAction', { managerId: this.info.id, action });
  }

  async discover() {
    return emitWithAck(this.socket, 'manager:discover', { managerId: this.info.id });
  }

  async clearStorage() {
    return emitWithAck(this.socket, 'manager:clearStorage', { managerId: this.info.id });
  }
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    socket.timeout(5000).emit(event, payload, (err, response) => {

      if (err) {
        reject(new Error(`Attached manager did not acknowledge ${event}`));
        return;
      }
      if (response?.ok === false) {
        reject(new Error(response.message || response.error || `${event} failed`));
        return;
      }
      resolve(response?.data ?? response);
    });
  });
}

module.exports = { AttachedManager };
