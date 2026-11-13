// Kalender-Brücke: liest einen privaten iCal-Feed (z. B. Google Kalender), entfernt
// vertrauliche Inhalte nach festen Regeln und stellt das Ergebnis als eigenen,
// abonnierbaren iCal-Feed unter einer geheimen Adresse bereit.
import * as z from 'zod/v4';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { publicHttp } from './coolify-public-http.mjs';
import { safeEqual } from './crypto.mjs';

const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
const DISPLAY_TIME_ZONE = 'Europe/Berlin';

function bad(message, code = 400) {
  const error = new Error(message);
  error.statusCode = code;
  return error;
}

export const DEFAULT_RULES = Object.freeze({
  calendar_name: 'Itzehoer-Termine',
  replacement_title: 'Itzehoer-Termin',
  exclude_prefix: '..',
  keep_all_day_titles: true,
  office_address: 'Bahnhofstraße 16, 24392 Süderbrarup',
  office_label: 'Büro',
  past_days: 30,
  refresh_minutes: 15
});

const singleLine = max =>
  z
    .string()
    .trim()
    .max(max)
    .regex(/^[^\r\n]*$/, 'Keine Zeilenumbrüche.');

export const settingsPayload = z
  .object({
    enabled: z.boolean().default(true),
    // Leer lassen, um die bereits hinterlegte geheime Adresse zu behalten.
    source_url: z.string().trim().max(1000).default(''),
    calendar_name: singleLine(80).min(1).default(DEFAULT_RULES.calendar_name),
    replacement_title: singleLine(120).min(1).default(DEFAULT_RULES.replacement_title),
    exclude_prefix: singleLine(20).default(DEFAULT_RULES.exclude_prefix),
    keep_all_day_titles: z.boolean().default(DEFAULT_RULES.keep_all_day_titles),
    office_address: singleLine(200).default(DEFAULT_RULES.office_address),
    office_label: singleLine(60).default(DEFAULT_RULES.office_label),
    past_days: z.number().int().min(0).max(3650).default(DEFAULT_RULES.past_days),
    refresh_minutes: z.number().int().min(5).max(1440).default(DEFAULT_RULES.refresh_minutes)
  })
  .strict();

