// Strategia: cautam trenul in XML cu streaming, oprim imediat ce l-am gasit
// Nu asteptam sa se descarce tot fisierul (zeci de MB)

const XML_SOURCES = [
  'https://data.gov.ro/dataset/c4f71dbb-de39-49b2-b697-5b60a5f299a2/resource/0f67143e-bb88-4a06-8e7a-b35b1eb91329/download/trenuri-2025-2026_sntfc.xml',
  'https://data.gov.ro/dataset/1da1018d-df38-4b5f-9667-88e4521abfb3/resource/b752e8bb-2701-4214-ba51-4a7948b2e217/download/s.c.-regio-calatori-s.r.l_271-trenuri_2025.xml',
  'https://data.gov.ro/dataset/b4e2ce0b-6935-44b1-8e9d-f3999123358a/resource/1a083cf5-d37c-4618-aeb8-3f1ba0dd22dc/download/trenuri-2025-2026_interregional-calatori.xml',
];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { tren } = req.query;
  if (!tren) return res.status(400).json({ error: 'Lipseste numarul trenului' });

  const trainNo = tren.trim();

  for (const url of XML_SOURCES) {
    try {
      const stops = await searchTrainInStream(url, trainNo);
      if (stops && stops.length > 0) {
        return res.status(200).json({ ok: true, tren: trainNo, stops });
      }
    } catch (e) {
      // next source
    }
  }

  return res.status(404).json({ ok: false, error: `Trenul ${trainNo} nu a fost gasit` });
}

async function searchTrainInStream(url, trainNo) {
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TrainNav/1.0)',
      'Accept': 'text/xml,application/xml,*/*',
    },
    signal: AbortSignal.timeout(50000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);

  const reader = r.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let found = false;
  let result = null;

  // Markers we look for
  const openMarkers = [
    `Numar="${trainNo}"`,
    `Numar='${trainNo}'`,
    `Number="${trainNo}"`,
    `Number='${trainNo}'`,
    `numar="${trainNo}"`,
  ];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Keep buffer manageable - only keep last 500KB + new chunk
      if (buffer.length > 600000) {
        // But first check if we're mid-train-block
        if (!found) {
          buffer = buffer.slice(-100000);
        }
      }

      if (!found) {
        // Check if our train number appears in the buffer
        const hasMarker = openMarkers.some(m => buffer.includes(m));
        if (hasMarker) {
          found = true;
        }
      }

      if (found) {
        // Try to extract the complete train block
        result = tryExtractTrain(buffer, trainNo);
        if (result !== null) {
          // Got it, stop reading
          break;
        }
        // Block not complete yet, keep reading
        if (buffer.length > 2000000) break; // safety limit
      }
    }
  } finally {
    reader.cancel();
  }

  if (!result && found) {
    // Try one more time with whatever we have
    result = tryExtractTrain(buffer, trainNo);
  }

  return result;
}

function tryExtractTrain(xml, trainNo) {
  // Find train block boundaries
  const patterns = [
    new RegExp(`(<Tren[^>]+Numar=["']${trainNo}["'][^>]*>[\\s\\S]*?</Tren>)`),
    new RegExp(`(<Train[^>]+Number=["']${trainNo}["'][^>]*>[\\s\\S]*?</Train>)`),
    new RegExp(`(<tren[^>]+numar=["']${trainNo}["'][^>]*>[\\s\\S]*?</tren>)`),
    new RegExp(`(<Tren[^>]*>[\\s\\S]*?<Numar[^>]*>${trainNo}</Numar>[\\s\\S]*?</Tren>)`),
  ];

  let trainBlock = null;
  for (const pat of patterns) {
    const m = xml.match(pat);
    if (m) { trainBlock = m[1]; break; }
  }
  if (!trainBlock) return null;

  return extractStops(trainBlock);
}

function extractStops(trainBlock) {
  const stops = [];

  // Self-closing: <Statie Nume="..." Km="..." Sosire="..." Plecare="..."/>
  const self = /<(?:Statie|Station|Oprire|Halt)\s+[^>]*\/>/gi;
  let m;
  while ((m = self.exec(trainBlock)) !== null) {
    const s = parseAttrs(m[0]);
    if (s.name) stops.push(s);
  }
  if (stops.length > 0) return stops;

  // Nested: <Statie>...</Statie>
  const nested = /<(?:Statie|Station|Oprire|Halt)[^>]*>([\s\S]*?)<\/(?:Statie|Station|Oprire|Halt)>/gi;
  while ((m = nested.exec(trainBlock)) !== null) {
    const s = parseNested(m[1]);
    if (s.name) stops.push(s);
  }
  return stops.length > 0 ? stops : null;
}

function parseAttrs(tag) {
  return {
    name: ga(tag, 'Nume') || ga(tag, 'Name') || ga(tag, 'Denumire') || '',
    km:   parseFloat(ga(tag, 'Km') || '0') || 0,
    arr:  fmtTime(ga(tag, 'Sosire') || ga(tag, 'SosirePlanificata') || ga(tag, 'Arrival') || ''),
    dep:  fmtTime(ga(tag, 'Plecare') || ga(tag, 'PlecarePlanificata') || ga(tag, 'Departure') || ''),
  };
}

function parseNested(block) {
  return {
    name: gv(block, 'Nume') || gv(block, 'Denumire') || gv(block, 'Name') || '',
    km:   parseFloat(gv(block, 'Km') || '0') || 0,
    arr:  fmtTime(gv(block, 'Sosire') || gv(block, 'SosirePlanificata') || gv(block, 'Arrival') || ''),
    dep:  fmtTime(gv(block, 'Plecare') || gv(block, 'PlecarePlanificata') || gv(block, 'Departure') || ''),
  };
}

function ga(tag, name) {
  const m = tag.match(new RegExp(`${name}=["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : '';
}

function gv(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function fmtTime(t) {
  if (!t) return '';
  const m = t.match(/(\d{1,2})[:\s](\d{2})/);
  if (m) return m[1].padStart(2, '0') + ':' + m[2];
  const n = parseInt(t);
  if (!isNaN(n) && n > 0 && n < 1440)
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  return '';
}
