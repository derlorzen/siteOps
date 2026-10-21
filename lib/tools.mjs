import * as z from 'zod/v4';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { domainToASCII } from 'node:url';
import { isIP } from 'node:net';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const PHP_FIXES = Object.freeze({
  8.2: '8.2.35',
  8.3: '8.3.36',
  8.4: '8.4.27',
  8.5: '8.5.12'
});

function bad(message, code = 400) {
  const error = new Error(message);
  error.statusCode = code;
  return error;
}

export function analyzePhpVersion(version) {
  if (!version)
    return {
      status: 'unknown',
      title: 'PHP-Version nicht erkennbar',
      description:
        'Die Website veröffentlicht keine vollständige PHP-Version. Das ist kein Nachweis dafür, dass sie sicher ist.'
    };
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(version);
  if (!match || match[3] === undefined)
    return {
      status: 'unknown',
      title: 'Patchversion nicht erkennbar',
      description: 'Die angezeigte PHP-Version enthält keine vollständige Patchnummer.'
    };
  const branch = match[1] + '.' + match[2];
  const fix = PHP_FIXES[branch];
  if (!fix)
    return {
      status: +match[1] < 8 || (+match[1] === 8 && +match[2] < 2) ? 'outdated' : 'unknown',
      title: 'PHP-Versionszweig separat prüfen',
      description:
        'Für diesen Versionszweig ist kein offizieller Fixstand in der Referenz enthalten. Prüfe Backports des Hosting-Anbieters.'
    };
  const numeric = version.split('.').map(Number);
  const target = fix.split('.').map(Number);
  const patched =
    numeric.every((part, index) => part === target[index]) ||
    (numeric.findIndex((part, index) => part !== target[index]) >= 0 &&
      (() => {
        const i = numeric.findIndex((part, index) => part !== target[index]);
        return numeric[i] > target[i];
      })());
  return {
    status: patched ? 'reported-patched' : 'outdated',
    title: patched ? 'Gemeldeter Patchstand aktuell' : 'Gemeldeter Patchstand veraltet',
    description: patched
      ? 'Die öffentlich gemeldete PHP-Version ' +
        version +
        ' erfüllt mindestens ' +
        fix +
        '. Das ersetzt keine Prüfung der tatsächlich laufenden PHP-Version.'
      : 'Die öffentlich gemeldete PHP-Version ' +
        version +
        ' liegt unter ' +
        fix +
        '. Mögliche Security-Backports bleiben von außen unsichtbar.',
    fix
  };
}

const toolPayload = z
  .object({
    title: z.string().trim().min(2).max(120),
    url: z.string().trim().max(700),
    description: z.string().trim().max(500).default(''),
    category: z.string().trim().min(1).max(60).default('Allgemein'),
    origin: z.enum(['own', 'external']).default('own'),
    project_id: z.uuid().nullable().default(null),
    favorite: z.boolean().default(false)
  })
  .strict();

export function normalizeToolUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw bad('Bitte eine gültige vollständige URL angeben.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw bad('Nur HTTP(S)-Links ohne Zugangsdaten sind erlaubt.');
  if (url.href.length > 700) throw bad('URL ist zu lang.');
  return url.href;
}

