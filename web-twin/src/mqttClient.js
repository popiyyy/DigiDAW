// ponytail: MQTT over WebSocket client using standard paho-mqtt / mqtt.js from CDN or global window
// Ceiling: connects directly to ws:// broker without auth/TLS, upgrade with TLS wss:// and token auth for production

const DEFAULT_CONFIG = {
  host: window.location.hostname || 'localhost',
  port: 9001,
  path: '/',
  topic: 'digidaw/room1/telemetry',
  clientId: 'web-twin-' + Math.random().toString(16).substring(2, 8)
};

export class MQTTClient {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.client = null;
    this.listeners = new Set();
    this.isConnected = false;
    this.heartbeatTimer = null;
    this.heartbeatTimeoutMs = 6000; // Firmware kirim tiap 2.5s; jika >6s tidak ada pesan, ESP dianggap disconnected
  }

  /**
   * Connect to Mosquitto WebSocket broker
   */
  connect() {
    const url = `ws://${this.config.host}:${this.config.port}${this.config.path}`;
    console.log(`[MQTT] Connecting to ${url}...`);

    if (typeof mqtt === 'undefined') {
      console.error('[MQTT] mqtt.js library not found on window. Ensure CDN script tag is included in index.html');
      return;
    }

    this.client = mqtt.connect(url, {
      clientId: this.config.clientId,
      clean: true,
      reconnectPeriod: 3000
    });

    this.client.on('connect', () => {
      console.log(`[MQTT] Connected to broker. Subscribing to: ${this.config.topic}`);
      this.client.subscribe(this.config.topic, (err) => {
        if (err) console.error('[MQTT] Subscribe error:', err);
      });
    });

    this.client.on('message', (topic, payload) => {
      try {
        const data = JSON.parse(payload.toString());
        this.resetEspWatchdog();
        this.notify(data);
      } catch (e) {
        console.warn('[MQTT] Non-JSON payload received:', payload.toString());
      }
    });

    this.client.on('error', (err) => {
      console.warn('[MQTT] Error:', err.message);
      this.markEspDisconnected();
    });

    this.client.on('close', () => {
      console.log('[MQTT] Disconnected from broker');
      this.markEspDisconnected();
    });
  }

  resetEspWatchdog() {
    this.notifyStatus('CONNECTED');
    if (this.heartbeatTimer) clearTimeout(this.heartbeatTimer);
    this.heartbeatTimer = setTimeout(() => {
      this.markEspDisconnected();
    }, this.heartbeatTimeoutMs);
  }

  markEspDisconnected() {
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.notifyStatus('NOT CONNECTED');
  }

  /**
   * Register listener for incoming telemetry data
   * @param {Function} callback (data) => void
   */
  onMessage(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify(data) {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        console.error('[MQTT] Listener callback error:', err);
      }
    }
  }

  notifyStatus(status) {
    const statusEl = document.getElementById('mqtt-status');
    if (statusEl) {
      statusEl.textContent = status;
      const cssClass = status.toLowerCase().replace(/\s+/g, '-');
      statusEl.className = `status-badge ${cssClass}`;
    }
  }
}
