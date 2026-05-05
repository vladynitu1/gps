export default async function handler(req, res) {
  // Allow all origins (your GitHub Pages app)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { tren, data } = req.query;
  if (!tren) return res.status(400).json({ error: 'Lipseste numarul trenului' });

  // Date today if not provided
  const today = new Date();
  const dateStr = data || `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // Try multiple infofer endpoints
  const endpoints = [
    `https://mersultrenurilor.infofer.ro/api/Itineraries?trainNumber=${tren}&date=${dateStr}`,
    `https://mersultrenurilor.infofer.ro/api/trains/${tren}/itinerary?date=${dateStr}`,
    `https://mersultrenurilor.infofer.ro/api/v1/trains/${tren}?date=${dateStr}`,
  ];

  for (const url of endpoints) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TrainNav/1.0)',
          'Accept': 'application/json, text/html, */*',
          'Referer': 'https://mersultrenurilor.infofer.ro/',
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!r.ok) continue;
      const text = await r.text();
      if (!text || text.length < 10) continue;

      // Try to parse as JSON
      try {
        const json = JSON.parse(text);
        const stops = extractStops(json);
        if (stops && stops.length > 0) {
          return res.status(200).json({ ok: true, tren, data: dateStr, stops });
        }
      } catch(e) {
        // Try to parse HTML
        const stops = parseHTML(text, tren);
        if (stops && stops.length > 0) {
          return res.status(200).json({ ok: true, tren, data: dateStr, stops });
        }
      }
    } catch(e) {
      continue;
    }
  }

  // Nothing found
  return res.status(404).json({ ok: false, error: `Trenul ${tren} nu a fost gasit pentru data ${dateStr}` });
}

function extractStops(data) {
  if (!data) return null;
  // Search recursively for stops array
  if (Array.isArray(data)) {
    if (data.length && (data[0].stationName || data[0].StationName || data[0].denumire)) return normalizeStops(data);
    for (const item of data) {
      const r = extractStops(item);
      if (r) return r;
    }
  } else if (typeof data === 'object') {
    for (const key of ['stops','Stops','statii','opriri','itinerary','stations']) {
      if (data[key] && Array.isArray(data[key]) && data[key].length) {
        const r = extractStops(data[key]);
        if (r) return r;
      }
    }
    for (const val of Object.values(data)) {
      if (typeof val === 'object') {
        const r = extractStops(val);
        if (r) return r;
      }
    }
  }
  return null;
}

function normalizeStops(stops) {
  return stops.map(s => ({
    name: s.stationName || s.StationName || s.denumire || s.name || s.Name || '',
    km:   parseFloat(s.km || s.Km || s.distanta || 0) || 0,
    arr:  fmtTime(s.arrivalTime || s.ArrivalTime || s.sosire || s.arrival || ''),
    dep:  fmtTime(s.departureTime || s.DepartureTime || s.plecare || s.departure || ''),
  })).filter(s => s.name);
}

function fmtTime(t) {
  if (!t) return '';
  if (typeof t === 'string') {
    const m = t.match(/(\d{1,2}):(\d{2})/);
    if (m) return m[1].padStart(2,'0') + ':' + m[2];
    const d = new Date(t);
    if (!isNaN(d)) return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  if (typeof t === 'number') {
    return String(Math.floor(t/60)).padStart(2,'0') + ':' + String(t%60).padStart(2,'0');
  }
  return '';
}

function parseHTML(html, tren) {
  // Extract JSON from embedded scripts
  const scriptRe = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptRe.exec(html)) !== null) {
    const txt = m[1];
    if (!txt.includes('stationName') && !txt.includes('denumire') && !txt.includes('stops')) continue;
    const arrRe = /(\[[\s\S]*?"(?:stationName|StationName|denumire)"[\s\S]*?\])/g;
    let am;
    while ((am = arrRe.exec(txt)) !== null) {
      try {
        const arr = JSON.parse(am[1]);
        const stops = normalizeStops(arr);
        if (stops.length > 0) return stops;
      } catch(e) {}
    }
  }
  return null;
}
