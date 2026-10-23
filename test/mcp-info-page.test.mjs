import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { test } from 'node:test';

async function renderedScript() {
  const source = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  const generator = source.slice(source.indexOf('function mcpInfoPage()'), source.indexOf('function settingsPage()'));
  const html = vm.runInNewContext(generator + ';mcpInfoPage()', {
    oauthBase: () => 'https://example.test',
    oauthResource: () => 'https://example.test/mcp',
    cfg: {},
    esc: String,
    page: (_title, body) => body
  });
  return html.match(/<script>([\s\S]*?)<\/script>/)[1];
}

test('rendered MCP page starts both loaders and displays their results', async () => {
  const script = new vm.Script(await renderedScript());
  const boxes = Object.fromEntries(
    ['oauthConnections', 'auditLog', 'oauthRevokeAll'].map(id => [
      id,
      {
        innerHTML: 'Lade…',
        querySelectorAll: () => []
      }
    ])
  );
  const calls = [];
  script.runInNewContext({
    document: { getElementById: id => boxes[id] },
    fetch: async url => {
      calls.push(url);
      return { ok: true, json: async () => [] };
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['/api/oauth/connections', '/api/audit-log?limit=100']);
  assert.match(boxes.oauthConnections.innerHTML, /Noch keine OAuth-Verbindung/);
  assert.match(boxes.auditLog.innerHTML, /Noch keine Audit-Einträge/);
});

test('rendered MCP page shows escaped failures in both panels', async () => {
  const boxes = Object.fromEntries(['oauthConnections', 'auditLog', 'oauthRevokeAll'].map(id => [id, {}]));
  new vm.Script(await renderedScript()).runInNewContext({
    document: { getElementById: id => boxes[id] },
    fetch: async () => {
      throw new Error('<failed>');
    }
  });
  await new Promise(resolve => setImmediate(resolve));
  for (const id of ['oauthConnections', 'auditLog']) {
    assert.match(boxes[id].innerHTML, /Laden fehlgeschlagen/);
    assert.match(boxes[id].innerHTML, /&lt;failed&gt;/);
  }
});