export function isPublicIpv4(ip) {
  if (isIP(ip) !== 4) return false;
  const [a, b, c] = ip.split('.').map(Number);
  if (!a || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

export function normalizeScanTarget(raw) {
  const input = String(raw || '').trim();
  if (!input || input.length > 500) throw bad('Bitte eine Website-Adresse eingeben.');
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : 'https://' + input);
  } catch {
    throw bad('Ungültige Website-Adresse.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw bad('Nur HTTP(S)-Websites sind erlaubt.');
  if (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80'))
    throw bad('Nur Ports 80 und 443 sind erlaubt.');
  const host = domainToASCII(url.hostname.replace(/\.$/, '').toLowerCase());
  if (
    !host ||
    isIP(host) ||
    host.length > 253 ||
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)
  )
    throw bad('Nur öffentliche Domains, keine IP-Adressen, sind erlaubt.');
  if (/(?:^|\.)(?:local|localhost|internal|test|invalid|example|onion|lan|home|corp)$/.test(host))
    throw bad('Interne oder reservierte Domains werden nicht geprüft.');
  // Do not request caller-provided paths, query strings or URL fragments.
  return new URL(url.protocol + '//' + host + '/');
}

async function requestPublicHeaders(url) {
  let answers;
  try {
    answers = await lookup(url.hostname, { all: true });
  } catch {
    throw bad('Domain konnte nicht aufgelöst werden.');
  }
  const ipv4 = answers.filter(a => a.family === 4).map(a => a.address);
  if (!ipv4.length) throw bad('Keine öffentliche IPv4-Adresse vorhanden.');
  if (ipv4.some(ip => !isPublicIpv4(ip))) throw bad('Die Domain verweist auf eine interne oder reservierte IP.');
  const ip = ipv4[0];
  return await new Promise((resolve, reject) => {
    const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = transport(
      url,
      {
        method: 'GET',
        agent: false,
        timeout: 7000,
        maxHeaderSize: 16384,
        lookup: (_name, _opts, cb) => cb(null, ip, 4),
        headers: {
          'User-Agent': 'SiteOps-PHP2Shell-Passive-Checker/1.0',
          Accept: 'text/html',
          'Accept-Encoding': 'identity'
        }
      },
      res => {
        const headers = res.headers;
        const status = res.statusCode || 0;
        resolve({ status, headers });
        res.destroy(); // Never read or retain the response body.
      }
    );
    req.on('timeout', () => req.destroy(bad('Zeitüberschreitung beim Verbindungsaufbau.')));
    req.on('error', error => reject(bad('Website nicht erreichbar: ' + String(error.code || 'Verbindungsfehler'))));
    req.end();
  });
}

export async function passivePhpCheck(raw) {
  let url = normalizeScanTarget(raw);
  let response = null;
  const redirects = [];
  for (let count = 0; count < 3; count++) {
    response = await requestPublicHeaders(url);
    const location = response.headers.location;
    if (count >= 2 || ![301, 302, 303, 307, 308].includes(response.status) || !location) break;
    const target = new URL(Array.isArray(location) ? location[0] : location, url);
    url = normalizeScanTarget(target.href);
    redirects.push(url.href);
  }
  let version = null;
  let source = null;
  for (const key of ['x-powered-by', 'server', 'x-runtime', 'x-php-version']) {
    const header = response.headers[key];
    for (const value of Array.isArray(header) ? header : header ? [header] : []) {
      const match = /\bPHP\s*\/?\s*(\d+\.\d+(?:\.\d+)?)\b/i.exec(String(value));
      if (match) {
        version = match[1];
        source = key;
        break;
      }
    }
    if (version) break;
  }
  const cookies = response.headers['set-cookie'] || [];
  const hints = [];
  if (
    String(response.headers['x-powered-by'] || '')
      .toLowerCase()
      .includes('php')
  )
    hints.push('PHP im X-Powered-By-Header');
  if (cookies.some(cookie => /^PHPSESSID=/i.test(cookie))) hints.push('PHPSESSID-Cookie');
  return {
    domain: url.hostname,
    url: url.href,
    http_status: response.status,
    php_version: version,
    version_source: source,
    server: String(response.headers.server || '').slice(0, 120),
    hints,
    redirects,
    result: analyzePhpVersion(version),
    checked_at: new Date().toISOString()
  };
}

export function createToolsService(db) {
  return {
    async list() {
      const [rows] = await db.query(
        'SELECT l.id,l.title,l.url,l.description,l.category,l.origin,l.project_id,l.favorite,l.created_at,l.updated_at,p.name project_name ' +
          'FROM tool_links l LEFT JOIN customer_projects p ON p.id=l.project_id ORDER BY l.favorite DESC,l.title ASC'
      );
      return rows.map(row => ({ ...row, favorite: Boolean(row.favorite) }));
    },
    async projects() {
      const [rows] = await db.query(
        'SELECT p.id,p.name,c.name customer_name FROM customer_projects p ' +
          'JOIN customers c ON c.id=p.customer_id ORDER BY c.name,p.name'
      );
      return rows;
    },
    async create(raw) {
      const data = toolPayload.parse(raw);
      const id = crypto.randomUUID();
      await db.query(
        'INSERT INTO tool_links(id,title,url,description,category,origin,project_id,favorite) VALUES(?,?,?,?,?,?,?,?)',
        [
          id,
          data.title,
          normalizeToolUrl(data.url),
          data.description,
          data.category,
          data.origin,
          data.project_id,
          Number(data.favorite)
        ]
      );
      return { id };
    },
    async update(id, raw) {
      const data = toolPayload.parse(raw);
      const [res] = await db.query(
        'UPDATE tool_links SET title=?,url=?,description=?,category=?,origin=?,project_id=?,favorite=? WHERE id=?',
        [
          data.title,
          normalizeToolUrl(data.url),
          data.description,
          data.category,
          data.origin,
          data.project_id,
          Number(data.favorite),
          z.uuid().parse(id)
        ]
      );
      if (!res.affectedRows) throw bad('Tool nicht gefunden.', 404);
      return { id };
    },
    async remove(id) {
      const [res] = await db.query('DELETE FROM tool_links WHERE id=?', [z.uuid().parse(id)]);
      if (!res.affectedRows) throw bad('Tool nicht gefunden.', 404);
      return { ok: true };
    }
  };
}

export function renderToolsPage() {
  return `<header><div><span class="eyebrow">SiteOps · Werkzeugkasten</span>
    <h1>Tools & Verknüpfungen</h1>
    <p class="lead">Eigene Anwendungen und externe Dienste an einer Stelle. Mit Favoriten, Kategorien und Projektzuordnung.</p></div></header>
    <section class="tools-section tools-checker" id="phpcheck">
      <div class="tools-sectionhead"><div><span class="eyebrow">Integriertes Sicherheitstool</span><h2>PHP2Shell-Check</h2>
      <p>Öffentliche PHP-Versionsinformationen einer Website passiv prüfen – ohne Upload auf den Zielserver.</p></div>
      <span class="tools-badge">CVE-2026-109618 / 109619</span></div>
      <form id="tools-check-form" class="tools-inline-form">
        <label for="tools-check-url">Website-URL</label><div class="tools-input-row">
        <input type="url" id="tools-check-url" placeholder="https://beispiel.de" required>
        <button type="submit" id="tools-check-submit">PHP-Version prüfen</button></div>
      </form>
      <div id="tools-check-output" class="tools-check-output" aria-live="polite" hidden></div>
      <p class="tools-disclaimer">Der passive Check erkennt nur vom Webserver veröffentlichte Versionsinformationen. Keine Exploit-Versuche. „Nicht erkennbar“ bedeutet nicht „sicher“. <a href="https://www.php.net/" target="_blank" rel="noopener noreferrer">Offizielle PHP-Updates</a></p>
    </section>
    <section class="tools-section">
      <div class="tools-sectionhead"><div><span class="eyebrow">Deine Sammlung</span><h2>Verlinkte Tools</h2>
      <p>Links zu eigenen Projekten, Kundenwerkzeugen oder externen Diensten verwalten.</p></div>
      <button type="button" id="tools-new">+ Tool hinzufügen</button></div>
      <div class="tools-filters"><input id="tools-search" type="search" aria-label="Tools durchsuchen" placeholder="Tools durchsuchen …">
        <select id="tools-origin" aria-label="Herkunft"><option value="">Alle Tools</option><option value="own">Eigene</option><option value="external">Externe</option></select>
        <select id="tools-category" aria-label="Kategorie"><option value="">Alle Kategorien</option></select>
      </div><div id="tools-list" class="tools-grid"><p>Tools werden geladen …</p></div>
    </section>
    <dialog id="tools-dialog" class="tools-dialog">
     <form id="tools-edit-form" class="tools-edit-form">
      <div class="tools-dialog-head"><h2 id="tools-dialog-title">Tool hinzufügen</h2><button type="button" id="tools-close" class="ghost">Schließen</button></div>
      <label>Name<input required name="title" maxlength="120" placeholder="z. B. Hosting-Panel"></label>
      <label>URL<input required name="url" type="url" maxlength="700" placeholder="https://…"></label>
      <label>Beschreibung<textarea name="description" maxlength="500" rows="2"></textarea></label>
      <div class="tools-form-grid"><label>Kategorie<input name="category" required maxlength="60" value="Allgemein"></label>
      <label>Herkunft<select name="origin"><option value="own">Eigenes Tool</option><option value="external">Externe Website</option></select></label></div>
      <label>Projekt (optional)<select name="project_id" id="tools-project"><option value="">Kein Projekt</option></select></label>
      <label class="tools-favorite"><input name="favorite" type="checkbox"> Als Favorit markieren</label>
      <div class="tools-dialog-actions"><button type="submit" id="tools-save">Speichern</button></div>
     </form>
    </dialog>
    <link rel="stylesheet" href="/assets/tools.css"><script defer src="/assets/tools.js"></script>`;
}

export function registerToolsRoutes(app, { db, page, publicBaseUrl }) {
  const service = createToolsService(db);
  const guard = (req, reply) => {
    if (!String(req.headers['content-type'] || '').startsWith('application/json'))
      return reply.code(415).send({ error: 'JSON erforderlich.' });
    if (req.headers.origin && req.headers.origin !== new URL(publicBaseUrl()).origin)
      return reply.code(403).send({ error: 'Fremde Herkunft abgelehnt.' });
  };
  app.get('/assets/tools.js', async (_r, reply) =>
    reply
      .type('text/javascript')
      .header('Cache-Control', 'no-store')
      .send(await readFile(new URL('../public/tools.js', import.meta.url), 'utf8'))
  );
  app.get('/assets/tools.css', async (_r, reply) =>
    reply
      .type('text/css')
      .header('Cache-Control', 'no-store')
      .send(await readFile(new URL('../public/tools.css', import.meta.url), 'utf8'))
  );
  app.get('/tools', async (_r, reply) => reply.type('text/html').send(page('Tools', renderToolsPage())));
  app.get('/tools/phpcheck', async (_r, reply) => reply.type('text/html').send(page('Tools', renderToolsPage())));
  app.get('/api/tools', () => service.list());
  app.get('/api/tools/projects', () => service.projects());
  app.post('/api/tools', { preHandler: guard }, req => service.create(req.body));
  app.put('/api/tools/:id', { preHandler: guard }, req => service.update(req.params.id, req.body));
  app.delete('/api/tools/:id', { preHandler: guard }, req => service.remove(req.params.id));
  app.post(
    '/api/tools/phpcheck',
    {
      preHandler: guard,
      config: { rateLimit: { max: 12, timeWindow: '1 minute' } }
    },
    req => passivePhpCheck(z.object({ url: z.string().max(500) }).parse(req.body).url)
  );
}
