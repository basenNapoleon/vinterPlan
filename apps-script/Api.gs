/**
 * Api.gs – låter appen Vinterplan läsa och skriva i arket.
 * Lägg filen bredvid Strava.gs i samma Apps Script-projekt.
 * Publicera: Implementera > Ny implementering > Webbapp,
 *   Kör som: Jag, Vem har åtkomst: Alla.
 * Skapa sedan nyckel via menyn Strava > App: skapa länk till telefonen.
 */

const APP_URL = 'https://vinterplan.vercel.app';

function appLank() {
  const ui = SpreadsheetApp.getUi();
  let token = PROPS.getProperty('API_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    PROPS.setProperty('API_TOKEN', token);
  }
  const svar = ui.prompt('Webbappens adress',
    'Klistra in adressen från Implementera > Hantera implementeringar (slutar på /exec)', ui.ButtonSet.OK_CANCEL);
  if (svar.getSelectedButton() !== ui.Button.OK) return;
  const exec = svar.getResponseText().trim();
  const setup = Utilities.base64EncodeWebSafe(JSON.stringify({ api: exec, token: token }));
  const lank = APP_URL + '/#setup=' + setup;
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:14px">' +
    '<p>Öppna den här länken i Safari på telefonen, en gång:</p>' +
    '<p><a href="' + lank + '" target="_blank">' + lank.substring(0, 60) + '…</a></p>' +
    '<p>Enklast: skicka länken till dig själv, öppna den i Safari och välj Dela &gt; Lägg till på hemskärmen.</p>' +
    '<textarea style="width:100%;height:80px">' + lank + '</textarea></div>')
    .setWidth(480).setHeight(300);
  ui.showModalDialog(html, 'App: länk till telefonen');
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function kontroll_(token) {
  const ratt = PROPS.getProperty('API_TOKEN');
  if (!ratt || token !== ratt) throw new Error('Fel nyckel');
}

function iso_(d, tz) {
  return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : '';
}

function doGet(e) {
  try {
    kontroll_(e.parameter.token);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tz = ss.getSpreadsheetTimeZone();

    // Dagbok: A Datum, B Vecka, C Fas, D Dag, E Löptyp, F Löppass, G Styrka, H Plan km,
    // I Klar, J Strava-pass, K Km, L Tid, M Tempo, N Puls, O RPE, P Känsla
    const db = ss.getSheetByName('Dagbok').getRange('A2:P211');
    const v = db.getValues(), s = db.getDisplayValues();
    const days = v.map((r, i) => ({
      row: i + 2, date: iso_(r[0], tz), vecka: r[1], fas: r[2], dag: r[3], typ: r[4],
      lop: r[5], styrka: r[6], km: r[7], klar: r[8] === true,
      strava: r[9], kmUt: s[i][10], tid: s[i][11], tempo: s[i][12], puls: s[i][13],
      rpe: r[14], kansla: r[15]
    }));

    // Styrkelogg: A Datum, B Vecka, C Pass, D Övning, E Plan, F Kg, G Reps, H RPE, I Förra, J Kommentar
    const sl = ss.getSheetByName('Styrkelogg');
    const lv = sl.getRange(2, 1, sl.getLastRow() - 1, 10).getValues();
    const lifts = lv.map((r, i) => ({
      row: i + 2, date: iso_(r[0], tz), vecka: r[1], pass: r[2], ovning: r[3], plan: r[4],
      kg: r[5], reps: r[6], rpe: r[7], forra: r[8], kommentar: r[9]
    })).filter(l => l.date);

    // Övningar: rad 3–20, A Övning, B Pass, C Varför, D Utförande, E Fel, F Baksida/ljumske
    const ov = ss.getSheetByName('Övningar').getRange('A3:F20').getValues()
      .filter(r => r[0])
      .map(r => ({ namn: r[0], pass: r[1], varfor: r[2], utforande: r[3], fel: r[4], tank: r[5] }));

    return json_({ ok: true, hamtad: new Date().toISOString(), days: days, lifts: lifts, ovningar: ov });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse(e.postData.contents);
    kontroll_(body.token);
    lock.waitLock(20000);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const ops = body.ops || [];
    ops.forEach(op => {
      if (op.action === 'day') {
        const sh = ss.getSheetByName('Dagbok');
        if (op.row < 2 || op.row > 211) return;
        if ('klar' in op) sh.getRange(op.row, 9).setValue(op.klar === true);
        if ('rpe' in op) sh.getRange(op.row, 15).setValue(op.rpe === '' || op.rpe == null ? '' : Number(op.rpe));
        if ('kansla' in op) sh.getRange(op.row, 16).setValue(String(op.kansla || ''));
      } else if (op.action === 'lift') {
        const sh = ss.getSheetByName('Styrkelogg');
        if (op.row < 2 || op.row > sh.getLastRow()) return;
        if ('kg' in op) sh.getRange(op.row, 6).setValue(op.kg === '' || op.kg == null ? '' : Number(op.kg));
        if ('reps' in op) sh.getRange(op.row, 7).setValue(String(op.reps || ''));
        if ('rpe' in op) sh.getRange(op.row, 8).setValue(op.rpe === '' || op.rpe == null ? '' : Number(op.rpe));
        if ('kommentar' in op) sh.getRange(op.row, 10).setValue(String(op.kommentar || ''));
      }
    });
    return json_({ ok: true, sparade: ops.length });
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
