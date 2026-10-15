import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { renderCmsWorkspace } from '../lib/lorzcms-workspace.mjs';
import { createCmsController } from '../lib/lorzcms.mjs';

const esc = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

const installationId = randomUUID(),
  siteId = randomUUID(),
  projectId = randomUUID(),
  jobId = randomUUID();
const fixture = () => ({
  releases: [{ version: '3.4.0', notes: 'Layout und Editor', digest: 'abc123' }],
  projects: [{ id: projectId, name: 'Website Relaunch', customer_name: 'HSG Angeln' }],
  siteLinks: [{ site_id: siteId, project_id: projectId, project_name: 'Website Relaunch' }],
  installations: [
    {
      id: installationId,
      siteId,
      name: 'HSG Angeln TEST',
      slug: 'test-hsgangeln-de',
      baseUrl: 'https://test.hsgangeln.de',
      state: 'needs_attention',
      version: null,
      lastCheckedAt: null
    }
  ],
  jobs: [
    {
      id: jobId,
      installationId,
      name: 'HSG Angeln TEST',
      kind: 'adopt',
      state: 'needs_attention',
      phase: 'preflight',
      error: 'Connector nicht erreichbar',
      runAt: '2026-10-15T11:00:00.000Z'
    }
  ],
  existingSites: [
    {
      id: siteId,
      name: 'HSG Angeln TEST',
      domain: 'test.hsgangeln.de',
      deploymentMode: 'webspace',
      protocol: 'ftp',
      host: 'host.example',
      remoteRoot: '/hsg2026'
    }
  ]
});

test('LorzCMS has truly separate paths instead of anchored sections in one page', () => {
  const data = fixture();
  const tabs = ['sites', 'new', 'connect', 'updates', 'releases', 'jobs'];
  for (const tab of tabs) {
    const html = renderCmsWorkspace(data, esc, tab);
    assert.match(html, /cms-workspace-nav/);
    assert.match(html, /aria-current="page"/);
    assert.doesNotMatch(html, /href="#cms/);
    if (tab === 'new') {
      assert.match(html, /id="cmsCreate"/);
      assert.match(html, /name="savedConnection"/);
      assert.match(html, /name="projectId"/);
      assert.doesNotMatch(html, /id="cmsAttach"/);
    } else assert.doesNotMatch(html, /id="cmsCreate"/);
    if (tab === 'connect') assert.match(html, /id="cmsAttach"/);
    else assert.doesNotMatch(html, /id="cmsAttach"/);
    if (tab === 'jobs') assert.match(html, /data-cms-action="retry"/);
  }
});

test('broken, already-registered installation exposes repair and original task error', () => {
  const html = renderCmsWorkspace(fixture(), esc, 'installation', installationId);
  assert.match(html, /Anschluss fortsetzen/);
  assert.match(html, /data-cms-resume="/);
  assert.match(html, /Zustand prüfen/);
  assert.match(html, /Connector nicht erreichbar/);
  assert.match(html, /\/sites\/test-hsgangeln-de/);
  assert.match(html, /id="cmsProjectAssignment"/);
  assert.match(html, new RegExp('value="' + projectId + '" selected'));
  assert.doesNotMatch(html, /CMS noch nicht eingerichtet/);
});
test('no second recovery button while an enrollment is already queued', () => {
  const f = fixture();
  f.jobs[0].state = 'queued';
  f.installations[0].state = 'pending';
  const html = renderCmsWorkspace(f, esc, 'installation', installationId);
  assert.doesNotMatch(html, /data-cms-resume/);
});
test('escapes CMS-provided text and never serializes credentials', () => {
  const f = fixture();
  f.installations[0].name = '<img src=x onerror=alert(1)>';
  const html = renderCmsWorkspace(f, esc, 'sites');
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('encrypted_credentials'));
});

function controllerWithJobs(latest, version = null) {
  const statements = [];
  const q = async (sql, params = []) => {
    statements.push({ sql, params });
    if (sql.startsWith('select * from cms_installations'))
      return { rows: [{ id: installationId, site_id: siteId, state: 'needs_attention', version }] };
    if (sql.startsWith('select * from cms_jobs'))
      return { rows: latest ? [{ id: jobId, installation_id: installationId, ...latest }] : [] };
    return { rows: [], meta: { affectedRows: 1 } };
  };
  const service = createCmsController({
    q,
    db: {},
    getSite: async () => ({}),
    listSites: async () => [],
    createSite: async () => ({}),
    connectSite: async () => ({}),
    encrypt: x => JSON.stringify(x),
    decrypt: JSON.parse,
    request: async () => {
      throw Error('Should not connect to live host');
    }
  });
  return { service, statements };
}
test('recovering needs_attention enrollment retries original job and clears pending state', async () => {
  const { service, statements } = controllerWithJobs({ kind: 'adopt', state: 'needs_attention' });
  const result = await service.resumeIncomplete(installationId);
  assert.equal(result.jobId, jobId);
  assert.equal(result.resumed, true);
  assert.ok(statements.some(x => x.sql.includes("state='queued',phase='queued'")));
  assert.ok(statements.some(x => x.sql.includes("cms_installations set state='pending'")));
});
test('recovering cancelled legacy adoption requeues the same job, not a fresh install', async () => {
  const { service, statements } = controllerWithJobs({ kind: 'adopt', state: 'cancelled' });
  const result = await service.resumeIncomplete(installationId);
  assert.equal(result.jobId, jobId);
  assert.ok(statements.some(x => x.sql.includes("where id=? and state='cancelled'")));
  assert.ok(!statements.some(x => x.sql.includes('insert into cms_jobs')));
});
test('recovering missing enrollment queues new adopt job', async () => {
  const { service, statements } = controllerWithJobs(null);
  const result = await service.resumeIncomplete(installationId);
  assert.equal(result.installationId, installationId);
  assert.ok(statements.some(x => x.sql.includes('insert into cms_jobs')));
  assert.ok(statements.find(x => x.sql.includes('insert into cms_jobs')).params.includes('adopt'));
});
test('never requeues an already running job, active core or cancelled first-time setup', async () => {
  await assert.rejects(
    controllerWithJobs({ kind: 'adopt', state: 'queued' }).service.resumeIncomplete(installationId),
    error => error.statusCode === 409
  );
  await assert.rejects(
    controllerWithJobs(null, '3.4.0').service.resumeIncomplete(installationId),
    error => error.statusCode === 409
  );
  await assert.rejects(
    controllerWithJobs({ kind: 'install', state: 'cancelled' }).service.resumeIncomplete(installationId),
    error => error.statusCode === 409
  );
});
test('page-specific client parses and supports project editing, health check and recovery', async () => {
  const client = await readFile(new URL('../public/lorzcms.js', import.meta.url), 'utf8');
  assert.doesNotThrow(() => new vm.Script(client));
  for (const part of [
    'data-cms-inspect',
    'data-cms-resume',
    'cmsProjectAssignment',
    'project_id: projectId',
    'savedConnection',
    '/api/server-profiles',
    'resumeId'
  ])
    assert.ok(client.includes(part), part);
  const server = await readFile(new URL('../app.mjs', import.meta.url), 'utf8');
  for (const part of [
    '/lorzcms/installations/:id',
    '/api/lorzcms/installations/:id/resume',
    'renderCmsWorkspace',
    'lorzcms-workspace.css'
  ])
    assert.ok(server.includes(part), part);
});
