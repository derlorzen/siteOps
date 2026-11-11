import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {
  createCalendarBridge,
  DEFAULT_RULES,
  fold,
  matchesOffice,
  normalizeSourceUrl,
  parseCalendar,
  publicLocation,
  registerCalendarBridgeRoutes,
  renderCalendarBridgePage,
  transformCalendar
} from '../lib/calendar-bridge.mjs';

const NOW = Date.UTC(2026, 10, 11, 22, 0, 0);
const crlf = lines => lines.join('\r\n') + '\r\n';
const SOURCE = crlf([
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'X-WR-CALNAME:Business',
  'X-WR-TIMEZONE:Europe/Berlin',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Berlin',
  'BEGIN:STANDARD',
  'DTSTART:19701025T030000',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
  // Kundentermin im Büro mit vertraulichen Angaben und gefalteter Zeile
  'BEGIN:VEVENT',
  'DTSTART:20261112T090000Z',
  'DTEND:20261112T100000Z',
  'UID:kunde-1@google.com',
  'SUMMARY:Beratung Familie Petersen\\, Hausrat',
  'DESCRIPTION:Vertragsnummer 4711\\nRückruf 04641 123456 wegen Schaden am',
  '  Dach',
  'LOCATION:Bahnhofstr. 16\\, 24392 Süderbrarup\\, Deutschland',
  'ORGANIZER;CN="Lorenzen: Büro":mailto:buero@example.org',
  'ATTENDEE;CN=Petersen:mailto:petersen@example.org',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:Petersen anrufen',
  'TRIGGER:-PT30M',
  'END:VALARM',
  'END:VEVENT',
  // Außentermin: nur der Ort darf erscheinen
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261113T140000',
  'DTEND;TZID=Europe/Berlin:20261113T150000',
  'UID:kunde-2@google.com',
  'SUMMARY:Hausbesuch Jensen',
  'LOCATION:Mühlenweg 7\\, 24376 Kappeln\\, Deutschland',
  'END:VEVENT',
  // Ort ohne Postleitzahl: könnte ein Name sein und bleibt leer
  'BEGIN:VEVENT',
  'DTSTART:20261114T080000Z',
  'DTEND:20261114T083000Z',
  'UID:kunde-3@google.com',
  'SUMMARY:Telefonat Hansen',
  'LOCATION:bei Hansen zu Hause',
  'END:VEVENT',
  // Privat markiert: zwei Punkte am Anfang
  'BEGIN:VEVENT',
  'DTSTART:20261115T180000Z',
  'DTEND:20261115T190000Z',
  'UID:privat-1@google.com',
  'SUMMARY:..Zahnarzt',
  'END:VEVENT',
  // Ganztägig: Originaltitel bleibt
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261120',
  'DTEND;VALUE=DATE:20261121',
  'UID:ganztags-1@google.com',
  'SUMMARY:Schulung Itzehoe',
  'DESCRIPTION:intern',
  'LOCATION:Itzehoer Platz 1\\, 25521 Itzehoe',
  'END:VEVENT',
  // Ganztägig, aber privat markiert
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261121',
  'DTEND;VALUE=DATE:20261122',
  'UID:ganztags-2@google.com',
  'SUMMARY:.. Geburtstag',
  'END:VEVENT',
  // Serie mit einem verschobenen und einem privat markierten Einzeltermin
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261102T100000',
  'DTEND;TZID=Europe/Berlin:20261102T110000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO',
  'EXDATE;TZID=Europe/Berlin:20261109T100000',
  'UID:serie-1@google.com',
  'SUMMARY:Jour fixe Agentur',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261116T130000',
  'DTEND;TZID=Europe/Berlin:20261116T140000',
  'RECURRENCE-ID;TZID=Europe/Berlin:20261116T100000',
  'UID:serie-1@google.com',
  'SUMMARY:Jour fixe Agentur (verschoben)',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Berlin:20261123T100000',
  'DTEND;TZID=Europe/Berlin:20261123T110000',
  'RECURRENCE-ID;TZID=Europe/Berlin:20261123T100000',
  'UID:serie-1@google.com',
  'SUMMARY:..fällt für mich aus',
  'END:VEVENT',
  // Abgesagt und lange vorbei
  'BEGIN:VEVENT',
  'DTSTART:20261118T090000Z',
  'DTEND:20261118T100000Z',
  'UID:abgesagt-1@google.com',
  'STATUS:CANCELLED',
  'SUMMARY:Termin Clausen',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20250301T090000Z',
  'DTEND:20250301T100000Z',
  'UID:alt-1@google.com',
  'SUMMARY:Alter Termin Thomsen',
  'END:VEVENT',
  'END:VCALENDAR'
]);