export function normalizeSourceUrl(raw) {
  let url;
  try {
    // Google bietet die Adresse teils als webcal:// an.
    url = new URL(
      String(raw)
        .trim()
        .replace(/^webcal:\/\//i, 'https://')
    );
  } catch {
    throw bad('Bitte die vollständige geheime iCal-Adresse einfügen.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw bad('Nur öffentliche HTTPS-Adressen ohne Zugangsdaten oder Sonderport sind erlaubt.');
  return url.href;
}

// ---------------------------------------------------------------------------
// iCalendar lesen
// ---------------------------------------------------------------------------

export function unescapeText(value) {
  return String(value ?? '').replace(/\\([\\;,nN])/g, (_m, c) => (c === 'n' || c === 'N' ? '\n' : c));
}

export function escapeText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Teilt "NAME;PARAM=..:WERT" unter Beachtung von Anführungszeichen in Parametern.
export function parseLine(line) {
  let quoted = false;
  let split = -1;
  let nameEnd = -1;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') quoted = !quoted;
    else if (!quoted && c === ';' && nameEnd < 0) nameEnd = i;
    else if (!quoted && c === ':') {
      split = i;
      break;
    }
  }
  if (split < 0) return null;
  if (nameEnd < 0 || nameEnd > split) nameEnd = split;
  return {
    name: line.slice(0, nameEnd).toUpperCase(),
    params: line.slice(nameEnd, split),
    value: line.slice(split + 1)
  };
}

export function parseCalendar(text) {
  const lines = String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\r?\n[ \t]/g, '')
    .split(/\r?\n/);
  const events = [];
  const timezones = [];
  let timeZoneName = '';
  let event = null;
  let timezone = null;
  let nested = 0;
  let sawCalendar = false;
  for (const line of lines) {
    if (!line) continue;
    const upper = line.toUpperCase();
    if (upper === 'BEGIN:VCALENDAR') {
      sawCalendar = true;
      continue;
    }
    if (timezone) {
      timezone.push(line);
      if (upper === 'END:VTIMEZONE') {
        timezones.push(timezone);
        timezone = null;
      }
      continue;
    }
    if (event) {
      if (upper.startsWith('BEGIN:')) nested++;
      else if (upper.startsWith('END:')) {
        if (nested) nested--;
        else if (upper === 'END:VEVENT') {
          events.push(event);
          event = null;
        }
      } else if (!nested) {
        const prop = parseLine(line);
        if (prop) event.push(prop);
      }
      continue;
    }
    if (upper === 'BEGIN:VEVENT') {
      event = [];
      nested = 0;
    } else if (upper === 'BEGIN:VTIMEZONE') timezone = [line];
    else if (upper.startsWith('X-WR-TIMEZONE:')) timeZoneName = line.slice(14).trim();
  }
  if (!sawCalendar) throw bad('Die Quelle liefert keinen gültigen iCal-Kalender.', 502);
  return { events, timezones, timeZoneName };
}

// ---------------------------------------------------------------------------
// Regeln
// ---------------------------------------------------------------------------

function addressTokens(value) {
  const text = String(value ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ae/g, 'a')
    .replace(/oe/g, 'o')
    .replace(/ue/g, 'u')
    .replace(/strasse|str\./g, 'str');
  return text.match(/[a-z]+|\d+/g) || [];
}

function containsSequence(haystack, needle) {
  if (!needle.length) return true;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

export function matchesOffice(location, officeAddress) {
  const parts = String(officeAddress ?? '')
    .split(',')
    .map(addressTokens)
    .filter(tokens => tokens.length);
  if (!parts.length) return false;
  const tokens = addressTokens(location);
  return parts.every(part => containsSequence(tokens, part));
}

// Büroadresse → Bezeichnung, sonst nur der Ortsname hinter der Postleitzahl.
// Ohne erkennbare Postleitzahl bleibt der Ort leer, damit keine Namen durchrutschen.
export function publicLocation(location, rules) {
  const text = unescapeText(location).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (matchesOffice(text, rules.office_address)) return rules.office_label || '';
  const match = /(?:^|[\s,])\d{4,5}\s+([^\d,][^,]*)/.exec(text);
  return match ? match[1].trim().slice(0, 80) : '';
}

const DATE_VALUE = /^\d{8}(?:T\d{6}Z?)?$/;
const DATE_LIST = /^\d{8}(?:T\d{6}Z?)?(?:,\d{8}(?:T\d{6}Z?)?)*$/;
const DATE_PARAMS = /^(?:;(?:VALUE=(?:DATE|DATE-TIME|PERIOD)|TZID=[A-Za-z0-9_+\-/. ]{1,80}|RANGE=THISANDFUTURE))*$/i;
const patterns = {
  DTSTART: DATE_VALUE,
  DTEND: DATE_VALUE,
  'RECURRENCE-ID': DATE_VALUE,
  EXDATE: DATE_LIST,
  RDATE: /^[0-9TZ,/PWDHMS+\-]+$/,
  DURATION: /^[+-]?P[0-9WDTHMS]+$/,
  RRULE: /^[A-Z0-9=;,+\-]+$/i,
  TRANSP: /^(?:OPAQUE|TRANSPARENT)$/i,
  SEQUENCE: /^\d{1,9}$/,
  'LAST-MODIFIED': /^\d{8}T\d{6}Z$/
};

function cleanProp(prop) {
  const pattern = patterns[prop.name];
  if (!pattern || !pattern.test(prop.value)) return null;
  const dated = ['DTSTART', 'DTEND', 'RECURRENCE-ID', 'EXDATE', 'RDATE'].includes(prop.name);
  if (dated ? !DATE_PARAMS.test(prop.params) : prop.params) return null;
  return prop;
}

const first = (event, name) => event.find(prop => prop.name === name);

// Grobe Zeitangabe für Sortierung und Altersgrenze. Ortszeiten ohne Z werden wie UTC
// behandelt; die Abweichung von wenigen Stunden ist für eine Tagesgrenze unerheblich.
function roughTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(value || '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : NaN;
}

function displayStart(prop) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(prop.value);
  if (!m[4]) return `${m[3]}.${m[2]}.${m[1]}`;
  if (prop.value.endsWith('Z'))
    return new Date(roughTime(prop.value)).toLocaleString('de-DE', {
      timeZone: DISPLAY_TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}`;
}

export function hashUid(uid, salt) {
  return (
    crypto
      .createHash('sha256')
      .update(String(salt) + '\n' + String(uid))
      .digest('hex')
      .slice(0, 32) + '@siteops-kalender'
  );
}

export function fold(line) {
  const out = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * Wendet die Regeln auf den Quellkalender an.
 * @returns {{ ics: string, stats: object, preview: object[] }}
 */
export function transformCalendar(text, rules, { salt = '', now = Date.now() } = {}) {
  const { events, timezones, timeZoneName } = parseCalendar(text);
  const prefix = rules.exclude_prefix || '';
  const cutoff = rules.past_days > 0 ? now - rules.past_days * 86400000 : -Infinity;
  const stats = {
    source_events: events.length,
    included: 0,
    anonymized: 0,
    original_titles: 0,
    excluded_prefix: 0,
    excluded_cancelled: 0,
    excluded_past: 0,
    skipped_invalid: 0,
    series: 0
  };
  const kept = [];
  // Ausgeschlossene Einzeltermine einer Serie müssen in der Serie ausgenommen werden,
  // sonst erschiene dort wieder das ursprüngliche Serienelement.
  const suppressed = new Map();
  for (const event of events) {
    const uid = first(event, 'UID')?.value;
    const start = first(event, 'DTSTART') && cleanProp(first(event, 'DTSTART'));
    if (!uid || !start) {
      stats.skipped_invalid++;
      continue;
    }
    const recurrence = first(event, 'RECURRENCE-ID') && cleanProp(first(event, 'RECURRENCE-ID'));
    const title = unescapeText(first(event, 'SUMMARY')?.value).trim();
    const cancelled = /^CANCELLED$/i.test(first(event, 'STATUS')?.value || '');
    const hidden = Boolean(prefix) && title.startsWith(prefix);
    if (hidden || cancelled) {
      stats[hidden ? 'excluded_prefix' : 'excluded_cancelled']++;
      if (recurrence) suppressed.set(uid, [...(suppressed.get(uid) || []), recurrence]);
      continue;
    }
    const recurring = event.some(prop => prop.name === 'RRULE' || prop.name === 'RDATE');
    const end = first(event, 'DTEND') && cleanProp(first(event, 'DTEND'));
    // Verschobene Einzeltermine einer Serie bleiben erhalten, damit die Serie stimmt.
    if (!recurring && !recurrence && roughTime((end || start).value) < cutoff) {
      stats.excluded_past++;
      continue;
    }
    kept.push({ event, uid, start, end, recurrence, title, recurring });
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lorzen SiteOps//Kalender-Bruecke//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:' + escapeText(rules.calendar_name),
    ...(/^[A-Za-z0-9_+\-/]{1,80}$/.test(timeZoneName) ? ['X-WR-TIMEZONE:' + timeZoneName] : []),
    'X-PUBLISHED-TTL:PT' + rules.refresh_minutes + 'M'
  ];
  const usedZones = new Set();
  const body = [];
  const preview = [];
  const stamp = new Date(now).toISOString().replace(/[-:]|\.\d{3}/g, '');
  for (const item of kept) {
    const allDay = /VALUE=DATE(?:;|$)/i.test(item.start.params);
    const original = allDay && rules.keep_all_day_titles;
    const title = original ? item.title || rules.replacement_title : rules.replacement_title;
    const location = publicLocation(first(item.event, 'LOCATION')?.value, rules);
    stats.included++;
    stats[original ? 'original_titles' : 'anonymized']++;
    if (item.recurring) stats.series++;
    body.push('BEGIN:VEVENT', 'UID:' + hashUid(item.uid, salt), 'DTSTAMP:' + stamp);
    const push = prop => {
      const zone = /TZID=([^;]+)/i.exec(prop.params)?.[1];
      if (zone) usedZones.add(zone);
      body.push(prop.name + prop.params + ':' + prop.value);
    };
    push(item.start);
    if (item.end) push(item.end);
    if (item.recurrence) push(item.recurrence);
    for (const prop of item.event) {
      if (['DTSTART', 'DTEND', 'RECURRENCE-ID'].includes(prop.name) || !patterns[prop.name]) continue;
      const clean = cleanProp(prop);
      if (clean) push(clean);
    }
    if (!item.recurrence) for (const prop of suppressed.get(item.uid) || []) push({ ...prop, name: 'EXDATE' });
    body.push('SUMMARY:' + escapeText(title));
    if (location) body.push('LOCATION:' + escapeText(location));
    body.push('END:VEVENT');
    if (!item.recurring && roughTime(item.start.value) >= now - 86400000)
      preview.push({
        sort: roughTime(item.start.value),
        start: displayStart(item.start),
        all_day: allDay,
        title,
        location
      });
  }
  // Zeitzonendefinitionen enthalten keine Termindaten und werden unverändert übernommen.
  for (const zone of timezones) {
    const id = zone.find(line => /^TZID:/i.test(line))?.slice(5);
    if (id && usedZones.has(id)) lines.push(...zone);
  }
  lines.push(...body, 'END:VCALENDAR');
  preview.sort((a, b) => a.sort - b.sort);
  return {
    ics: lines.map(fold).join('\r\n') + '\r\n',
    stats,
    preview: preview.slice(0, 12).map(({ sort: _sort, ...entry }) => entry)
  };
}

// ---------------------------------------------------------------------------
// Dienst
// ---------------------------------------------------------------------------

const tokenHash = token => crypto.createHash('sha256').update(token).digest('hex');
const parseJson = value => {
  if (value && typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export function createCalendarBridge({
  db,
  encrypt,
  decrypt,
  publicBaseUrl,
  fetchSource = url => publicHttp(url, { maxBytes: MAX_SOURCE_BYTES, headers: { 'User-Agent': 'SiteOps-Kalender/1' } }),
  now = () => Date.now()
}) {
  let running = null;

  async function load() {
    const [rows] = await db.query('SELECT * FROM calendar_bridge WHERE id=1');
    if (rows[0]) return rows[0];
    const token = crypto.randomBytes(32).toString('base64url');
    await db.query(
      'INSERT IGNORE INTO calendar_bridge(id,feed_token_encrypted,feed_token_hash,uid_salt,calendar_name,replacement_title,' +
        'exclude_prefix,keep_all_day_titles,office_address,office_label,past_days,refresh_minutes) VALUES(1,?,?,?,?,?,?,?,?,?,?,?)',
      [
        encrypt(token),
        tokenHash(token),
        crypto.randomBytes(16).toString('hex'),
        DEFAULT_RULES.calendar_name,
        DEFAULT_RULES.replacement_title,
        DEFAULT_RULES.exclude_prefix,
        Number(DEFAULT_RULES.keep_all_day_titles),
        DEFAULT_RULES.office_address,
        DEFAULT_RULES.office_label,
        DEFAULT_RULES.past_days,
        DEFAULT_RULES.refresh_minutes
      ]
    );
    const [created] = await db.query('SELECT * FROM calendar_bridge WHERE id=1');
    return created[0];
  }

  const rulesOf = row => ({
    calendar_name: row.calendar_name,
    replacement_title: row.replacement_title,
    exclude_prefix: row.exclude_prefix,
    keep_all_day_titles: Boolean(row.keep_all_day_titles),
    office_address: row.office_address,
    office_label: row.office_label,
    past_days: Number(row.past_days),
    refresh_minutes: Number(row.refresh_minutes)
  });

  function describe(row, { secrets }) {
    const cached = parseJson(row.last_result) || {};
    let host = null;
    if (row.source_url_encrypted)
      try {
        host = new URL(decrypt(row.source_url_encrypted)).hostname;
      } catch {}
    return {
      enabled: Boolean(row.enabled),
      source_configured: Boolean(row.source_url_encrypted),
      source_host: host,
      ...rulesOf(row),
      last_sync_at: row.cached_at ? new Date(row.cached_at).toISOString() : null,
      last_error: row.last_error || null,
      stats: cached.stats || null,
      // Feed-Adresse und Terminvorschau bleiben dem Dashboard vorbehalten.
      ...(secrets
        ? {
            feed_url:
              publicBaseUrl().replace(/\/+$/, '') + '/calendar/feed/' + decrypt(row.feed_token_encrypted) + '.ics',
            preview: cached.preview || []
          }
        : {})
    };
  }

  async function refreshNow() {
    const row = await load();
    if (!row.source_url_encrypted) throw bad('Es ist noch keine Quelladresse hinterlegt.', 409);
    try {
      const response = await fetchSource(decrypt(row.source_url_encrypted));
      if (response.status !== 200)
        throw bad(
          'Der Quellkalender antwortet mit HTTP ' + response.status + '. Bitte die geheime Adresse prüfen.',
          502
        );
      const result = transformCalendar(response.body, rulesOf(row), { salt: row.uid_salt, now: now() });
      await db.query('UPDATE calendar_bridge SET cached_ics=?,cached_at=?,last_error=NULL,last_result=? WHERE id=1', [
        result.ics,
        new Date(now()),
        JSON.stringify({ stats: result.stats, preview: result.preview })
      ]);
      return result;
    } catch (error) {
      // Nur fachliche Meldungen speichern; Netzwerkfehler enthalten nie die geheime Adresse.
      const message = error.statusCode ? error.message : 'Quellkalender nicht erreichbar oder nicht lesbar.';
      await db.query('UPDATE calendar_bridge SET last_error=? WHERE id=1', [message.slice(0, 300)]);
      throw error.statusCode ? error : bad(message, 502);
    }
  }

  // Gleichzeitige Abrufe (Worker, Dashboard, Feed) teilen sich einen Lauf.
  function refresh() {
    running ||= refreshNow().finally(() => {
      running = null;
    });
    return running;
  }

  const stale = row =>
    !row.cached_at || now() - new Date(row.cached_at).getTime() >= Number(row.refresh_minutes) * 60000;

  return {
    async status({ secrets = false } = {}) {
      return describe(await load(), { secrets });
    },
    async save(raw) {
      const data = settingsPayload.parse(raw);
      const row = await load();
      const source = data.source_url ? encrypt(normalizeSourceUrl(data.source_url)) : row.source_url_encrypted;
      await db.query(
        'UPDATE calendar_bridge SET enabled=?,source_url_encrypted=?,calendar_name=?,replacement_title=?,exclude_prefix=?,' +
          'keep_all_day_titles=?,office_address=?,office_label=?,past_days=?,refresh_minutes=? WHERE id=1',
        [
          Number(data.enabled),
          source,
          data.calendar_name,
          data.replacement_title,
          data.exclude_prefix,
          Number(data.keep_all_day_titles),
          data.office_address,
          data.office_label,
          data.past_days,
          data.refresh_minutes
        ]
      );
      // Geänderte Regeln sofort anwenden; ein Abruffehler wird im Status ausgewiesen.
      if (source) await refresh().catch(() => {});
      return describe(await load(), { secrets: true });
    },
    async refresh() {
      const { stats } = await refresh();
      return { ok: true, stats };
    },
    async rotateToken() {
      await load();
      const token = crypto.randomBytes(32).toString('base64url');
      await db.query('UPDATE calendar_bridge SET feed_token_encrypted=?,feed_token_hash=? WHERE id=1', [
        encrypt(token),
        tokenHash(token)
      ]);
      return describe(await load(), { secrets: true });
    },
    // Liefert den Feed nur für das aktuelle Token; sonst null (→ 404).
    async feed(token) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
      let row = await load();
      if (!row.enabled || !safeEqual(tokenHash(token), row.feed_token_hash)) return null;
      if (row.source_url_encrypted && stale(row)) {
        // Bei einem Quellfehler bleibt der letzte gültige Stand abrufbar.
        await refresh().catch(() => {});
        row = await load();
      }
      return row.cached_ics || null;
    },
    async tick() {
      const row = await load();
      if (row.enabled && row.source_url_encrypted && stale(row)) await refresh();
    },
    start() {
      const run = () => this.tick().catch(() => {});
      run();
      const timer = setInterval(run, 5 * 60 * 1000);
      timer.unref();
      return () => clearInterval(timer);
    }
  };
}

// ---------------------------------------------------------------------------
// Oberfläche und Routen
// ---------------------------------------------------------------------------

export function renderCalendarBridgePage() {
  return `<header><div>
    <h1>Kalender-Brücke</h1>
    <p class="lead">Geschäftstermine anonymisiert in den Familienkalender einbinden. Die Brücke liest deinen Business-Kalender und stellt eine bereinigte Abo-Adresse bereit.</p></div></header>
    <div id="calendar-notice" class="tools-notice" role="status" aria-live="polite" hidden></div>
    <section class="tools-section">
      <div class="tools-sectionhead"><div><span class="eyebrow">Status</span><h2>Abo-Adresse für den Familienkalender</h2>
      <p>In Google Kalender unter „Weitere Kalender → Per URL“ einfügen. Wer die Adresse kennt, kann die bereinigten Termine lesen.</p></div>
      <span class="tools-badge" id="calendar-state">wird geladen …</span></div>
      <div class="tools-input-row"><input id="calendar-feed-url" aria-label="Abo-Adresse" readonly>
        <button type="button" id="calendar-copy">Kopieren</button></div>
      <div class="calendar-actions"><button type="button" id="calendar-refresh" class="ghost">Jetzt abgleichen</button>
        <button type="button" id="calendar-rotate" class="ghost">Neue Adresse erzeugen</button></div>
      <dl class="calendar-stats" id="calendar-stats"></dl>
    </section>
    <section class="tools-section">
      <div class="tools-sectionhead"><div><span class="eyebrow">Regeln</span><h2>Quelle und Anonymisierung</h2>
      <p>Beschreibung, Teilnehmer, Links und Anhänge werden nie übernommen.</p></div></div>
      <form id="calendar-form" class="tools-edit-form calendar-form">
        <label>Geheime iCal-Adresse des Business-Kalenders
          <input name="source_url" type="url" maxlength="1000" autocomplete="off" placeholder="https://calendar.google.com/calendar/ical/…/private-…/basic.ics">
          <small id="calendar-source-hint">Google Kalender → Einstellungen des Kalenders → „Privatadresse im iCal-Format“.</small></label>
        <div class="tools-form-grid">
          <label>Titel für anonymisierte Termine<input name="replacement_title" required maxlength="120"></label>
          <label>Nicht übernehmen, wenn der Titel beginnt mit<input name="exclude_prefix" maxlength="20"></label>
        </div>
        <label class="tools-favorite"><input name="keep_all_day_titles" type="checkbox"> Ganztägige Termine mit Originaltitel übernehmen</label>
        <div class="tools-form-grid">
          <label>Büroadresse<input name="office_address" maxlength="200"></label>
          <label>Anzeige für die Büroadresse<input name="office_label" maxlength="60"></label>
        </div>
        <p class="tools-disclaimer">Bei allen anderen Adressen wird nur der Ortsname hinter der Postleitzahl übernommen. Ohne erkennbare Postleitzahl bleibt der Ort leer.</p>
        <div class="tools-form-grid">
          <label>Name des Kalenders<input name="calendar_name" required maxlength="80"></label>
          <label>Vergangene Termine (Tage, 0 = alle)<input name="past_days" type="number" min="0" max="3650" required></label>
        </div>
        <div class="tools-form-grid">
          <label>Abgleich alle (Minuten)<input name="refresh_minutes" type="number" min="5" max="1440" required></label>
          <label class="tools-favorite"><input name="enabled" type="checkbox"> Abo-Adresse aktiv</label>
        </div>
        <div class="tools-dialog-actions"><button type="submit" id="calendar-save">Speichern</button></div>
      </form>
    </section>
    <section class="tools-section">
      <div class="tools-sectionhead"><div><span class="eyebrow">Kontrolle</span><h2>So sieht es die Familie</h2>
      <p>Die nächsten Einzeltermine nach Anwendung der Regeln. Serientermine erscheinen im Kalender, aber nicht in dieser Vorschau.</p></div></div>
      <div class="calendar-preview-wrap"><table class="calendar-preview"><thead><tr><th>Beginn</th><th>Titel</th><th>Ort</th></tr></thead>
      <tbody id="calendar-preview"><tr><td colspan="3">Vorschau wird geladen …</td></tr></tbody></table></div>
    </section>
    <link rel="stylesheet" href="/assets/tools.css"><link rel="stylesheet" href="/assets/calendar-bridge.css">
    <script defer src="/assets/calendar-bridge.js"></script>`;
}

export function registerCalendarBridgeRoutes(app, { service, page, publicBaseUrl }) {
  // async: ein synchroner Hook ohne done-Aufruf würde die Anfrage nie fortsetzen.
  const guard = async (req, reply) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json'))
      return reply.code(415).send({ error: 'JSON erforderlich.' });
    if (req.headers.origin && req.headers.origin !== new URL(publicBaseUrl()).origin)
      return reply.code(403).send({ error: 'Fremde Herkunft abgelehnt.' });
  };
  const asset = (name, type) =>
    app.get('/assets/' + name, async (_r, reply) =>
      reply
        .type(type)
        .header('Cache-Control', 'no-store')
        .send(await readFile(new URL('../public/' + name, import.meta.url), 'utf8'))
    );
  asset('calendar-bridge.js', 'text/javascript');
  asset('calendar-bridge.css', 'text/css');
  app.get('/calendar-bridge', async (_r, reply) =>
    reply.type('text/html').send(page('Kalender-Brücke', renderCalendarBridgePage()))
  );
  app.get('/api/calendar-bridge', () => service.status({ secrets: true }));
  app.put('/api/calendar-bridge', { preHandler: guard }, req => service.save(req.body));
  app.post('/api/calendar-bridge/refresh', { preHandler: guard }, () => service.refresh());
  app.post('/api/calendar-bridge/token', { preHandler: guard }, () => service.rotateToken());
  // Öffentlich, aber nur mit dem geheimen Token in der Adresse (siehe onRequest-Ausnahme in app.mjs).
  app.get(
    '/calendar/feed/:file',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const match = /^([A-Za-z0-9_-]+)\.ics$/.exec(String(req.params.file));
      const ics = match ? await service.feed(match[1]) : null;
      if (!ics) return reply.code(404).type('text/plain').send('Not found');
      return reply
        .type('text/calendar; charset=utf-8')
        .header('Content-Disposition', 'inline; filename="kalender.ics"')
        .header('X-Robots-Tag', 'noindex')
        .send(ics);
    }
  );
}
