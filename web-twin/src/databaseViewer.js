/**
 * DatabaseViewer - Manages the telemetry database table view at the bottom of the page
 * Clean, minimal, English UI text.
 */
export class DatabaseViewer {
  constructor(options = {}) {
    this.tableBody = document.getElementById(options.tableBodyId || 'db-table-body');
    this.rowCountEl = document.getElementById(options.rowCountId || 'db-row-count');
    this.lastUpdatedEl = document.getElementById(options.lastUpdatedId || 'db-last-updated');
    this.syncDot = document.getElementById(options.syncDotId || 'db-sync-dot');
    this.rangeSelect = document.getElementById(options.rangeSelectId || 'db-range-select');
    this.refreshBtn = document.getElementById(options.refreshBtnId || 'db-refresh-btn');
    this.exportBtn = document.getElementById(options.exportBtnId || 'db-export-btn');
    
    this.maxRecords = options.maxRecords || 200;
    this.records = [];
    this.onRangeChangeCallback = null;
    this.onRefreshCallback = null;

    this.initEventListeners();
  }

  initEventListeners() {
    if (this.rangeSelect) {
      this.rangeSelect.addEventListener('change', (e) => {
        if (this.onRangeChangeCallback) {
          this.onRangeChangeCallback(e.target.value);
        }
      });
    }

    if (this.refreshBtn) {
      this.refreshBtn.addEventListener('click', () => {
        if (this.onRefreshCallback) {
          this.onRefreshCallback(this.rangeSelect ? this.rangeSelect.value : '-1h');
        }
      });
    }

    if (this.exportBtn) {
      this.exportBtn.addEventListener('click', () => this.exportCsv());
    }
  }

  onRangeChange(cb) {
    this.onRangeChangeCallback = cb;
  }

  onRefresh(cb) {
    this.onRefreshCallback = cb;
  }

  setLoading(isLoading) {
    if (this.refreshBtn) {
      if (isLoading) {
        this.refreshBtn.classList.add('loading');
        this.refreshBtn.disabled = true;
      } else {
        this.refreshBtn.classList.remove('loading');
        this.refreshBtn.disabled = false;
      }
    }
    if (this.syncDot) {
      if (isLoading) {
        this.syncDot.classList.add('syncing');
      } else {
        this.syncDot.classList.remove('syncing');
      }
    }
  }

  addLiveRecord(data) {
    if (!data) return;

    const record = {
      time: data.time || new Date().toISOString(),
      seq: data.seq ?? '-',
      room_temp: data.room_temp != null ? Number(data.room_temp) : null,
      room_rh: data.room_rh != null ? Number(data.room_rh) : null,
      light_lux: data.light_lux != null ? Number(data.light_lux) : null,
      temp_trend_5m: data.temp_trend_5m != null ? Number(data.temp_trend_5m) : null,
      thermal_state: data.thermal_state || '-',
      light_state: data.light_state || '-',
      source: 'MQTT Live'
    };

    if (this.records.length > 0 && this.records[0].seq !== '-' && this.records[0].seq === record.seq) {
      return;
    }

    this.records.unshift(record);
    if (this.records.length > this.maxRecords) {
      this.records.pop();
    }

    this.render();
    this.flashSyncDot();
  }

  loadInfluxHistory(historyRecords) {
    if (!Array.isArray(historyRecords)) return;

    const existingLive = this.records.filter(r => r.source === 'MQTT Live');
    
    const formattedInflux = historyRecords.map(item => ({
      time: item.time || new Date().toISOString(),
      seq: item.seq ?? '-',
      room_temp: item.room_temp != null ? Number(item.room_temp) : null,
      room_rh: item.room_rh != null ? Number(item.room_rh) : null,
      light_lux: item.light_lux != null ? Number(item.light_lux) : null,
      temp_trend_5m: item.temp_trend_5m != null ? Number(item.temp_trend_5m) : null,
      thermal_state: item.thermal_state || '-',
      light_state: item.light_state || '-',
      source: 'InfluxDB'
    }));

    const combined = [...existingLive, ...formattedInflux];
    combined.sort((a, b) => new Date(b.time) - new Date(a.time));

    this.records = combined.slice(0, this.maxRecords);
    this.render();
  }

