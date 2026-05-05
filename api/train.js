export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { tren, data } = req.query;
  if (!tren) return res.status(400).json({ error: 'Lipseste numarul trenului' });

  const today = new Date();
  const dateStr = data || `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;

  // Format date as DD.MM.YYYY for infofer
  const [year, month, day] = dateStr.split('-');
  const dateInforfer = `${day}.${month}.${year}`;

  try {
    // Step 1: GET the page to get VIEWSTATE tokens
    const pageUrl = `http://appiris.infofer.ro/MyTrainRO.aspx`;
    const initResp = await fetch(pageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!initResp.ok) throw new Error(`Init page failed: ${initResp.status}`);
    const initHtml = await initResp.text();
    const cookies = initResp.headers.get('set-cookie') || '';

    // Extract VIEWSTATE, VIEWSTATEGENERATOR, EVENTVALIDATION
    const viewstate = extractInput(initHtml, '__VIEWSTATE');
    const viewstateGen = extractInput(initHtml, '__VIEWSTATEGENERATOR');
    const eventVal = extractInput(initHtml, '__EVENTVALIDATION');

    if (!viewstate) throw new Error('Nu s-a putut extrage VIEWSTATE');

    // Step 2: POST with train number and date
    const formData = new URLSearchParams({
      '__VIEWSTATE': viewstate,
      '__VIEWSTATEGENERATOR': viewstateGen || '',
      '__EVENTVALIDATION': eventVal || '',
      'ctl00$ContentPlaceHolder1$txtTren': tren,
      'ctl00$ContentPlaceHolder1$txtData': dateInforfer,
      'ctl00$ContentPlaceHolder1$btnCauta': 'Cauta',
    });

    const postResp = await fetch(pageUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': pageUrl,
        'Cookie': cookies,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(10000),
    });

    if (!postResp.ok) throw new Error(`POST failed: ${postResp.status}`);
    const html = await postResp.text();

    // Step 3: Parse the HTML table for stations
    const stops = parseIRISStops(html);

    if (!stops || stops.length === 0) {
      return res.status(404).json({ ok: false, error: `Trenul ${tren} nu a fost gasit pentru data ${dateStr}` });
    }

    return res.status(200).json({ ok: true, tren, data: dateStr, stops });

  } catch(e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}

function extractInput(html, name) {
  const re = new RegExp(`id="${name}"[^>]*value="([^"]*)"`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  // alternate format
  const re2 = new RegExp(`name="${name}"[^>]*value="([^"]*)"`, 'i');
  const m2 = html.match(re2);
  return m2 ? m2[1] : '';
}

function parseIRISStops(html) {
  const stops = [];

  // IRIS table rows — each station row has class "OddRow" or "EvenRow"
  // Pattern: <td>StationName</td><td>km</td><td>arr</td><td>dep</td>
  const rowRe = /<tr[^>]*class="(?:OddRow|EvenRow|odd|even|GridRow|DataRow)[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;

  while ((rowMatch = rowRe.exec(html)) !== null) {
    const row = rowMatch[1];
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(row)) !== null) {
      cells.push(stripTags(cellMatch[1]).trim());
    }
    if (cells.length >= 3 && cells[0]) {
      stops.push({
        name: cells[0],
        km:   parseFloat(cells[1]) || 0,
        arr:  fmtTime(cells[2] || ''),
        dep:  fmtTime(cells[3] || cells[2] || ''),
      });
    }
  }

  if (stops.length > 0) return stops;

  // Fallback: generic table parsing
  const tableRe = /<table[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const tableHtml = tableMatch[1];
    const rows = [];
    const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let tr;
    while ((tr = trRe.exec(tableHtml)) !== null) {
      const cells = [];
      const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
      let td;
      while ((td = tdRe.exec(tr[1])) !== null) {
        cells.push(stripTags(td[1]).trim());
      }
      if (cells.length >= 2 && cells[0] && /[A-ZĂÂÎȘȚa-z]/.test(cells[0])) {
        rows.push(cells);
      }
    }
    if (rows.length >= 3) {
      return rows.map(cells => ({
        name: cells[0],
        km:   parseFloat(cells[1]) || 0,
        arr:  fmtTime(cells[2] || ''),
        dep:  fmtTime(cells[3] || cells[2] || ''),
      }));
    }
  }

  return null;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
}

function fmtTime(t) {
  if (!t) return '';
  const m = t.match(/(\d{1,2}):(\d{2})/);
  if (m) return m[1].padStart(2,'0') + ':' + m[2];
  return '';
}
