// ponytail: direct DOM and Three.js material property updates without React/Vue or state management libraries
// Ceiling: suitable for single-room twin; upgrade to component/scene-graph state tree if scaling to multi-room

export class StateUpdater {
  constructor(sceneObjects = {}) {
    this.sceneObjects = sceneObjects; // e.g. { roomLight, acMesh, fanMesh, roomWalls }
  }

  /**
   * Update 2D dashboard text & indicators
   * @param {Object} data - Telemetry payload from ESP32
   */
  updateDashboard(data) {
    if (!data) return;

    this.setText('val-temp', data.room_temp != null ? `${Number(data.room_temp).toFixed(1)} °C` : '--');
    this.setText('val-rh', data.room_rh != null ? `${Number(data.room_rh).toFixed(1)} %` : '--');
    this.setText('val-lux', data.light_lux != null ? `${Number(data.light_lux).toFixed(1)} Lux` : '--');
    this.setText('val-trend', data.temp_trend_5m != null ? `${Number(data.temp_trend_5m) > 0 ? '+' : ''}${Number(data.temp_trend_5m).toFixed(2)} °C/5m` : '--');
    this.setText('val-thermal-state', data.thermal_state || '--');
    this.setText('val-light-state', data.light_state || '--');
    this.setText('val-seq', data.seq != null ? `#${data.seq}` : '--');

    // Highlight state badges
    const thermalBadge = document.getElementById('val-thermal-state');
    if (thermalBadge) {
      thermalBadge.className = `badge state-${(data.thermal_state || '').toLowerCase()}`;
    }
  }

  /**
   * Update 3D Digital Twin visualization
   * @param {Object} data - Telemetry payload from ESP32
   */
  update3DScene(data) {
    if (!data) return;

    // 1. Update Lighting based on light_lux / light_state
    if (this.sceneObjects.roomLight) {
      const lux = Number(data.light_lux) || 0;
      // Map lux (0 - 500+) to intensity (0.1 - 2.5)
      const targetIntensity = Math.min(2.5, Math.max(0.1, lux / 200));
      this.sceneObjects.roomLight.intensity = targetIntensity;

      // Color tint based on light state
      if (data.light_state === 'DARK') {
        this.sceneObjects.roomLight.color.setHex(0x1a243b); // Night blue
      } else if (data.light_state === 'DIM') {
        this.sceneObjects.roomLight.color.setHex(0xffe2a0); // Warm dim
      } else {
        this.sceneObjects.roomLight.color.setHex(0xffffff); // Bright daylight
      }
    }

    // 2. Update Thermal Glow / Aura based on thermal_state
    if (this.sceneObjects.acIndicator && this.sceneObjects.acIndicator.material) {
      switch (data.thermal_state) {
        case 'ACTIVE_COOLING':
          this.sceneObjects.acIndicator.material.color.setHex(0x00d2ff); // Cyan / Ice
          this.sceneObjects.acIndicator.material.emissive?.setHex(0x0088cc);
          break;
        case 'WARMING_TREND':
          this.sceneObjects.acIndicator.material.color.setHex(0xff5722); // Orange / Warm
          this.sceneObjects.acIndicator.material.emissive?.setHex(0x992200);
          break;
        case 'COOL_STABLE':
          this.sceneObjects.acIndicator.material.color.setHex(0x2ecc71); // Green stable
          this.sceneObjects.acIndicator.material.emissive?.setHex(0x117733);
          break;
        case 'AMBIENT_STABLE':
        default:
          this.sceneObjects.acIndicator.material.color.setHex(0x95a5a6); // Neutral grey
          this.sceneObjects.acIndicator.material.emissive?.setHex(0x222222);
          break;
      }
    }

    // 3. Optional AC Fan/airflow animation toggle
    if (this.sceneObjects.isCoolingActive !== undefined) {
      this.sceneObjects.isCoolingActive = (data.thermal_state === 'ACTIVE_COOLING');
    }
  }

  setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}