  flashSyncDot() {
    if (!this.syncDot) return;
    this.syncDot.classList.add('flash');
    setTimeout(() => {
      this.syncDot.classList.remove('flash');
    }, 400);
  }

  formatTimestamp(isoString) {
    if (!isoString) return '--:--:--';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit'
      }) + ' ' + d.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
    } catch (e) {
      return isoString;
    }
  }

  render() {
    if (!this.tableBody) return;

    if (this.records.length === 0) {
      this.tableBody.innerHTML = `
        <tr class="empty-row">
          <td colspan="10" style="text-align: center; padding: 24px; color: #6e7681;">
            Waiting for telemetry data from InfluxDB or MQTT...
          </td>
        </tr>
      `;
      if (this.rowCountEl) this.rowCountEl.textContent = '0 Records';
      return;
    }

    const rowsHtml = this.records.map((r, idx) => {
      const tempStr = r.room_temp != null ? `${r.room_temp.toFixed(1)} °C` : '--';
      const rhStr = r.room_rh != null ? `${r.room_rh.toFixed(1)} %` : '--';
      const luxStr = r.light_lux != null ? `${r.light_lux.toFixed(1)} Lux` : '--';
      const trendStr = r.temp_trend_5m != null ? `${r.temp_trend_5m > 0 ? '+' : ''}${r.temp_trend_5m.toFixed(2)} °C` : '--';
      
      const thermalClass = `badge state-${(r.thermal_state || '').toLowerCase()}`;
      const lightClass = `badge badge-light-${(r.light_state || '').toLowerCase()}`;
      const sourceClass = r.source === 'MQTT Live' ? 'source-mqtt' : 'source-influx';

      return `
        <tr class="${idx === 0 && r.source === 'MQTT Live' ? 'new-row' : ''}">
          <td class="col-num">${idx + 1}</td>
          <td class="col-time font-mono">${this.formatTimestamp(r.time)}</td>
          <td class="col-seq font-mono">#${r.seq}</td>
          <td class="col-val font-mono">${tempStr}</td>
          <td class="col-val font-mono">${rhStr}</td>
          <td class="col-val font-mono">${luxStr}</td>
          <td class="col-trend font-mono">${trendStr}</td>
          <td><span class="${thermalClass}">${r.thermal_state}</span></td>
          <td><span class="${lightClass}">${r.light_state}</span></td>
          <td><span class="source-badge ${sourceClass}">${r.source}</span></td>
        </tr>
      `;
    }).join('');

    this.tableBody.innerHTML = rowsHtml;

    if (this.rowCountEl) {
      this.rowCountEl.textContent = `${this.records.length} Records`;
    }

    if (this.lastUpdatedEl) {
      const now = new Date();
      this.lastUpdatedEl.textContent = `Updated: ${now.toLocaleTimeString('en-US', { hour12: false })}`;
    }
  }

  exportCsv() {
    if (this.records.length === 0) {
      return;
    }

    const headers = ['No', 'Timestamp', 'Sequence', 'Temperature (°C)', 'Humidity (%)', 'Light (Lux)', 'Temp Trend 5m (°C)', 'Thermal State', 'Light State', 'Source'];
    const csvRows = [headers.join(',')];

    this.records.forEach((r, idx) => {
      const row = [
        idx + 1,
        `"${r.time || ''}"`,
        r.seq ?? '',
        r.room_temp ?? '',
        r.room_rh ?? '',
        r.light_lux ?? '',
        r.temp_trend_5m ?? '',
        `"${r.thermal_state || ''}"`,
        `"${r.light_state || ''}"`,
        `"${r.source || ''}"`
      ];
      csvRows.push(row.join(','));
    });

    const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(csvBlob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `digidaw_telemetry_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}