const unfolded = ics => ics.replace(/\r\n /g, '');

test('customer appointments are anonymized and private details never reach the feed', () => {
  const { ics, stats } = transformCalendar(SOURCE, DEFAULT_RULES, { salt: 'salt', now: NOW });
  const text = unfolded(ics);
  for (const secret of [
    'Petersen',
    'Jensen',
    'Hansen',
    'Clausen',
    'Thomsen',
    'Zahnarzt',
    'Geburtstag',
    'fällt',
    'Jour fixe',
    'Vertragsnummer',
    '04641',
    'Dach',
    'example.org',
    'ATTENDEE',
    'ORGANIZER',
    'DESCRIPTION',
    'VALARM',
    'Mühlenweg',
    'Bahnhofstr',
    'Itzehoer Platz',
    'google.com'
  ])
    assert.ok(!text.includes(secret), secret + ' must not appear in the family feed');
  assert.equal(stats.source_events, 11);
  assert.equal(stats.excluded_prefix, 3);
  assert.equal(stats.excluded_cancelled, 1);
  assert.equal(stats.excluded_past, 1);
  assert.equal(stats.included, 6);
  assert.equal(stats.anonymized, 5);
  assert.equal(stats.original_titles, 1);
  assert.equal((text.match(/SUMMARY:Itzehoer-Termin\r\n/g) || []).length, 5);
  assert.match(text, /X-WR-CALNAME:Itzehoer-Termine\r\n/);
});

test('all-day events keep their title; locations become the office label or only the town', () => {
  const text = unfolded(transformCalendar(SOURCE, DEFAULT_RULES, { salt: 'salt', now: NOW }).ics);
  const events = text.split('BEGIN:VEVENT').slice(1);
  const byStart = start => events.find(event => event.includes(start));
  assert.match(byStart('DTSTART:20261112T090000Z'), /LOCATION:Büro\r\n/);
  assert.match(byStart('DTSTART;TZID=Europe/Berlin:20261113T140000'), /LOCATION:Kappeln\r\n/);
  assert.doesNotMatch(byStart('DTSTART:20261114T080000Z'), /LOCATION/);
  const allDay = byStart('DTSTART;VALUE=DATE:20261120');
  assert.match(allDay, /SUMMARY:Schulung Itzehoe\r\n/);
  assert.match(allDay, /DTEND;VALUE=DATE:20261121\r\n/);
  assert.match(allDay, /LOCATION:Itzehoe\r\n/);
  assert.ok(!text.includes('DTSTART;VALUE=DATE:20261121'), 'all-day event with prefix stays private');

  const anonymous = transformCalendar(
    SOURCE,
    { ...DEFAULT_RULES, keep_all_day_titles: false },
    { salt: 'salt', now: NOW }
  );
  assert.ok(!anonymous.ics.includes('Schulung'));
  assert.equal(anonymous.stats.original_titles, 0);
});

