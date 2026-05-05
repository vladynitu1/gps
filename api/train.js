// XML sources from data.gov.ro - public, no IP blocking
const XML_SOURCES = [
  {
    name: 'CFR Calatori',
    url: 'https://data.gov.ro/dataset/c4f71dbb-de39-49b2-b697-5b60a5f299a2/resource/0f67143e-bb88-4a06-8e7a-b35b1eb91329/download/trenuri-2025-2026_sntfc.xml',
  },
  {
    name: 'Regio Calatori',
    url: 'https://data.gov.ro/dataset/1da1018d-df38-4b5f-9667-88e4521abfb3/resource/b752e8bb-2701-4214-ba51-4a7948b2e217/download/s.c.-regio-calatori-s.r.l_271-trenuri_2025.xml',
  },
  {
    name: 'Interregional Calatori',
    url: 'https://data.gov.ro/dataset/b4e2ce0b-6935-44b1-8e9d-f3999123358a/resource/1a083cf5-d37c-4618-aeb8-3f1ba0dd22dc/download/trenuri-2025-2026_interregional-calatori.xml',
  },
];

const cache = {};
const CACHE_TTL = 6 * 60 * 60 * 1000;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { tren } = req.query;
  if (!tren) return res.status(400).json({ error: 'Lipseste numarul trenului' });

  const trainNo = tren.trim();

  for (const source of XML_SOURCES) {
    try {
      const xml = await fetchXML(source.url);
      const stops = parseTrainFromXML(xml, trainNo);
      if (stops && stops.length > 0) {
        return res.status(200).json({ ok: true, tren: trainNo, operator: source.name, stops });
      }
    } catch (e) {
      continue;
    }
  }

  return res.status(404).json({ ok: false, error: `Trenul ${trainNo} nu a fost gasit` });
}

async function fetchXML(url) {
  const now = Date.now();
  if (cache[url] && (now - cache[url].ts) < CACHE_TTL) {
    return cache[url].data;
  }
  const r = await fetch(url, {
    headers: { 'Accept': 'application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const text = await r.text();
  cache[url] = { data: text, ts: now };
  return text;
}

function parseTrainFromXML(xml, trainNo) {
  // Try attribute-based: <Tren Numar="10223" ...>
  let trainBlock = null;
  const pats = [
    new RegExp(`<Tren[^>]+Numar=["']${trainNo}["'][^>]*>[\\s\\S]*?</Tren>`, 'i'),
    new RegExp(`<Train[^>]+Number=["']${trainNo}["'][^>]*>[\\s\\S]*?</Train>`, 'i'),
    new RegExp(`<Tren[^>]*>[\\s\\S]*?<Numar[^>]*>${trainNo}</Numar>[\\s\\S]*?</Tren>`, 'i'),
  ];
  for (const pat of pats) {
    const m = xml.match(pat);
    if (m) { trainBlock = m[0]; break; }
  }
  if (!trainBlock) return null;

  const stops = [];

  // Try self-closing attribute tags: <Statie Nume="..." Km="..." Sosire="..." Plecare="..."/>
  const selfClose = /<(?:Statie|Station|Oprire|Halt)\s[^>]*\/>/gi;
  let m;
  while ((m = selfClose.exec(trainBlock)) !== null) {
    const tag = m[0];
    const stop = {
      name: attr(tag, 'Nume') || attr(tag, 'Name') || attr(tag, 'Denumire') || '',
      km:   parseFloat(attr(tag, 'Km') || '0') || 0,
      arr:  fmtTime(attr(tag, 'Sosire') || attr(tag, 'SosirePlanificata') || attr(tag, 'Arrival') || ''),
      dep:  fmtTime(attr(tag, 'Plecare') || attr(tag, 'PlecarePlanificata') || attr(tag, 'Departure') || ''),
    };
    if (stop.name) stops.push(stop);
  }
  if (stops.length > 0) return stops;

  // Try nested element tags: <Statie><Nume>...</Nume>...</Statie>
  const nested = /<(?:Statie|Station|Oprire|Halt)[^>]*>([\s\S]*?)<\/(?:Statie|Station|Oprire|Halt)>/gi;
  while ((m = nested.exec(trainBlock)) !== null) {
    const block = m[1];
    const stop = {
      name: tagVal(block, 'Nume') || tagVal(block, 'Denumire') || tagVal(block, 'Name') || '',
      km:   parseFloat(tagVal(block, 'Km') || '0') || 0,
      arr:  fmtTime(tagVal(block, 'Sosire') || tagVal(block, 'SosirePlanificata') || tagVal(block, 'Arrival') || ''),
      dep:  fmtTime(tagVal(block, 'Plecare') || tagVal(block, 'PlecarePlanificata') || tagVal(block, 'Departure') || ''),
    };
    if (stop.name) stops.push(stop);
  }
  return stops.length > 0 ? stops : null;
}

function tagVal(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

function attr(tag, name) {
  const re = new RegExp(`${name}=["']([^"']*)["']`, 'i');
  const m = tag.match(re);
  return m ? m[1].trim() : '';
}

function fmtTime(t) {
  if (!t) return '';
  const m = t.match(/(\d{1,2})[:\s](\d{2})/);
  if (m) return m[1].padStart(2, '0') + ':' + m[2];
  const n = parseInt(t);
  if (!isNaN(n) && n > 0 && n < 1440) {
    return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');
  }
  return '';
}
