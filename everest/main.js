/* ============================================================
   EVEREST DEATHS — main.js
   Cada víctima es un punto distribuido en el eje X según su
   posición dentro del cluster de altitud. Debajo del punto van
   sus iniciales. Clic en el punto abre el detalle en un modal.
   Nada se abre automáticamente con el scroll.
   Depende de VICTIMS_DATA (definido en data.js)
   ============================================================ */

const TOP = 8849;       // cima del Everest, en metros
const BASE = 5364;      // campamento base, en metros
const RANGE = TOP - BASE;
const VH_PER_M = 1;     // 1 metro de montaña = 1vh de scroll
const TOTAL_VH = RANGE * VH_PER_M;

/* ---- Zonas de altitud ---------------------------------------- */

function getZone(a) {
  if (a >= 8790) return 'Hillary Step';
  if (a >= 8749) return 'Cima Sur';
  if (a >= 8400) return 'El Balcón';
  if (a >= 8000) return 'Zona de la Muerte';
  if (a >= 7900) return 'Campo IV';
  if (a >= 7400) return 'Campo III';
  if (a >= 6400) return 'Campo II';
  if (a >= 5900) return 'Campo I / Icefall';
  return 'Campamento Base';
}

/* Convierte una altitud (m) a la posición vh donde debe ubicarse */
function altToVh(a) {
  return ((TOP - a) / RANGE) * TOTAL_VH;
}

/* Genera iniciales a partir de un nombre (hasta 2 letras) */
function getInitials(name) {
  const cleaned = name.replace(/\([^)]*\)/g, '').trim(); // quita "(2015)" etc.
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ---- Fondo dinámico (canvas) ----------------------------------- */

const bgc = document.getElementById('bgc');
const ctx = bgc.getContext('2d');

