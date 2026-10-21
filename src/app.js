// Vinterplan – app.js
// Data: PLAN (inbäddad) skrivs över av arket när API är kopplat. Ändringar sparas lokalt
// och läggs i en kö som skickas till arket när nätet finns.

const LS = {
  get(k, d) { try { const v = localStorage.getItem('vp_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('vp_' + k, JSON.stringify(v)); } catch (e) {} }
};

const TYPFARG = { 'Lugnt': '#B8E0CC', 'Tröskel': '#FACC9C', 'Fart': '#EB9999', 'Långpass': '#9EC4E8', 'Fotboll': '#FFE699', 'Lopp': '#F2C233', 'Vila': '#D9D9D9' };
const GYMFARG = '#D6C4ED';
const MAN = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const DAGLANG = { 'Mån': 'Måndag', 'Tis': 'Tisdag', 'Ons': 'Onsdag', 'Tor': 'Torsdag', 'Fre': 'Fredag', 'Lör': 'Lördag', 'Sön': 'Söndag' };

let cfg = LS.get('cfg', null);          // { api, token }
let data = LS.get('data', null) || PLAN; // senaste från arket, annars inbäddad plan
let ko = LS.get('ko', []);               // köade ändringar
let lokal = LS.get('lokal', { days: {}, lifts: {} }); // lokala värden per rad
let sets = LS.get('sets', {});           // osparade utkast per styrkerad: [{kg, reps}]. Sparade set läses från arket (Reps)
let senast = LS.get('senast', null);
if (LS.get('setsv', 1) < 2) { sets = {}; LS.set('sets', sets); LS.set('setsv', 2); } // äldre version sparade alla set lokalt
let synkStatus = '';

const $ = (s) => document.querySelector(s);
const esc = (t) => String(t == null ? '' : t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const idag = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const datumText = (iso) => { const [y, m, d] = iso.split('-').map(Number); return d + ' ' + MAN[m - 1]; };

function dag(iso) {
  const d = data.days.find(x => x.date === iso);
  if (!d) return null;
  return Object.assign({}, d, lokal.days[d.row] || {});
}
function lyft(row) {
  const l = data.lifts.find(x => x.row === row);
  return l ? Object.assign({}, l, lokal.lifts[row] || {}) : null;
}
function lyftForDag(iso) { return data.lifts.filter(l => l.date === iso).map(l => lyft(l.row)); }
function ovning(namn) { return (data.ovningar || PLAN.ovningar).find(o => o.namn === namn) || PLAN.ovningar.find(o => o.namn === namn); }
function forraKg(l) {
  // Senaste loggade kg för samma övning före detta datum (lokalt eller från arket)
  const tidigare = data.lifts.filter(x => x.ovning === l.ovning && x.date < l.date).map(x => lyft(x.row)).filter(x => x.kg !== '' && x.kg != null);
  if (tidigare.length) return tidigare[tidigare.length - 1].kg;
  return l.forra || '';
}

// ---------- Synk ----------
function sparaLokalt() { LS.set('ko', ko); LS.set('lokal', lokal); LS.set('sets', sets); }

function andra(typ, row, falt) {
  const bucket = typ === 'day' ? lokal.days : lokal.lifts;
  bucket[row] = Object.assign({}, bucket[row] || {}, falt);
  ko.push(Object.assign({ action: typ, row: row }, falt));
  sparaLokalt();
  visaSynk();
  synka();
}

let synkar = false;
async function synka(hamta) {
  if (!cfg || synkar || !navigator.onLine) { visaSynk(); return; }
  synkar = true;
  try {
    if (ko.length) {
      const skicka = ko.slice();
      const r = await fetch(cfg.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ token: cfg.token, ops: skicka }) });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Fel från arket');
      ko = ko.slice(skicka.length);
      sparaLokalt();
    }
    if (hamta) {
      const r = await fetch(cfg.api + '?token=' + encodeURIComponent(cfg.token));
      const j = await r.json();
      if (!j.ok) throw new Error(j.error || 'Fel från arket');
      data = { days: j.days, lifts: j.lifts, ovningar: j.ovningar };
      LS.set('data', data);
      // Lokala värden som redan finns i arket behövs inte längre, men köade ändringar ligger kvar
      if (!ko.length) { lokal = { days: {}, lifts: {} }; LS.set('lokal', lokal); }
      senast = new Date().toISOString(); LS.set('senast', senast);
      rendera();
    }
    synkStatus = '';
  } catch (e) {
    synkStatus = 'Kunde inte synka: ' + e.message;
  } finally {
    synkar = false;
    visaSynk();
  }
}

function visaSynk() {
  const el = $('#synk');
  if (!el) return;
  let t, cls = '';
  if (!cfg) { t = 'Ej kopplad till arket'; cls = 'av'; }
  else if (!navigator.onLine) { t = 'Offline' + (ko.length ? ' · ' + ko.length + ' ändringar väntar' : ''); cls = 'av'; }
  else if (synkStatus) { t = synkStatus; cls = 'fel'; }
  else if (ko.length) { t = 'Synkar ' + ko.length + ' ändringar…'; }
  else { t = 'Synkat'; cls = 'ok'; }
  el.textContent = t; el.className = 'synk ' + cls;
}

// ---------- Vyer ----------
function typChip(typ) {
  return `<span class="chip" style="background:${TYPFARG[typ] || '#eee'}">${esc(typ)}</span>`;
}

function vyDag(iso) {
  const d = dag(iso);
  const forst = data.days[0].date, sist = data.days[data.days.length - 1].date;
  if (!d) {
    const fore = iso < forst;
    return `<section class="tom"><h1>${fore ? 'Planen startar ' + datumText(forst) : 'Planen är slut'}</h1>
      <p>${fore ? 'Fram till dess: kör som vanligt. Här är första veckan.' : 'Göteborgsvarvet är sprunget.'}</p>
      ${fore ? `<a class="knapp" href="#dag/${forst}">Visa första dagen</a>` : ''}</section>`;
  }
  const prev = data.days[data.days.findIndex(x => x.date === iso) - 1];
  const next = data.days[data.days.findIndex(x => x.date === iso) + 1];
  const lyftLista = lyftForDag(iso);
  const loggade = lyftLista.filter(l => (l.kg !== '' && l.kg != null) || (l.reps !== '' && l.reps != null)).length;
  const arIdag = iso === idag();
  let h = `<header class="daghuvud">
    <a class="pil" href="${prev ? '#dag/' + prev.date : '#'}" ${prev ? '' : 'aria-disabled="true"'}>‹</a>
    <div><div class="liten">${arIdag ? 'Idag · ' : ''}Vecka ${d.vecka} · ${esc(d.fas)}</div>
    <h1>${DAGLANG[d.dag] || d.dag} ${datumText(iso)}</h1></div>
    <a class="pil" href="${next ? '#dag/' + next.date : '#'}">›</a></header>`;

  h += `<article class="kort" style="border-left-color:${TYPFARG[d.typ] || '#ccc'}">
    <div class="korthuvud">${typChip(d.typ)}${d.km ? `<span class="km">${String(d.km).replace('.', ',')} km</span>` : ''}</div>
    <p class="pass">${esc(d.lop).replace(/\n/g, '<br>')}</p>`;
  if (d.kmUt) h += `<p class="strava">Strava: ${esc(d.strava)}<br><b>${esc(String(d.kmUt).replace('.', ','))} km</b> · ${esc(d.tempo)}/km${d.puls ? ' · ' + esc(d.puls) + ' bpm' : ''}</p>`;
  h += `</article>`;

  if (d.styrka) {
    h += `<a class="kort gymkort" href="#gym/${iso}" style="border-left-color:${GYMFARG}">
      <div class="korthuvud"><span class="chip" style="background:${GYMFARG}">${esc(d.styrka)}</span><span class="km">${lyftLista.length} övningar</span></div>
      <p class="pass">${loggade ? loggade + ' av ' + lyftLista.length + ' loggade' : 'Starta gympasset'} ›</p></a>`;
  }

  if (d.typ !== 'Vila' || d.styrka) {
    h += `<section class="logg">
      <button class="klar ${d.klar ? 'pa' : ''}" data-klar="${d.row}">${d.klar ? '✓ Klart' : 'Markera som klart'}</button>
      <h2>Ansträngning (RPE)</h2><div class="rpe">${[1,2,3,4,5,6,7,8,9,10].map(n => `<button data-rpe="${d.row}" data-v="${n}" class="${Number(d.rpe) === n ? 'pa' : ''}">${n}</button>`).join('')}</div>
      <h2>Hur kändes det?</h2>
      <textarea data-kansla="${d.row}" rows="3" placeholder="Ben, baksida, ljumske, energi…">${esc(d.kansla)}</textarea>
    </section>`;
  }
  return h;
}

function vyGym(iso) {
  const d = dag(iso);
  const lista = lyftForDag(iso);
  let h = `<header class="daghuvud"><a class="pil" href="#dag/${iso}">‹</a><div><div class="liten">${DAGLANG[d.dag]} ${datumText(iso)}</div><h1>${esc(d.styrka)}</h1></div><span></span></header>`;
  h += `<ul class="lista">` + lista.map(l => {
    const klar = (l.reps !== '' && l.reps != null) || (l.kg !== '' && l.kg != null);
    return `<li><a href="#lyft/${l.row}">${figurSVG(l.ovning, true)}<div><b>${esc(l.ovning)}</b><span>${esc(l.plan)}${forraKg(l) !== '' ? ' · förra ' + esc(forraKg(l)) + ' kg' : ''}</span></div>${klar ? '<i class="bock">✓</i>' : '<i>›</i>'}</a></li>`;
  }).join('') + `</ul>`;
  return h;
}

function utkast(row) {
  if (!sets[row]) sets[row] = parseSets(lyft(row).reps);
  return sets[row];
}

function tidsbaserad(plan) { return /\bs\b|s\/(ben|sida)/.test(plan); }

function parseSets(text) {
  // "60×8, 60×8, 62,5×7" -> [{kg:60,reps:8},...]
  if (!text) return [];
  return String(text).split(/,\s+/).map(x => x.trim()).filter(Boolean).map(x => {
    const m = x.replace(',', '.').match(/^([\d.]+)?\s*×\s*([\d.]+)/);
    return m ? { kg: m[1] || '', reps: m[2] } : null;
  }).filter(Boolean);
}

function vyLyft(row) {
  const l = lyft(row);
  if (!l) return '<p>Hittar inte övningen.</p>';
  const o = ovning(l.ovning) || {};
  // Utkast om du har börjat ändra, annars det som är sparat i arket
  const s = sets[row] || parseSets(l.reps);
  const tid = tidsbaserad(l.plan);
  const forra = forraKg(l);
  const lista = lyftForDag(l.date);
  const i = lista.findIndex(x => x.row === row);
  const nasta = lista[i + 1];
  let h = `<header class="daghuvud"><a class="pil" href="#gym/${l.date}">‹</a><div><div class="liten">${esc(l.pass)} · ${i + 1} av ${lista.length}</div><h1>${esc(l.ovning)}</h1></div><span></span></header>`;
  h += `<div class="figurbox">${figurSVG(l.ovning)}</div>`;
  h += `<div class="dos"><div><span>Plan</span><b>${esc(l.plan)}</b></div><div><span>Förra gången</span><b>${forra !== '' ? esc(forra) + ' kg' : '–'}</b></div></div>`;
  h += `<section class="set"><h2>Set</h2><table><thead><tr><th>#</th><th>Kg</th><th>${tid ? 'Sek' : 'Reps'}</th><th></th></tr></thead><tbody>`;
  s.forEach((x, n) => {
    h += `<tr><td>${n + 1}</td><td><input inputmode="decimal" data-set="${row}" data-i="${n}" data-f="kg" value="${esc(x.kg)}"></td><td><input inputmode="numeric" data-set="${row}" data-i="${n}" data-f="reps" value="${esc(x.reps)}"></td><td><button class="bort" data-bort="${row}" data-i="${n}" aria-label="Ta bort set">×</button></td></tr>`;
  });
  h += `</tbody></table><button class="knapp sekundar" data-nyttset="${row}">+ Lägg till set</button>
    <h2>RPE</h2><div class="rpe sex">${[5,6,7,8,9,10].map(n => `<button data-lrpe="${row}" data-v="${n}" class="${Number(l.rpe) === n ? 'pa' : ''}">${n}</button>`).join('')}</div>
    <textarea data-lkom="${row}" rows="2" placeholder="Kommentar">${esc(l.kommentar)}</textarea>
    <button class="knapp" data-sparalyft="${row}" data-nasta="${nasta ? nasta.row : ''}">${nasta ? 'Spara och nästa ›' : 'Spara och klar'}</button></section>`;
  h += infoBlock(o);
  return h;
}

function infoBlock(o) {
  if (!o || !o.namn) return '';
  return `<section class="info">
    ${o.utforande ? `<h2>Utförande</h2><p>${esc(o.utforande)}</p>` : ''}
    ${o.fel ? `<h2>Vanliga fel</h2><p>${esc(o.fel)}</p>` : ''}
    ${o.tank ? `<h2>Baksida och ljumske</h2><p>${esc(o.tank)}</p>` : ''}
    ${o.varfor ? `<h2>Varför</h2><p>${esc(o.varfor)}</p>` : ''}
  </section>`;
}

function vyVecka(v) {
  const max = data.days[data.days.length - 1].vecka;
  v = Math.max(1, Math.min(max, v));
  const dagar = data.days.filter(d => d.vecka === v).map(d => dag(d.date));
  const plan = dagar.reduce((s, d) => s + (Number(d.km) || 0), 0);
  const utf = dagar.reduce((s, d) => s + (parseFloat(String(d.kmUt || '').replace(',', '.')) || 0), 0);
  const klara = dagar.filter(d => d.klar).length, pass = dagar.filter(d => d.typ !== 'Vila').length;
  let h = `<header class="daghuvud"><a class="pil" href="#vecka/${v - 1}">‹</a><div><div class="liten">${esc(dagar[0].fas)}</div><h1>Vecka ${v}</h1></div><a class="pil" href="#vecka/${v + 1}">›</a></header>`;
  h += `<p class="summa">Plan ${Math.round(plan)} km · utfört ${utf.toFixed(1).replace('.', ',')} km · ${klara} av ${pass} pass klara</p>`;
  h += `<ul class="vecka">` + dagar.map(d => `<li class="${d.date === idag() ? 'idag' : ''} ${d.klar ? 'gjort' : ''}"><a href="#dag/${d.date}">
      <div class="vd"><b>${d.dag}</b><span>${datumText(d.date)}</span></div>
      <div class="vp"><span class="chip" style="background:${TYPFARG[d.typ] || '#eee'}">${esc(d.typ)}</span>${d.styrka ? `<span class="chip" style="background:${GYMFARG}">${esc(d.styrka.replace(/ \(.*\)/, ''))}</span>` : ''}
      <p>${esc(d.lop.split('\n')[0])}</p></div>${d.klar ? '<i class="bock">✓</i>' : ''}</a></li>`).join('') + `</ul>`;
  return h;
}

function vyOvningar() {
  return `<header class="daghuvud"><span></span><div><h1>Övningar</h1></div><span></span></header><ul class="lista">` +
    (data.ovningar || PLAN.ovningar).map((o, i) => `<li><a href="#ovning/${i}">${figurSVG(o.namn, true)}<div><b>${esc(o.namn)}</b><span>${esc(o.pass)}</span></div><i>›</i></a></li>`).join('') + `</ul>`;
}

function vyOvning(i) {
  const o = (data.ovningar || PLAN.ovningar)[i];
  if (!o) return '';
  return `<header class="daghuvud"><a class="pil" href="#ovningar">‹</a><div><div class="liten">${esc(o.pass)}</div><h1>${esc(o.namn)}</h1></div><span></span></header>
    <div class="figurbox">${figurSVG(o.namn)}</div>${infoBlock(o)}`;
}

function vyInst() {
  return `<header class="daghuvud"><span></span><div><h1>Inställningar</h1></div><span></span></header>
  <section class="info">
    <p>${cfg ? 'Kopplad till arket.' : 'Inte kopplad. Öppna länken från arkets meny Strava > App: skapa länk till telefonen, eller klistra in uppgifterna här.'}</p>
    <label>Webbappens adress (/exec)<input id="i_api" value="${esc(cfg ? cfg.api : '')}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <label>Nyckel<input id="i_tok" value="${esc(cfg ? cfg.token : '')}"></label>
    <button class="knapp" id="i_spara">Spara och synka</button>
    <p class="liten">${ko.length} ändringar väntar på att skickas. ${senast ? 'Senast hämtat ' + new Date(senast).toLocaleString('sv-SE') : 'Inget hämtat från arket än, appen visar den inbyggda planen.'}</p>
    <button class="knapp sekundar" id="i_synk">Synka nu</button>
  </section>`;
}

// ---------- Router ----------
function rendera() {
  const [vy, arg] = (location.hash.slice(1) || 'idag').split('/');
  let h;
  if (vy === 'dag') h = vyDag(arg);
  else if (vy === 'gym') h = vyGym(arg);
  else if (vy === 'lyft') h = vyLyft(Number(arg));
  else if (vy === 'vecka') h = vyVecka(Number(arg) || aktuellVecka());
  else if (vy === 'ovningar') h = vyOvningar();
  else if (vy === 'ovning') h = vyOvning(Number(arg));
  else if (vy === 'inst') h = vyInst();
  else h = vyDag(idag());
  $('#vy').innerHTML = h;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('aktiv', a.dataset.vy === (vy === 'dag' && arg !== idag() ? 'vecka' : (vy === 'gym' || vy === 'lyft' ? 'idag' : (vy === 'ovning' ? 'ovningar' : vy)))));
  document.getElementById('rull').scrollTop = 0;
  visaSynk();
}

