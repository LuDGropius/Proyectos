/* ============================================================
   EVEREST DEATHS — loader.js
   Reemplaza data.js. Carga los datos en este orden:
     1. approved-victims.json (caché local, rápido)
     2. Si falla, llama a la API de Wikipedia y parsea el wikitext
        con el mismo algoritmo que sync-wikipedia.php, pero en JS.
   En ambos casos expone window.VICTIMS_DATA antes de que
   main.js lo necesite (loader.js es async, main.js espera el
   evento 'victimsReady' que este archivo dispara al terminar).
   ============================================================ */

const WIKI_API =
  'https://en.wikipedia.org/w/api.php' +
  '?action=parse&page=List_of_people_who_died_climbing_Mount_Everest' +
  '&prop=wikitext&format=json&origin=*'; // origin=* habilita CORS

const EVEREST_TOP  = 8849;
const EVEREST_BASE = 5364;

/* ---- Utilidades de limpieza de wikitext -------------------- */

function cleanWiki(text) {
  if (!text) return '';
  text = text.replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, '$1'); // [[A|B]] -> B
  text = text.replace(/\[\[([^\]]*)\]\]/g, '$1');           // [[A]] -> A
  text = text.replace(/'''?/g, '');
  text = text.replace(/<br\s*\/?>/gi, '; ');
  return text.trim();
}

/* ---- Parser de wikitext con rowspan/colspan ---------------- */

function parseWikitextTable(wikitext) {
  // Limpiar refs y notas ANTES del split para que su contenido
  // (que puede incluir "|") no rompa la división de celdas.
  wikitext = wikitext.replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '');
  wikitext = wikitext.replace(/<ref[^>]*\/>/g, '');
  wikitext = wikitext.replace(/\{\{efn[\s\S]*?\}\}/g, '');

  // Quitar el cierre de tabla para que no quede pegado al último valor.
  wikitext = wikitext.replace(/\n\|\}\s*$/, '').trimEnd();

  // Dividir por "|-" (con posibles atributos como style="...")
  const rawRows = wikitext.split(/\n\|-[^\n]*\n?/);

  const rows = [];
  const rowspanMemory = {}; // { colIndex: { value, remaining } }

  for (const rawRow of rawRows) {
    const trimmed = rawRow.trim();
    if (!trimmed || trimmed.startsWith('{|') || trimmed.startsWith('|}')) continue;
    if (trimmed.startsWith('!')) continue; // encabezados

    const line = trimmed.replace(/^\|\s*/, '');
    const rawCells = line.split('||');

    const finalRow = {};
    let cellIndex = 0;
    const newRowspans = {};

    for (const rawCell of rawCells) {
      // Insertar celdas heredadas de rowspan antes de la celda real.
      while (rowspanMemory[cellIndex] && rowspanMemory[cellIndex].remaining > 0) {
        finalRow[cellIndex] = rowspanMemory[cellIndex].value;
        rowspanMemory[cellIndex].remaining--;
        cellIndex++;
      }

      let cell = rawCell.trim();
      let rowspan = 1;
      let colspan = 1;

      // Detectar atributos: rowspan="N" colspan="N" | contenido
      const attrMatch = cell.match(/^((?:(?:rowspan|colspan)\s*=\s*"?\d+"?\s*)+)\|\s*([\s\S]*)$/);
      if (attrMatch) {
        const attrs = attrMatch[1];
        cell = attrMatch[2].trim();
        const rsm = attrs.match(/rowspan\s*=\s*"?(\d+)"?/);
        const csm = attrs.match(/colspan\s*=\s*"?(\d+)"?/);
        if (rsm) rowspan = parseInt(rsm[1], 10);
        if (csm) colspan = parseInt(csm[1], 10);
      }

      for (let c = 0; c < colspan; c++) {
        if (rowspan > 1) {
          newRowspans[cellIndex] = { value: cell, remaining: rowspan - 1 };
        }
        finalRow[cellIndex] = cell;
        cellIndex++;
      }
    }

    // Rellenar rowspans pendientes al final de la fila.
    while (rowspanMemory[cellIndex] && rowspanMemory[cellIndex].remaining > 0) {
      finalRow[cellIndex] = rowspanMemory[cellIndex].value;
      rowspanMemory[cellIndex].remaining--;
      cellIndex++;
    }

    Object.assign(rowspanMemory, newRowspans);

    const sorted = Object.keys(finalRow).map(Number).sort((a, b) => a - b);
    rows.push(sorted.map(k => finalRow[k]));
  }

  return rows;
}

/* ---- Extraer la tabla principal del wikitext completo ------ */

function extractMainTable(wikitext) {
  const start = wikitext.indexOf('{|');
  if (start === -1) throw new Error('No se encontró ninguna tabla en el wikitext.');

  let depth = 0, pos = start, end = null;
  while (pos < wikitext.length) {
    const two = wikitext.slice(pos, pos + 2);
    if (two === '{|') { depth++; pos += 2; }
    else if (two === '|}') { depth--; pos += 2; if (depth === 0) { end = pos; break; } }
    else pos++;
  }
  if (end === null) throw new Error('No se encontró el cierre de la tabla.');
  return wikitext.slice(start, end);
}

/* ---- Extracción de campos individuales --------------------- */

function extractYear(dateText, expeditionText) {
  const m = (dateText + ' ' + expeditionText).match(/\b(19[0-9]{2}|20[0-9]{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

function extractAge(text) {
  const t = text.trim();
  return /^\d{1,3}$/.test(t) ? parseInt(t, 10) : null;
}

function extractAltitude(locationText) {
  const mExact = locationText.match(/(\d{3,4})\s*m\b/);
  if (mExact) {
    const alt = parseInt(mExact[1], 10);
    if (alt >= EVEREST_BASE && alt <= EVEREST_TOP) return { altitude: alt, estimated: false };
  }

  const keywords = [
    ['hillary step', 8790], ['south summit', 8749], ['near summit', 8800],
    ['summit', 8800], ['balcony', 8400], ['death zone', 8000],
    ['camp iv', 7906], ['camp 4', 7906], ['south col', 7906],
    ['geneva spur', 7600], ['lhotse face', 7500], ['yellow band', 7500],
    ['camp iii', 7400], ['camp 3', 7400], ['north col', 7000],
    ['camp ii', 6400], ['camp 2', 6400], ['rongbuk glacier', 6400],
    ['advanced base camp', 6400], ['abc', 6400], ['western cwm', 6300],
    ['w. cwm', 6300], ['w cwm', 6300], ['camp i', 5900], ['camp 1', 5900],
    ['icefall', 5800], ['khumbu', 5800], ['base camp', 5364],
  ];
  const lower = locationText.toLowerCase();
  for (const [kw, alt] of keywords) {
    if (lower.includes(kw)) return { altitude: alt, estimated: true };
  }
  return { altitude: null, estimated: false };
}

/* ---- Convertir filas parseadas al esquema del sitio -------- */
/*
 * Columnas esperadas (según el encabezado real de la tabla en Wikipedia):
 * [0] Name  [1] Date  [2] Age  [3] Expedition  [4] Nationality
 * [5] Cause of death  [6] Location  [7] Remains status  [8] Refs
 */

function mapRowsToVictims(rows) {
  const victims = [];
  const skipped = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const name        = cleanWiki(row[0] || '');
    const dateText    = cleanWiki(row[1] || '');
    const ageText     = cleanWiki(row[2] || '');
    const expedition  = cleanWiki(row[3] || '');
    const nationality = cleanWiki(row[4] || '');
    const cause       = cleanWiki(row[5] || '');
    const location    = cleanWiki(row[6] || '');

    const year    = extractYear(dateText, expedition);
    const { altitude, estimated } = extractAltitude(location);
    const age     = extractAge(ageText);

    if (!year || !altitude) {
      skipped.push({
        name: name || `fila ${i}`,
        reason: !year ? 'sin año detectable' : `sin altitud detectable (ubicación: "${location}")`,
      });
      continue;
    }

    victims.push({
      name:               name || 'Sin nombre documentado',
      nationality:        nationality || 'Desconocida',
      year,
      age:                age ?? null,
      altitude,
      altitude_estimated: estimated,
      cause:              cause || 'Causa no determinada',
    });
  }

  return { victims, skipped };
}

/* ---- Llamada a la API de Wikipedia ------------------------- */

async function fetchFromWikipedia() {
  updateLoadText('Conectando con Wikipedia…');
  const res = await fetch(WIKI_API);
  if (!res.ok) throw new Error(`Wikipedia devolvió HTTP ${res.status}`);
  const json = await res.json();

  const wikitext = json?.parse?.wikitext?.['*'];
  if (!wikitext) throw new Error('La respuesta de Wikipedia no tiene el formato esperado.');

  updateLoadText('Parseando tabla de víctimas…');
  const tableWikitext = extractMainTable(wikitext);
  const rows = parseWikitextTable(tableWikitext);
  const { victims, skipped } = mapRowsToVictims(rows);

  if (skipped.length > 0) {
    console.info(
      `[loader] ${skipped.length} fila(s) omitidas por falta de año o altitud detectable:`,
      skipped
    );
  }

  console.info(`[loader] ${victims.length} víctimas cargadas desde Wikipedia.`);
  return victims;
}

/* ---- Pequeño helper para actualizar la pantalla de carga --- */

function updateLoadText(text) {
  const el = document.getElementById('load-txt');
  if (el) el.textContent = text;
}

/* ---- Punto de entrada principal ---------------------------- */

(async function loadVictims() {
  try {
    // Intentar cargar desde la caché local primero.
    updateLoadText('Cargando víctimas…');
    let victims = null;

    try {
      const res = await fetch('approved-victims.json');
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          victims = data;
          console.info(`[loader] ${victims.length} víctimas cargadas desde approved-victims.json (caché).`);
        }
      }
    } catch (cacheErr) {
      console.info('[loader] approved-victims.json no disponible, recurriendo a Wikipedia.');
    }

    // Si la caché no sirvió, llamar a Wikipedia.
    if (!victims) {
      victims = await fetchFromWikipedia();
    }

    // Exponer globalmente para que main.js lo use igual que antes.
    window.VICTIMS_DATA = victims;

    // Avisar a main.js que los datos están listos.
    document.dispatchEvent(new CustomEvent('victimsReady'));

  } catch (err) {
    console.error('[loader] Error al cargar víctimas:', err);
    updateLoadText('Error al cargar datos. Revisa la consola.');
    const bar = document.getElementById('load-bar');
    if (bar) bar.style.background = '#c4302b';
  }
})();