test('series stay intact: moved instances are kept and hidden instances are excluded from the series', () => {
  const text = unfolded(transformCalendar(SOURCE, DEFAULT_RULES, { salt: 'salt', now: NOW }).ics);
  const events = text.split('BEGIN:VEVENT').slice(1);
  const master = events.find(event => event.includes('RRULE:FREQ=WEEKLY;BYDAY=MO'));
  assert.match(master, /EXDATE;TZID=Europe\/Berlin:20261109T100000\r\n/);
  assert.match(master, /EXDATE;TZID=Europe\/Berlin:20261123T100000\r\n/, 'hidden instance must not reappear');
  const moved = events.find(event => event.includes('RECURRENCE-ID;TZID=Europe/Berlin:20261116T100000'));
  assert.match(moved, /DTSTART;TZID=Europe\/Berlin:20261116T130000\r\n/);
  const uid = event => /UID:(\S+)/.exec(event)[1];
  assert.equal(uid(master), uid(moved), 'override and series share the hashed UID');
  assert.match(uid(master), /^[0-9a-f]{32}@siteops-kalender$/);
  assert.match(text, /BEGIN:VTIMEZONE\r\nTZID:Europe\/Berlin\r\n/);
  const other = transformCalendar(SOURCE, DEFAULT_RULES, { salt: 'other', now: NOW }).ics;
  assert.ok(!other.includes(uid(master)), 'UIDs depend on the installation salt');
});

test('injected or malformed properties are dropped instead of copied', () => {
  const hostile = crlf([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:x1',
    'DTSTART;TZID="Europe/Berlin";X-NAME=Petersen:20261201T100000',
    'SUMMARY:Geheim',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:x2',
    'DTSTART:20261202T100000Z',
    'RRULE:FREQ=DAILY;X-NOTE=Kunde Petersen',
    'TRANSP:Petersen',
    'SUMMARY:Geheim',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'SUMMARY:ohne UID',
    'END:VEVENT',
    'END:VCALENDAR'
  ]);
  const { ics, stats } = transformCalendar(hostile, DEFAULT_RULES, { now: NOW });
  assert.ok(!ics.includes('Petersen'));
  assert.ok(!ics.includes('Geheim'));
  assert.equal(stats.skipped_invalid, 2);
  assert.equal(stats.included, 1);
  assert.throws(() => parseCalendar('<html>Login</html>'), /iCal/);
});

test('office matching tolerates spelling variants but not other addresses', () => {
  const office = DEFAULT_RULES.office_address;
  for (const variant of [
    'Bahnhofstraße 16, 24392 Süderbrarup',
    'Bahnhofstr. 16, 24392 Süderbrarup, Deutschland',
    'bahnhofstrasse 16 24392 suederbrarup',
    'Itzehoer Versicherungen, Bahnhofstraße 16, 24392 Süderbrarup'
  ])
    assert.equal(matchesOffice(variant, office), true, variant);
  for (const other of ['Bahnhofstraße 6, 24392 Süderbrarup', 'Bahnhofstraße 16, 24376 Kappeln', 'Süderbrarup', ''])
    assert.equal(matchesOffice(other, office), false, other);
  assert.equal(publicLocation('Große Straße 3\\, 24937 Flensburg', DEFAULT_RULES), 'Flensburg');
  assert.equal(publicLocation('Storegade 5, 6200 Aabenraa, Danmark', DEFAULT_RULES), 'Aabenraa');
  assert.equal(publicLocation('Petersen', DEFAULT_RULES), '');
  assert.equal(matchesOffice('Bahnhofstraße 16, 24392 Süderbrarup', ''), false);
});

test('output lines are folded to 75 octets and source addresses must be public HTTPS', () => {
  const folded = fold('SUMMARY:' + 'ä'.repeat(120));
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75);
  assert.equal(folded.replace(/\r\n /g, ''), 'SUMMARY:' + 'ä'.repeat(120));
  assert.equal(
    normalizeSourceUrl('webcal://calendar.google.com/calendar/ical/a/private-b/basic.ics'),
    'https://calendar.google.com/calendar/ical/a/private-b/basic.ics'
  );
  for (const url of [
    'http://calendar.google.com/x.ics',
    'https://user:pw@example.org/x.ics',
    'file:///etc/passwd',
    'x'
  ])
    assert.throws(() => normalizeSourceUrl(url));
});