function aktuellVecka() {
  const d = data.days.find(x => x.date === idag());
  return d ? d.vecka : 1;
}

// ---------- Händelser ----------
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  const ds = t.dataset;
  if (ds.klar) { const d = data.days.find(x => x.row === +ds.klar); const nu = dag(d.date).klar; andra('day', +ds.klar, { klar: !nu }); rendera(); }
  else if (ds.rpe) { andra('day', +ds.rpe, { rpe: +ds.v }); rendera(); }
  else if (ds.lrpe) { lokal.lifts[+ds.lrpe] = Object.assign({}, lokal.lifts[+ds.lrpe], { rpe: +ds.v }); sparaLokalt(); rendera(); }
  else if (ds.nyttset) {
    const row = +ds.nyttset, s = utkast(row);
    const sista = s[s.length - 1] || { kg: forraKg(lyft(row)), reps: '' };
    s.push({ kg: sista.kg, reps: sista.reps }); sparaLokalt(); rendera();
    const inp = document.querySelectorAll(`[data-set="${row}"][data-f="reps"]`); if (inp.length) inp[inp.length - 1].focus();
  }
  else if (ds.bort) { utkast(+ds.bort).splice(+ds.i, 1); sparaLokalt(); rendera(); }
  else if (ds.sparalyft) {
    const row = +ds.sparalyft, s = (sets[row] || parseSets(lyft(row).reps)).filter(x => x.kg !== '' || x.reps !== '');
    delete sets[row];
    const kgs = s.map(x => parseFloat(String(x.kg).replace(',', '.'))).filter(x => !isNaN(x));
    const l = lyft(row);
    andra('lift', row, {
      kg: kgs.length ? Math.max(...kgs) : '',
      reps: s.map(x => (x.kg !== '' ? String(x.kg).replace('.', ',') : '') + '×' + x.reps).join(', '),
      rpe: l.rpe == null ? '' : l.rpe,
      kommentar: l.kommentar || ''
    });
    location.hash = ds.nasta ? '#lyft/' + ds.nasta : '#gym/' + l.date;
  }
  else if (t.id === 'i_spara') {
    const api = $('#i_api').value.trim(), token = $('#i_tok').value.trim();
    cfg = api && token ? { api, token } : null; LS.set('cfg', cfg); synka(true); rendera();
  }
  else if (t.id === 'i_synk') synka(true);
});

document.addEventListener('input', (e) => {
  const t = e.target, ds = t.dataset;
  if (ds.set) { utkast(+ds.set)[+ds.i][ds.f] = t.value; sparaLokalt(); }
});
document.addEventListener('change', (e) => {
  const t = e.target, ds = t.dataset;
  if (ds.kansla) andra('day', +ds.kansla, { kansla: t.value });
  if (ds.lkom) { lokal.lifts[+ds.lkom] = Object.assign({}, lokal.lifts[+ds.lkom], { kommentar: t.value }); sparaLokalt(); }
});

// ---------- Start ----------
function lasSetup() {
  const m = location.hash.match(/^#setup=(.+)$/);
  if (!m) return;
  try {
    const j = JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (j.api && j.token) { cfg = { api: j.api, token: j.token }; LS.set('cfg', cfg); }
  } catch (e) {}
  history.replaceState(null, '', location.pathname + '#idag');
}

window.addEventListener('hashchange', rendera);
window.addEventListener('online', () => synka(true));
window.addEventListener('offline', visaSynk);
document.addEventListener('visibilitychange', () => { if (!document.hidden) synka(true); });

lasSetup();
rendera();
synka(true);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
