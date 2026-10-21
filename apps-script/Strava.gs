/**
 * Strava -> Vinterplan
 * Hämtar dina pass från Strava till fliken "Strava" och varv från
 * tröskel- och fartpass till fliken "Intervaller".
 *
 * Engångsinställning: se fliken Instruktioner i arket.
 */

const API = 'https://www.strava.com/api/v3';
const PROPS = PropertiesService.getScriptProperties();

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Strava')
    .addItem('1. Spara Client ID och Secret', 'sparaNycklar')
    .addItem('2. Koppla Strava', 'kopplaStrava')
    .addItem('3. Hämta nya pass nu', 'hamtaNya')
    .addItem('4. Starta automatisk hämtning (varje timme)', 'startaTrigger')
    .addSeparator()
    .addItem('Stoppa automatisk hämtning', 'stoppaTrigger')
    .addSeparator()
    .addItem('App: skapa länk till telefonen', 'appLank')
    .addToUi();
}

function sparaNycklar() {
  const ui = SpreadsheetApp.getUi();
  const id = ui.prompt('Strava Client ID', 'Finns på strava.com/settings/api', ui.ButtonSet.OK_CANCEL);
  if (id.getSelectedButton() !== ui.Button.OK) return;
  const secret = ui.prompt('Strava Client Secret', 'Finns på strava.com/settings/api', ui.ButtonSet.OK_CANCEL);
  if (secret.getSelectedButton() !== ui.Button.OK) return;
  PROPS.setProperty('CLIENT_ID', id.getResponseText().trim());
  PROPS.setProperty('CLIENT_SECRET', secret.getResponseText().trim());
  ui.alert('Sparat. Kör nu "2. Koppla Strava".');
}

function kopplaStrava() {
  const ui = SpreadsheetApp.getUi();
  const clientId = PROPS.getProperty('CLIENT_ID');
  if (!clientId) { ui.alert('Kör "1. Spara Client ID och Secret" först.'); return; }
  const url = 'https://www.strava.com/oauth/authorize?client_id=' + clientId +
    '&response_type=code&redirect_uri=http://localhost&approval_prompt=force&scope=activity:read_all';
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial;font-size:14px">' +
    '<p>1. <a href="' + url + '" target="_blank">Öppna Strava och godkänn</a></p>' +
    '<p>2. Sidan som öppnas efteråt laddar inte (localhost). Det är rätt. Kopiera hela adressen från adressfältet.</p>' +
    '<p>3. Klistra in den här:</p>' +
    '<input id="u" style="width:100%" placeholder="http://localhost/?state=&code=...">' +
    '<p><button onclick="google.script.run.withSuccessHandler(function(m){document.getElementById(\'r\').innerText=m}).withFailureHandler(function(e){document.getElementById(\'r\').innerText=e.message}).bytKod(document.getElementById(\'u\').value)">Koppla</button></p>' +
    '<p id="r"></p></div>')
    .setWidth(460).setHeight(300);
  ui.showModalDialog(html, 'Koppla Strava');
}

function bytKod(adress) {
  const m = String(adress).match(/[?&]code=([^&]+)/);
  if (!m) throw new Error('Hittade ingen code i adressen.');
  const res = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post',
    payload: {
      client_id: PROPS.getProperty('CLIENT_ID'),
      client_secret: PROPS.getProperty('CLIENT_SECRET'),
      code: m[1],
      grant_type: 'authorization_code'
    },
    muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText());
  if (!data.refresh_token) throw new Error('Strava svarade: ' + res.getContentText());
  PROPS.setProperty('REFRESH_TOKEN', data.refresh_token);
  return 'Kopplat till ' + (data.athlete ? data.athlete.firstname : 'Strava') + '. Stäng rutan och kör "3. Hämta nya pass nu".';
}

function accessToken_() {
  // Access-token gäller 6 timmar. Refresh-token kan bytas vid varje anrop, spara alltid den senaste.
  const res = UrlFetchApp.fetch('https://www.strava.com/oauth/token', {
    method: 'post',
    payload: {
      client_id: PROPS.getProperty('CLIENT_ID'),
      client_secret: PROPS.getProperty('CLIENT_SECRET'),
      refresh_token: PROPS.getProperty('REFRESH_TOKEN'),
      grant_type: 'refresh_token'
    },
    muteHttpExceptions: true
  });
  const data = JSON.parse(res.getContentText());
  if (!data.access_token) throw new Error('Kunde inte förnya token: ' + res.getContentText());
  PROPS.setProperty('REFRESH_TOKEN', data.refresh_token);
  return data.access_token;
}

