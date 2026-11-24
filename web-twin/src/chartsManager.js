/**
 * ChartsManager - Manages real-time temperature and light charts on the right side
 * Clean & minimal design, English localization.
 */
export class ChartsManager {
  constructor(options = {}) {
    this.tempCanvasId = options.tempCanvasId || 'chart-temp';
    this.lightCanvasId = options.lightCanvasId || 'chart-light';
    this.maxPoints = options.maxPoints || 25;

    this.tempBadge = document.getElementById('chart-val-temp');
    this.lightBadge = document.getElementById('chart-val-light');

    this.tempChart = null;
    this.lightChart = null;

    this.init();
  }

  init() {
    if (typeof Chart === 'undefined') {
      console.error('[ChartsManager] Chart.js is not loaded.');
      return;
    }

    const tempCanvas = document.getElementById(this.tempCanvasId);
    const lightCanvas = document.getElementById(this.lightCanvasId);

    if (tempCanvas) {
      this.tempChart = new Chart(tempCanvas, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Temperature',
            data: [],
            borderColor: '#38bdf8',
            backgroundColor: 'rgba(56, 189, 248, 0.06)',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#38bdf8',
            fill: true,
            tension: 0.25
          }]
        },
        options: this.getBaseChartOptions('°C')
      });
    }

    if (lightCanvas) {
      this.lightChart = new Chart(lightCanvas, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Light',
            data: [],
            borderColor: '#fbbf24',
            backgroundColor: 'rgba(251, 191, 36, 0.06)',
            borderWidth: 1.5,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#fbbf24',
            fill: true,
            tension: 0.25
          }]
        },
        options: this.getBaseChartOptions('Lux')
      });
    }
  }

  getBaseChartOptions(unit) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#11141c',
          titleColor: '#94a3b8',
          bodyColor: '#f8fafc',
          borderColor: '#262c3a',
          borderWidth: 1,
          padding: 8,
          boxPadding: 4,
          cornerRadius: 4,
          displayColors: false,
          callbacks: {
            label: (ctx) => ` ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) : '--'} ${unit}`
          }
        }
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(255, 255, 255, 0.03)',
            drawBorder: false
          },
          ticks: {
            color: '#64748b',
            font: { size: 9, family: 'monospace' },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 5
          }
        },
        y: {
          grid: {
            color: 'rgba(255, 255, 255, 0.03)',
            drawBorder: false
          },
          ticks: {
            color: '#64748b',
            font: { size: 9, family: 'monospace' },
            callback: (val) => `${val}`
          }
        }
      }
    };
  }

  formatTimeLabel(timeStr) {
    if (!timeStr) return '';
    try {
      const d = new Date(timeStr);
      if (isNaN(d.getTime())) return timeStr.slice(-8);
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    } catch (e) {
      return '';
    }
  }

  addLivePoint(data) {
    if (!data) return;

    const label = this.formatTimeLabel(data.time || new Date().toISOString());

    if (data.room_temp != null && this.tempChart) {
      const tempVal = Number(data.room_temp);
      const labels = this.tempChart.data.labels;
      const dataset = this.tempChart.data.datasets[0].data;

      labels.push(label);
      dataset.push(tempVal);

      if (labels.length > this.maxPoints) {
        labels.shift();
        dataset.shift();
      }
      this.tempChart.update('none');

      if (this.tempBadge) {
        this.tempBadge.textContent = `${tempVal.toFixed(1)} °C`;
      }
    }

    if (data.light_lux != null && this.lightChart) {
      const luxVal = Number(data.light_lux);
      const labels = this.lightChart.data.labels;
      const dataset = this.lightChart.data.datasets[0].data;

      labels.push(label);
      dataset.push(luxVal);

      if (labels.length > this.maxPoints) {
        labels.shift();
        dataset.shift();
      }
      this.lightChart.update('none');

      if (this.lightBadge) {
        this.lightBadge.textContent = `${luxVal.toFixed(1)} Lux`;
      }
    }
  }

  loadHistory(records) {
    if (!Array.isArray(records) || records.length === 0) return;

    const validRecords = records
      .filter(r => r.time && (r.room_temp != null || r.light_lux != null))
      .sort((a, b) => new Date(a.time) - new Date(b.time));

    if (validRecords.length === 0) return;

    const sliceData = validRecords.slice(-this.maxPoints);

    if (this.tempChart) {
      this.tempChart.data.labels = sliceData.map(r => this.formatTimeLabel(r.time));
      this.tempChart.data.datasets[0].data = sliceData.map(r => r.room_temp != null ? Number(r.room_temp) : null);
      this.tempChart.update();

      const lastTemp = sliceData[sliceData.length - 1]?.room_temp;
      if (this.tempBadge && lastTemp != null) {
        this.tempBadge.textContent = `${Number(lastTemp).toFixed(1)} °C`;
      }
    }

    if (this.lightChart) {
      this.lightChart.data.labels = sliceData.map(r => this.formatTimeLabel(r.time));
      this.lightChart.data.datasets[0].data = sliceData.map(r => r.light_lux != null ? Number(r.light_lux) : null);
      this.lightChart.update();

      const lastLux = sliceData[sliceData.length - 1]?.light_lux;
      if (this.lightBadge && lastLux != null) {
        this.lightBadge.textContent = `${Number(lastLux).toFixed(1)} Lux`;
      }
    }
  }
}