// Minimaler Tabellenersatz für die eine Konfigurationszeile.
function fakeDb() {
  let row = null;
  const columns = sql =>
    /SET (.+) WHERE/
      .exec(sql)[1]
      .split(',')
      .map(part => part.split('=')[0].trim());
  return {
    get row() {
      return row;
    },
    async query(sql, params = []) {
      if (sql.startsWith('SELECT')) return [row ? [{ ...row }] : []];
      if (sql.startsWith('INSERT')) {
        const names = /\(([^)]+)\) VALUES/.exec(sql)[1].split(',').slice(1);
        row ||= {
          id: 1,
          enabled: 1,
          source_url_encrypted: null,
          cached_ics: null,
          cached_at: null,
          last_error: null,
          last_result: null,
          ...Object.fromEntries(names.map((name, index) => [name.trim(), params[index]]))
        };
        return [{ affectedRows: 1 }];
      }
      const names = columns(sql);
      let index = 0;
      for (const name of names) row[name] = sql.includes(name + '=NULL') ? null : params[index++];
      return [{ affectedRows: 1 }];
    }
  };
}

function bridge(overrides = {}) {
  const db = fakeDb();
  const calls = [];
  let time = NOW;
  const service = createCalendarBridge({
    db,
    encrypt: value => 'enc:' + Buffer.from(JSON.stringify(value)).toString('base64'),
    decrypt: value => JSON.parse(Buffer.from(value.slice(4), 'base64').toString()),
    publicBaseUrl: () => 'https://siteops.example.org/',
    fetchSource: async url => {
      calls.push(url);
      return overrides.response?.() || { status: 200, body: SOURCE };
    },
    now: () => time
  });
  return { db, service, calls, advance: ms => (time += ms) };
}

const SECRET = 'https://calendar.google.com/calendar/ical/me/private-abc123/basic.ics';

