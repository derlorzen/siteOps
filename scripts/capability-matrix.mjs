import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
process.env.SITEOPS_TEST_NO_AUTOSTART = '1';

export async function collectCapabilities() {
  const { buildApplication, mcpServer, db } = await import('../app.mjs');
  const routes = [];
  const app = await buildApplication({
    initialize: false,
    routeObserver: route => {
      if (route.url.startsWith('/api/') && route.method !== 'HEAD')
        routes.push({ method: route.method, path: route.url });
    }
  });
  try {
    const tools = mcpServer().siteopsCapabilities();
    const bindings = JSON.parse(await readFile(new URL('../lib/ui-capabilities.json', import.meta.url), 'utf8'));
    const byName = new Map(tools.map(tool => [tool.name, tool]));
    const missing = [],
      rows = routes.map(route => {
        const key = route.method + ' ' + route.path,
          entry = bindings[key];
        if (!entry) {
          missing.push(key);
          return { ...route, status: 'missing', tools: [] };
        }
        for (const tool of entry.tools) if (!byName.has(tool)) missing.push(key + ' → ' + tool);
        if (!entry.tools.length && (!entry.reason || entry.status !== 'ui_only'))
          missing.push(key + ' → unreviewed exception');
        const mapped = entry.tools.map(name => byName.get(name)).filter(Boolean);
        return {
          ...route,
          module: mapped[0]?.module || route.path.split('/')[2],
          tools: entry.tools,
          service: [...new Set(mapped.map(tool => tool.service))].join(', ') || 'Dashboard-Administration',
          ui: mapped[0]?.ui || '/mcp-info',
          access: mapped.some(tool => tool.access === 'write')
            ? 'write'
            : mapped.length
              ? 'read'
              : ['GET', 'HEAD'].includes(route.method)
                ? 'read'
                : 'write',
          approval: mapped.some(tool => tool.approval),
          status: entry.status || 'mapped',
          reason: entry.reason || ''
        };
      });
    const stale = Object.keys(bindings).filter(key => !routes.some(route => key === route.method + ' ' + route.path));
    return { rows, tools, missing, stale };
  } finally {
    await app.close();
    await db.end();
  }
}
const cell = value =>
  String(value ?? '')
    .replaceAll('|', '\\|')
    .replaceAll('\n', ' ');
async function generate() {
  const data = await collectCapabilities();
  if (data.missing.length || data.stale.length)
    throw Error('Capability registry drift:\n' + [...data.missing, ...data.stale.map(x => 'stale: ' + x)].join('\n'));
  const referenced = new Set(data.rows.flatMap(row => row.tools));
  const lines = [
    '# UI-/MCP-Abdeckungsmatrix',
    '',
    'Automatisch aus den tatsächlichen Fastify-Routen, der zentralen MCP-Registrierung und den ausdrücklich geprüften Ausnahmen in `lib/ui-capabilities.json` erzeugt. Neu erzeugen: `npm run capabilities`. Neue oder entfernte API-Routen sowie nicht existierende MCP-Tools lassen den Abdeckungstest fehlschlagen.',
    '',
    `Bestand: ${data.rows.length} API-Funktionen, ${data.tools.length} MCP-Tools, ${data.rows.filter(row => row.status === 'ui_only').length} begründete Dashboard-Ausnahmen. „Zugeordnet“ bezeichnet fachliche Adapterabdeckung, keine erfolgreiche Live-Prüfung eines externen Providers oder Clients.`,
    '',
    'Die UI-Funktion wird durch API-Methode und Pfad eindeutig bezeichnet. Der UI-Einstieg und Service benennen ihren Arbeitskontext. Bei zusammengesetzten Abläufen können mehrere Tool-Aufrufe erforderlich sein. Einzelne Credential- und Binärtransferwege bleiben bewusst im Dashboard.',
    '',
    '| Modul | UI-Einstieg / Funktion | Geschäftsprozess / Service | API | MCP | Recht | Freigabe | Stand | Abweichung |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...data.rows
      .sort((a, b) => (a.module + a.path + a.method).localeCompare(b.module + b.path + b.method))
      .map(
        row =>
          `| ${cell(row.module)} | ${cell(row.ui)} | ${cell(row.service)} | ${cell(row.method + ' ' + row.path)} | ${cell(row.tools.join(', ') || '–')} | ${row.access === 'write' ? 'Ändern' : 'Lesen'} | ${row.status === 'ui_only' ? 'Dashboard-Entscheidung' : row.approval ? 'Gebundene Freigabe' : 'Keine zusätzliche'} | ${row.status === 'mapped' ? 'Zugeordnet' : 'Begründete Ausnahme'} | ${cell(row.reason)} |`
      ),
    '',
    '## Zusätzliche fachliche MCP-Aktionen',
    '',
    'Diese Tools ergänzen zusammengesetzte Abläufe oder vorhandene Website-Services; es existiert nicht zwingend ein separater gleichnamiger REST-Endpunkt. Der Arbeitskontext ist ausgewiesen.',
    '',
    '| Tool | Modul | UI-Kontext | Recht | Freigabe | Aufgabe |',
    '| --- | --- | --- | --- | --- | --- |',
    ...data.tools
      .filter(tool => !referenced.has(tool.name))
      .map(
        tool =>
          `| ${cell(tool.name)} | ${cell(tool.module)} | ${cell(tool.ui)} | ${cell(tool.access)} | ${tool.approval ? 'Ja' : 'Nein'} | ${cell(tool.description)} |`
      ),
    ''
  ];
  await writeFile(new URL('../docs/UI-MCP-COVERAGE.md', import.meta.url), lines.join('\n'));
  console.log(
    `${data.rows.length} routes, ${data.tools.length} tools, ${data.rows.filter(row => row.status === 'ui_only').length} explicit exceptions`
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await generate();