function get_(path, token) {
  const res = UrlFetchApp.fetch(API + path, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('Strava ' + res.getResponseCode() + ': ' + res.getContentText());
  return JSON.parse(res.getContentText());
}

function hamtaNya() {
  if (!PROPS.getProperty('REFRESH_TOKEN')) throw new Error('Strava är inte kopplat. Kör "2. Koppla Strava".');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const strava = ss.getSheetByName('Strava');
  const intervaller = ss.getSheetByName('Intervaller');
  const token = accessToken_();

  // Pass som redan finns
  const last = strava.getLastRow();
  const ids = new Set(last > 1 ? strava.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])) : []);

  // Typ per datum från Dagbok (Tröskel, Fart, ...)
  const dag = ss.getSheetByName('Dagbok').getRange('A2:E211').getValues();
  const typPerDatum = {};
  dag.forEach(r => { if (r[0] instanceof Date) typPerDatum[Utilities.formatDate(r[0], ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd')] = r[4]; });

  // Hämta från planstart, minus en dag för säkerhets skull
  const start = ss.getSheetByName('Veckoplan').getRange('B2').getValue();
  // Strava godkänner inte ett datum i framtiden, så före planstart används igår
  const after = Math.floor(Math.min(start.getTime(), Date.now()) / 1000) - 86400;

  const nyaRader = [];
  const nyaVarv = [];
  for (let page = 1; page <= 10; page++) {
    const acts = get_('/athlete/activities?after=' + after + '&per_page=100&page=' + page, token);
    if (!acts.length) break;
    acts.forEach(a => {
      if (ids.has(String(a.id))) return;
      // start_date_local är lokal tid, t.ex. 2026-10-26T18:05:13Z
      const d = a.start_date_local.substring(0, 10);
      const [y, mo, da] = d.split('-').map(Number);
      const tid = a.start_date_local.substring(11, 16);
      nyaRader.push([
        a.id,
        '=DATE(' + y + ',' + mo + ',' + da + ')',
        "'" + tid,
        a.name,
        a.sport_type,
        Math.round(a.distance / 10) / 100,
        a.moving_time,
        a.average_heartrate ? Math.round(a.average_heartrate) : '',
        a.max_heartrate ? Math.round(a.max_heartrate) : '',
        Math.round(a.total_elevation_gain || 0),
        '=HYPERLINK("https://www.strava.com/activities/' + a.id + '","Öppna")'
      ]);
      const typ = typPerDatum[d];
      if (/Run/.test(a.sport_type) && (typ === 'Tröskel' || typ === 'Fart')) {
        const laps = get_('/activities/' + a.id + '/laps', token);
        laps.forEach(l => nyaVarv.push([
          '=DATE(' + y + ',' + mo + ',' + da + ')',
          a.id,
          l.lap_index,
          Math.round(l.distance),
          l.moving_time,
          l.average_heartrate ? Math.round(l.average_heartrate) : ''
        ]));
      }
    });
    if (acts.length < 100) break;
  }

  if (nyaRader.length) {
    strava.getRange(strava.getLastRow() + 1, 1, nyaRader.length, 11).setValues(nyaRader);
  }
  if (nyaVarv.length) {
    const lastIv = Math.max(1, lastFilled_(intervaller, 1));
    intervaller.getRange(lastIv + 1, 1, nyaVarv.length, 6).setValues(nyaVarv);
  }
  PROPS.setProperty('SENAST', new Date().toISOString());
  return nyaRader.length + ' nya pass, ' + nyaVarv.length + ' varv';
}

function lastFilled_(sheet, col) {
  const vals = sheet.getRange(1, col, sheet.getMaxRows(), 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) if (vals[i][0] !== '') return i + 1;
  return 0;
}

function startaTrigger() {
  stoppaTrigger();
  ScriptApp.newTrigger('hamtaNya').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('Arket hämtar nya pass från Strava varje timme.');
}

function stoppaTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'hamtaNya')
    .forEach(t => ScriptApp.deleteTrigger(t));
}