test('service stores the source encrypted, serves the feed only by token and hides secrets from MCP', async () => {
  const { db, service, calls, advance } = bridge();
  const initial = await service.status({ secrets: true });
  assert.equal(initial.source_configured, false);
  assert.equal(initial.replacement_title, 'Itzehoer-Termin');
  assert.equal(initial.office_label, 'Büro');
  const token = /\/calendar\/feed\/([A-Za-z0-9_-]{40,})\.ics$/.exec(initial.feed_url)[1];
  assert.ok(initial.feed_url.startsWith('https://siteops.example.org/calendar/feed/'));
  assert.equal(await service.feed(token), null, 'nothing is served before the first sync');
  await assert.rejects(() => service.refresh(), /Quelladresse/);

  const saved = await service.save({ ...DEFAULT_RULES, enabled: true, source_url: SECRET });
  assert.deepEqual(calls, [SECRET]);
  assert.equal(saved.source_host, 'calendar.google.com');
  assert.equal(saved.stats.included, 6);
  assert.equal(saved.preview[0].title, 'Itzehoer-Termin');
  assert.equal(saved.preview[0].location, 'Büro');
  assert.ok(!db.row.source_url_encrypted.includes('private-abc123'));
  assert.ok(!JSON.stringify(saved).includes('private-abc123'));

  const forAgents = await service.status();
  assert.equal(forAgents.feed_url, undefined);
  assert.equal(forAgents.preview, undefined);
  assert.ok(!JSON.stringify(forAgents).includes(token));

  const feed = await service.feed(token);
  assert.match(feed, /SUMMARY:Itzehoer-Termin/);
  assert.equal(calls.length, 1, 'fresh cache is served without refetching');
  assert.equal(await service.feed(token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null);
  assert.equal(await service.feed('../../etc/passwd'), null);

  advance(16 * 60000);
  await service.feed(token);
  assert.equal(calls.length, 2, 'stale cache triggers one refresh');

  // Leeres Quellfeld behält die Adresse; geänderte Regeln wirken sofort.
  const renamed = await service.save({ ...DEFAULT_RULES, enabled: true, replacement_title: 'Belegt' });
  assert.equal(renamed.source_configured, true);
  assert.match(await service.feed(token), /SUMMARY:Belegt/);

  const rotated = await service.rotateToken();
  assert.notEqual(rotated.feed_url, initial.feed_url);
  assert.equal(await service.feed(token), null, 'old address stops working');

  await service.save({ ...DEFAULT_RULES, enabled: false });
  assert.equal(await service.feed(/feed\/(.+)\.ics$/.exec(rotated.feed_url)[1]), null, 'paused feed is not served');
});

test('a failing source keeps the last good feed and reports a message without the secret address', async () => {
  let fail = false;
  const { service, advance } = bridge({
    response: () => {
      if (fail) throw new Error('connect failed for ' + SECRET);
      return null;
    }
  });
  const saved = await service.save({ ...DEFAULT_RULES, enabled: true, source_url: SECRET });
  const token = /feed\/(.+)\.ics$/.exec(saved.feed_url)[1];
  fail = true;
  advance(20 * 60000);
  assert.match(await service.feed(token), /SUMMARY:Itzehoer-Termin/);
  const status = await service.status({ secrets: true });
  assert.equal(status.last_error, 'Quellkalender nicht erreichbar oder nicht lesbar.');
  await assert.rejects(
    () => service.refresh(),
    error => error.statusCode === 502 && !error.message.includes('private')
  );
  await assert.rejects(() => service.save({ ...DEFAULT_RULES, source_url: 'http://insecure.example.org/a.ics' }));
  await assert.rejects(() => service.save({ ...DEFAULT_RULES, replacement_title: 'A\r\nATTENDEE:x' }));
});

test('routes serve the calendar publicly by token and guard writes against foreign origins', async t => {
  const { service } = bridge();
  const app = Fastify();
  t.after(() => app.close());
  registerCalendarBridgeRoutes(app, {
    service,
    page: (title, body) => '<title>' + title + '</title>' + body,
    publicBaseUrl: () => 'https://siteops.example.org'
  });
  const json = { 'content-type': 'application/json' };
  const put = await app.inject({
    method: 'PUT',
    url: '/api/calendar-bridge',
    headers: json,
    payload: { ...DEFAULT_RULES, enabled: true, source_url: SECRET }
  });
  assert.equal(put.statusCode, 200);
  const feedPath = new URL(put.json().feed_url).pathname;
  const feed = await app.inject({ url: feedPath });
  assert.equal(feed.statusCode, 200);
  assert.match(feed.headers['content-type'], /^text\/calendar/);
  assert.match(feed.body, /^BEGIN:VCALENDAR\r\n/);
  assert.equal((await app.inject({ url: '/calendar/feed/' + 'x'.repeat(43) + '.ics' })).statusCode, 404);
  assert.equal((await app.inject({ url: feedPath.replace('.ics', '') })).statusCode, 404);
  const foreign = await app.inject({
    method: 'POST',
    url: '/api/calendar-bridge/token',
    headers: { ...json, origin: 'https://evil.example' },
    payload: {}
  });
  assert.equal(foreign.statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/calendar-bridge/refresh' })).statusCode, 415);
  const pageHtml = (await app.inject({ url: '/calendar-bridge' })).body;
  assert.match(pageHtml, /Kalender-Brücke/);
  assert.equal(pageHtml.includes(renderCalendarBridgePage()), true);
  assert.match((await app.inject({ url: '/assets/calendar-bridge.js' })).body, /api\/calendar-bridge/);
});

test('the application exempts only the token feed from the dashboard login', async t => {
  process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
  const { buildApplication, db } = await import('../app.mjs');
  const app = await buildApplication({ initialize: false });
  t.after(async () => {
    await app.close();
    await db.end();
  });
  // Ungültiges Tokenformat: 404 ohne Datenbankzugriff statt Anmeldeaufforderung.
  assert.equal((await app.inject({ url: '/calendar/feed/kurz.ics' })).statusCode, 404);
  for (const url of ['/api/calendar-bridge', '/calendar-bridge', '/calendar/'])
    assert.ok([302, 303, 401].includes((await app.inject({ url })).statusCode), url + ' requires a login');
});
