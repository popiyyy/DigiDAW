const INFLUX_CONFIG = {
  url: window.INFLUX_URL || 'http://localhost:8086',
  org: window.INFLUX_ORG || 'digidaw-org',
  bucket: window.INFLUX_BUCKET || 'room_telemetry',
  token: window.INFLUX_TOKEN || 'digidaw-super-secret-token'
};

/**
 * Fetch telemetry history from InfluxDB Flux API
 * @param {string} rangeWindow - Flux range duration e.g. '-15m', '-1h', '-6h', '-24h'
 * @returns {Promise<Array<{time: string, seq: number, room_temp: number, room_rh: number, light_lux: number, temp_trend_5m: number, thermal_state: string, light_state: string}>>}
 */
export async function fetchTelemetryHistory(rangeWindow = '-1h') {
  // Query with pivot so all fields per timestamp are joined into single rows
  const query = `
    from(bucket: "${INFLUX_CONFIG.bucket}")
      |> range(start: ${rangeWindow})
      |> filter(fn: (r) => r._measurement == "room_telemetry")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 100)
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
 * Supports both pivoted rows and unpivoted multiple field rows.
 * @param {string} csvText
 * @returns {Array<Object>}
 */
function parseFluxCsv(csvText) {
  if (!csvText || !csvText.trim()) return [];

  const lines = csvText.trim().split('\n');
  const records = [];
  let headerMap = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue; // Skip comments and metadata

    const cols = trimmed.split(',').map(c => c.trim().replace(/^"|"$/g, ''));

    // Check if this row is the table header row
    if (cols.includes('_time') || cols.includes('_field') || cols.includes('table')) {
      headerMap = {};
      cols.forEach((colName, idx) => {
        if (colName) headerMap[colName] = idx;
      });
      continue;
    }

    if (!headerMap) continue;

    // Extract time
    const timeIdx = headerMap['_time'];
    const time = timeIdx !== undefined ? cols[timeIdx] : null;
    if (!time) continue;

    // Check if it's a pivoted record (cols have room_temp, etc.)
    const record = {
      time,
      seq: headerMap['seq'] !== undefined ? parseInt(cols[headerMap['seq']], 10) : undefined,
      room_temp: headerMap['room_temp'] !== undefined ? parseFloat(cols[headerMap['room_temp']]) : null,
      room_rh: headerMap['room_rh'] !== undefined ? parseFloat(cols[headerMap['room_rh']]) : null,
      light_lux: headerMap['light_lux'] !== undefined ? parseFloat(cols[headerMap['light_lux']]) : null,
      temp_trend_5m: headerMap['temp_trend_5m'] !== undefined ? parseFloat(cols[headerMap['temp_trend_5m']]) : null,
      thermal_state: headerMap['thermal_state'] !== undefined ? cols[headerMap['thermal_state']] : null,
      light_state: headerMap['light_state'] !== undefined ? cols[headerMap['light_state']] : null
    };

    // If unpivoted fallback (has _field and _value)
    if (headerMap['_field'] !== undefined && headerMap['_value'] !== undefined) {
      const field = cols[headerMap['_field']];
      const val = cols[headerMap['_value']];
      
      let existing = records.find(r => r.time === time);
      if (!existing) {
        existing = { time, seq: '-', room_temp: null, room_rh: null, light_lux: null, temp_trend_5m: null, thermal_state: '-', light_state: '-' };
        records.push(existing);
      }
      if (field && val !== undefined) {
        const numVal = parseFloat(val);
        existing[field] = isNaN(numVal) ? val : numVal;
      }
    } else {
      records.push(record);
    }
  }

  return records;
}