function drawBg() {
  bgc.width = window.innerWidth;
  bgc.height = window.innerHeight;
  const w = bgc.width, h = bgc.height;

  const total = document.body.scrollHeight - window.innerHeight;
  const p = total > 0 ? Math.min(window.scrollY / total, 1) : 0;

  const r = Math.round(10 + p * 12);
  const g = Math.round(14 + p * 30);
  const b = Math.round(22 + p * 8);
  ctx.fillStyle = `rgb(${r},${g},${b})`;
  ctx.fillRect(0, 0, w, h);

  const alt = TOP - p * RANGE;
  if (alt > 6500) {
    const op = Math.min((alt - 6500) / 800, 1) * 0.2;
    for (let i = 0; i < 80; i++) {
      const x = ((i * 137.508 + window.scrollY * 0.1) % w + w) % w;
      const y = ((i * 97.3 + window.scrollY * 0.07) % h + h) % h;
      ctx.fillStyle = `rgba(200,223,240,${op * (0.3 + (i % 7) * 0.05)})`;
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + (i % 3) * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = 'rgba(74,158,187,0.04)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i < 6; i++) {
    const y = (i / 6 * h + window.scrollY * 0.015) % h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

/* ================================================================
   CLUSTERING: agrupar víctimas por proximidad de altitud para
   que comparan la misma fila horizontal de puntos.
   ================================================================ */

const CLUSTER_THRESHOLD_VH = 2.2; // víctimas a < 2.2vh se consideran "el mismo punto"
const DOT_SLOT_WIDTH_DESKTOP = 34; // ancho horizontal reservado por punto en PC
const DOT_SLOT_WIDTH_MOBILE = 46;  // más ancho en móvil: dedos más anchos, menos amontonado
const ROW_GAP_DESKTOP = 34;        // separación vertical entre filas envueltas en PC
const ROW_GAP_MOBILE = 46;         // más separación vertical en móvil
const DOT_VERTICAL_SPACE = 30;     // alto aproximado de un punto + su etiqueta de iniciales

const IS_MOBILE = () => window.matchMedia('(max-width: 768px)').matches;

/**
 * Agrupa víctimas (ya ordenadas desc. por altitud) en clusters
 * cuando su posición vh está a menos de CLUSTER_THRESHOLD_VH entre sí.
 */
function clusterVictims(sortedVictims) {
  const clusters = [];
  let current = [];

  sortedVictims.forEach((v) => {
    const vh = altToVh(v.altitude);
    if (current.length === 0) {
      current.push({ v, vh });
    } else {
      const lastVh = current[current.length - 1].vh;
      if (Math.abs(vh - lastVh) <= CLUSTER_THRESHOLD_VH) {
        current.push({ v, vh });
      } else {
        clusters.push(current);
        current = [{ v, vh }];
      }
    }
  });
  if (current.length) clusters.push(current);
  return clusters;
}

/**
 * Calcula cuántos puntos entran por fila según el ancho de
 * pantalla disponible. En móvil usa un slot más ancho para dar
 * más aire entre puntos, a costa de más filas envueltas.
 */
function dotsPerRow() {
  const mobile = IS_MOBILE();
  const slotWidth = mobile ? DOT_SLOT_WIDTH_MOBILE : DOT_SLOT_WIDTH_DESKTOP;
  const usable = mobile
    ? window.innerWidth * 0.92
    : Math.min(window.innerWidth * 0.9, 1100);
  return Math.max(4, Math.floor(usable / slotWidth));
}

/**
 * Para un cluster de tamaño `n`, calcula posiciones {dx, rowOffset}
 * para cada punto: se distribuyen en fila(s) horizontales centradas;
 * si no entran en una fila, se envuelven (wrap) a una fila adicional
 * justo debajo, sin límite — ninguna víctima queda oculta. En móvil
 * usa más espacio horizontal y vertical entre puntos/filas.
 */
function layoutDots(n) {
  const mobile = IS_MOBILE();
  const slotWidth = mobile ? DOT_SLOT_WIDTH_MOBILE : DOT_SLOT_WIDTH_DESKTOP;
  const rowGap = mobile ? ROW_GAP_MOBILE : ROW_GAP_DESKTOP;

  const perRow = dotsPerRow();
  const rows = Math.ceil(n / perRow);
  const positions = [];

  let idx = 0;
  for (let row = 0; row < rows; row++) {
    const itemsInRow = Math.min(perRow, n - idx);
    const totalWidth = (itemsInRow - 1) * slotWidth;
    const startX = -totalWidth / 2;
    for (let col = 0; col < itemsInRow; col++) {
      const dx = startX + col * slotWidth;
      const rowOffset = row * rowGap;
      positions.push({ dx, rowOffset });
      idx++;
    }
  }
  return positions;
}

/* ---- Construcción de la página --------------------------------- */

/* 1px de viewport ≈ (100 / window.innerHeight) vh. Usamos esto para
   convertir el espacio extra que ocupan las filas envueltas (en px)
   a una cantidad de vh que hay que "empujar" a todo lo que sigue
   más abajo en la montaña, evitando que un cluster con muchas filas
   se solape visualmente con el siguiente. */
function pxToVh(px) {
  return (px / window.innerHeight) * 100;
}

function buildPage() {
  const mtn = document.getElementById('mtn');

  const sorted = [...VICTIMS_DATA].sort((a, b) => b.altitude - a.altitude);
  const clusters = clusterVictims(sorted);

  let pushVh = 0; // desplazamiento acumulado por filas envueltas previas

  clusters.forEach((cluster) => {
    const positions = layoutDots(cluster.length);
    // rowOffset máximo entre todas las posiciones = cuánto px ocupan
    // verticalmente las filas envueltas de este cluster (0 si cabe en 1 fila)
    const maxRowOffsetPx = positions.length ? Math.max(...positions.map(p => p.rowOffset)) : 0;

    // vh base: la altitud real del cluster + el empuje acumulado hasta ahora
    const baseVh = cluster[0].vh + pushVh;

    const groupWrap = document.createElement('div');
    groupWrap.className = 'vgroup';
    groupWrap.style.top = baseVh + 'vh';

    cluster.forEach(({ v }, i) => {
      const pos = positions[i];
      const dotWrap = document.createElement('div');
      dotWrap.className = 'dot-wrap';
      dotWrap.style.left = `calc(50% + ${pos.dx}px)`;
      dotWrap.style.top = `${pos.rowOffset}px`;
      dotWrap.dataset.nationality = v.nationality || '';

      const initials = getInitials(v.name);

      dotWrap.innerHTML = `
        <button class="dot" type="button" aria-label="${v.name}, ${v.year}, ${v.altitude}m"></button>
        <span class="dot-label">${initials}</span>
      `;

      const dotBtn = dotWrap.querySelector('.dot');
      dotBtn.addEventListener('click', () => openModal(v));

      groupWrap.appendChild(dotWrap);
    });

    mtn.appendChild(groupWrap);

    // Si este cluster usó filas envueltas (maxRowOffsetPx > 0), reserva
    // ese espacio extra (convertido a vh) para que el siguiente cluster
    // no se monte encima. Se suma un margen por la altura real del
    // último punto + su etiqueta de iniciales.
    if (maxRowOffsetPx > 0) {
      const extraPx = maxRowOffsetPx + DOT_VERTICAL_SPACE;
      pushVh += pxToVh(extraPx);
    }
  });

  // La altura total del contenedor debe incluir todo el empuje acumulado,
  // para que el scroll siga llegando hasta el campamento base real.
  mtn.style.height = (TOTAL_VH + pushVh) + 'vh';

  // Etiquetas de hitos de altitud (también se desplazan si hubo empuje
  // antes de su posición real, para mantenerse alineadas visualmente)
  const landmarks = [
    { a: 8849, l: 'Cima · 8.849 m' },
    { a: 8790, l: 'Hillary Step' },
    { a: 8749, l: 'Cima Sur' },
    { a: 8400, l: 'El Balcón' },
    { a: 8000, l: 'Zona de la Muerte · 8.000 m' },
    { a: 7906, l: 'Campo IV · 7.906 m' },
    { a: 7400, l: 'Campo III · 7.400 m' },
    { a: 6400, l: 'Campo II · 6.400 m' },
    { a: 5900, l: 'Campo I / Khumbu Icefall' },
    { a: 5364, l: 'Campamento Base · 5.364 m' }
  ];

  landmarks.forEach(lm => {
    const lbl = document.createElement('div');
    lbl.className = 'altitude-label';
    lbl.style.top = altToVh(lm.a) + 'vh';
    lbl.textContent = lm.l;
    mtn.appendChild(lbl);
  });

  document.getElementById('end-total').textContent = VICTIMS_DATA.length;
}

/* Reconstruye solo la disposición de puntos (sin recrear el DOM
   completo) cuando cambia el ancho de pantalla, para que el wrap
   de filas se recalculen y nada quede amontonado. También reaplica
   el filtro de nacionalidad activo, ya que los puntos se recrean. */
function rebuildDots() {
  const mtn = document.getElementById('mtn');
  mtn.querySelectorAll('.vgroup, .altitude-label').forEach(el => el.remove());
  buildPage();

  const select = document.getElementById('nationality-filter');
  if (select && select.value) applyNationalityFilter(select.value);
}

/* ---- Filtro por nacionalidad -------------------------------------- */

/* Nombres en español para las nacionalidades más comunes del dataset.
   Las que no estén en este mapa se muestran tal cual vienen del dataset
   (en inglés, como las entrega la fuente de Wikipedia). */
const NATIONALITY_ES = {
  'Nepal': 'Nepal', 'India': 'India', 'United Kingdom': 'Reino Unido',
  'United States': 'Estados Unidos', 'Japan': 'Japón', 'South Korea': 'Corea del Sur',
  'China': 'China', 'Australia': 'Australia', 'Germany': 'Alemania', 'Russia': 'Rusia',
  'Canada': 'Canadá', 'Poland': 'Polonia', 'France': 'Francia', 'Spain': 'España',
  'Czechoslovakia': 'Checoslovaquia', 'Bulgaria': 'Bulgaria', 'New Zealand': 'Nueva Zelanda',
  'Hungary': 'Hungría', 'Malaysia': 'Malasia', 'Italy': 'Italia', 'Switzerland': 'Suiza',
  'Ireland': 'Irlanda', 'Taiwan': 'Taiwán', 'Denmark': 'Dinamarca', 'Brazil': 'Brasil',
  'Czech Republic': 'República Checa', 'Moldova': 'Moldavia', 'Singapore': 'Singapur',
  'Mongolia': 'Mongolia', 'West Germany': 'Alemania Occidental', 'Chile': 'Chile',
  'Yugoslavia': 'Yugoslavia', 'Ukraine': 'Ucrania', 'Belgium': 'Bélgica', 'Austria': 'Austria',
  'FR Yugoslavia': 'Yugoslavia (RF)', 'Slovenia': 'Eslovenia', 'Sweden': 'Suecia',
  'Bangladesh': 'Bangladés', 'Netherlands': 'Países Bajos', 'North Macedonia': 'Macedonia del Norte',
  'Indonesia': 'Indonesia', 'Romania': 'Rumania', 'Kenya': 'Kenia', 'Philippines': 'Filipinas',
  'Slovakia': 'Eslovaquia'
};

function nationalityLabel(nat) {
  return NATIONALITY_ES[nat] || nat;
}

/* Llena el <select> con todas las nacionalidades presentes en los
   datos, ordenadas de mayor a menor cantidad de víctimas, mostrando
   el conteo junto a cada una. */
function populateNationalityFilter() {
  const select = document.getElementById('nationality-filter');
  const counts = {};
  VICTIMS_DATA.forEach(v => {
    const nat = v.nationality || 'Desconocida';
    counts[nat] = (counts[nat] || 0) + 1;
  });

  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  sorted.forEach(([nat, count]) => {
    const opt = document.createElement('option');
    opt.value = nat;
    opt.textContent = `${nationalityLabel(nat)} (${count})`;
    select.appendChild(opt);
  });

  select.addEventListener('change', () => applyNationalityFilter(select.value));
}

/* Aplica el resaltado/atenuado a todos los puntos según la
   nacionalidad elegida. Nada se oculta: el filtro solo cambia
   opacidad y un leve resplandor en los que coinciden. */
function applyNationalityFilter(selectedNat) {
  const select = document.getElementById('nationality-filter');
  const allDots = document.querySelectorAll('.dot-wrap');

  if (!selectedNat) {
    select.classList.remove('active');
    allDots.forEach(el => el.classList.remove('dimmed', 'highlighted'));
    return;
  }

  select.classList.add('active');
  allDots.forEach(el => {
    const matches = el.dataset.nationality === selectedNat;
    el.classList.toggle('highlighted', matches);
    el.classList.toggle('dimmed', !matches);
  });
}

/* ---- Modal overlay (PC y móvil) ----------------------------------- */

function openModal(v) {
  const overlay = document.getElementById('modal-overlay');

  document.getElementById('modal-name').textContent = v.name;
  document.getElementById('modal-alt').textContent =
    `${v.altitude.toLocaleString('es-CL')} m · ${getZone(v.altitude)}`;

  const ageStr = v.age != null ? v.age + ' años' : '—';
  document.getElementById('modal-meta').innerHTML = `
    <div class="mi"><span class="ml">Año</span><span class="mv">${v.year}</span></div>
    <div class="mi"><span class="ml">Edad</span><span class="mv">${ageStr}</span></div>
    <div class="mi"><span class="ml">Nacionalidad</span><span class="mv">${v.nationality || '—'}</span></div>
    <div class="mi"><span class="ml">Altitud</span><span class="mv">${v.altitude.toLocaleString('es-CL')} m</span></div>
  `;
  document.getElementById('modal-cause').innerHTML =
    `<span>Causa</span>${v.cause || 'Causa no determinada'}`;

  overlay.classList.add('open');
}

function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function setupModal() {
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });
}

/* ---- HUD reactivo al scroll -------------------------------------- */

function setupScroll() {
  const altVal = document.getElementById('alt-value');
  const zoneBadge = document.getElementById('zone-badge');
  const prog = document.getElementById('prog');
  const dcNum = document.getElementById('death-count-num');
  const sortedByAlt = [...VICTIMS_DATA].sort((a, b) => b.altitude - a.altitude);

  let ticking = false;

  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;

    requestAnimationFrame(() => {
      const sy = window.scrollY;
      const total = document.body.scrollHeight - window.innerHeight;
      const p = total > 0 ? Math.min(Math.max(sy / total, 0), 1) : 0;
      prog.style.height = p * 100 + '%';

      const introH = window.innerHeight;
      const mtnScrollable = total - introH - window.innerHeight;
      const mp = mtnScrollable > 0
        ? Math.min(Math.max((sy - introH) / mtnScrollable, 0), 1)
        : 0;

      const curAlt = Math.round(Math.max(TOP - mp * RANGE, BASE));
      altVal.textContent = curAlt.toLocaleString('es-CL');
      zoneBadge.textContent = getZone(curAlt);

      const passed = sortedByAlt.filter(v => v.altitude >= curAlt).length;
      dcNum.textContent = passed;

      drawBg();
      ticking = false;
    });
  }, { passive: true });
}

/* Re-layout al cambiar tamaño de ventana (debounced) */
function setupResize() {
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    drawBg();
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuildDots, 200);
  }, { passive: true });
}

/* ---- Inicialización ------------------------------------------------ */

async function init() {
  const bar = document.getElementById('load-bar');
  const txt = document.getElementById('load-txt');

  bar.style.width = '30%';
  await new Promise(r => setTimeout(r, 150));

  bar.style.width = '70%';
  txt.textContent = `Posicionando ${VICTIMS_DATA.length} víctimas…`;
  buildPage();
  populateNationalityFilter();

  await new Promise(r => setTimeout(r, 200));
  bar.style.width = '100%';

  await new Promise(r => setTimeout(r, 250));
  document.getElementById('load').classList.add('gone');
  setTimeout(() => document.getElementById('load').remove(), 600);

  drawBg();
  setupScroll();
  setupModal();
  setupResize();
}

document.addEventListener('DOMContentLoaded', init);
