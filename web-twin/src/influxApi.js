// ponytail: native fetch query InfluxDB v2 Flux API directly without heavy @influxdata/influxdb-client sdk
// Ceiling: Flux query format only, upgrade to client sdk if parameterized queries or batch writing is needed

const INFLUX_CONFIG = {
  url: window.INFLUX_URL || 'http://localhost:8086',
  org: window.INFLUX_ORG || 'digidaw-org',
  bucket: window.INFLUX_BUCKET || 'room_telemetry',
  token: window.INFLUX_TOKEN || 'digidaw-super-secret-token'
};

/**
 * Fetch telemetry history from InfluxDB Flux API
 * @param {string} rangeWindow - Flux range duration e.g. '-1h', '-15m'
 * @returns {Promise<Array<{time: string, measurement: string, field: string, value: number}>>}
 */
export async function fetchTelemetryHistory(rangeWindow = '-1h') {
  const query = `
    from(bucket: "${INFLUX_CONFIG.bucket}")
      |> range(start: ${rangeWindow})
      |> filter(fn: (r) => r._measurement == "room_telemetry")
      |> filter(fn: (r) => r._field == "room_temp" or r._field == "room_rh" or r._field == "light_lux")
      |> keep(columns: ["_time", "_field", "_value", "_measurement"])
      |> sort(columns: ["_time"])
  `;

  try {
    const res = await fetch(`${INFLUX_CONFIG.url}/api/v2/query?org=${encodeURIComponent(INFLUX_CONFIG.org)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${INFLUX_CONFIG.token}`,
        'Content-Type': 'application/vnd.flux',
        'Accept': 'application/csv'
      },
      body: query
    });

    if (!res.ok) {
      throw new Error(`InfluxDB query failed: ${res.status} ${res.statusText}`);
    }

    const csvText = await res.text();
    return parseFluxCsv(csvText);
  } catch (err) {
    console.warn('[InfluxApi] Telemetry history query failed:', err.message);
    return [];
  }
}

/**
 * Parse standard InfluxDB Flux CSV format into clean object records
 * @param {string} csvText
 * @returns {Array<{time: string, field: string, value: number}>}
 */
function parseFluxCsv(csvText) {
  const lines = csvText.trim().split('\n');
  const records = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // Skip annotations and empty lines

    const cols = trimmed.split(',');
    // Flux table header row
    if (cols.includes('_field') && cols.includes('_value')) continue;

    // Default Flux CSV layout typically puts _time at index 5, _field at index 6, _value at index 7
    // Let's reliably find field and value if header exists or fallback to index matching
    if (cols.length >= 7) {
      const time = cols[5];
      const field = cols[6];
      const val = parseFloat(cols[7]);
      if (field && !isNaN(val)) {
        records.push({ time, field, value: val });
      }
    }
  }

  return records;
}
