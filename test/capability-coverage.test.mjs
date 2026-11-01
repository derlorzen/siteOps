import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCapabilities } from '../scripts/capability-matrix.mjs';
import { needsHttpApproval } from '../lib/http-action-guard.mjs';

test('every real UI API route has existing MCP capabilities or an explicit reviewed exception', async () => {
  const data = await collectCapabilities();
  assert.ok(data.rows.length > 250);
  assert.ok(data.tools.length > 200);
  assert.deepEqual(
    data.missing,
    [],
    'New business functions need MCP coverage or a concrete reviewed security/technical exception.'
  );
  assert.deepEqual(data.stale, [], 'Remove stale route declarations.');
  for (const route of data.rows.filter(row => row.approval && !['GET', 'HEAD'].includes(row.method)))
    assert.equal(
      needsHttpApproval(route.method, route.path.replace(/:[A-Za-z]+/g, 'fixture')),
      true,
      'UI and MCP must share the approval boundary: ' + route.method + ' ' + route.path
    );
  for (const tool of data.tools) {
    assert.ok(tool.description, tool.name);
    assert.ok(['read', 'write'].includes(tool.access));
    assert.ok(tool.ui.startsWith('/'));
  }
});
