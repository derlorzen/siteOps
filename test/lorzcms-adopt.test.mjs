import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { cmsAgentHttpError, connectorOwners, proveAdoptTarget, repairAdoptConnector } from '../lib/lorzcms-adopt.mjs';

const id = '11111111-1111-4111-8111-111111111111';
const oldId = '22222222-2222-4222-8222-222222222222';
const key = 'a'.repeat(64);
const hash = crypto.createHash('sha256').update(key).digest('hex');
const config = (owner, keyHash) =>
  Buffer.from("<?php\nreturn ['instance_id'=>'" + owner + "','key_hash'=>'" + keyHash + "'];\n");
const agentFiles = new Map([
  ['.lorzcms/agent.php', Buffer.from('new agent')],
  ['.lorzcms/project.php', Buffer.from('new project helper')],
  ['public/siteops.php', Buffer.from('new wrapper')]
]);

function fixture(initial = {}) {
  const files = new Map(Object.entries(initial).map(([path, value]) => [path, Buffer.from(value)]));
  const remote = {
    async exists(path) {
      return files.has(path);
    },
    async read(path) {
      if (!files.has(path)) throw new Error('missing');
      return files.get(path);
    },
    async write(path, content) {
      files.set(path, Buffer.from(content));
    },
    async rename(from, to) {
      files.set(to, await this.read(from));
      files.delete(from);
    },
    async remove(path) {
      files.delete(path);
    }
  };
  return { files, remote };
}

function repair(remote, options = {}) {
  return repairAdoptConnector({
    remote,
    root: '/',
    instanceId: id,
    key,
    files: agentFiles,
    proveTarget: async () => {},
    verify: async () => ({ version: '3.6.1' }),
    ...options
  });
}

test('adopt repairs a missing connector and preserves all non-connector files', async () => {
  const { files, remote } = fixture({
    '/public/index.php': 'existing site',
    '/.lorzcms/active.json': 'existing active core',
    '/config/local.php': 'local database config'
  });
  assert.deepEqual(await repair(remote), { version: '3.6.1' });
  assert.deepEqual(files.get('/config/siteops.php'), config(id, hash));
  assert.deepEqual(JSON.parse(files.get('/.lorzcms/owner.json')), { instanceId: id });
  for (const [path, bytes] of agentFiles) assert.deepEqual(files.get('/' + path), bytes);
  assert.equal(files.get('/public/index.php').toString(), 'existing site');
  assert.equal(files.get('/.lorzcms/active.json').toString(), 'existing active core');
  assert.equal(files.get('/config/local.php').toString(), 'local database config');
  const before = new Map(files);
  await repair(remote, { proveTarget: async () => assert.fail('already valid connector must not be changed') });
  assert.deepEqual(files, before);
});

test('adopt stops on foreign owners and repairs only after matching confirmation', async () => {
  const { files, remote } = fixture({
    '/config/siteops.php': config(oldId, 'b'.repeat(64)),
    '/.lorzcms/owner.json': JSON.stringify({ instanceId: oldId }),
    '/public/siteops.php': 'old wrapper'
  });
  const before = new Map(files);
  await assert.rejects(
    () => repair(remote),
    error => {
      assert.equal(error.cmsCode, 'CMS_FOREIGN_OWNER');
      assert.deepEqual(error.foreignOwners, [oldId]);
      return true;
    }
  );
  assert.deepEqual(files, before);
  await assert.rejects(() => repair(remote, { confirmedOwners: [id] }), /Schlüssel wird ersetzt/);
  assert.deepEqual(files, before);
  await repair(remote, { confirmedOwners: [oldId] });
  assert.deepEqual(files.get('/config/siteops.php'), config(id, hash));
});

test('401 or health-check failure restores previous bytes and removes newly added files', async () => {
  const { files, remote } = fixture({
    '/config/siteops.php': config(id, 'b'.repeat(64)),
    '/public/siteops.php': 'original wrapper',
    '/public/index.php': 'unchanged'
  });
  const before = new Map(files);
  await assert.rejects(
    () =>
      repair(remote, {
        verify: async () => {
          throw cmsAgentHttpError(401);
        }
      }),
    /HTTP 401/
  );
  assert.deepEqual(files, before);
});

test('ownership is checked in both config and marker', () => {
  assert.deepEqual(connectorOwners(config(oldId, hash), Buffer.from(JSON.stringify({ instanceId: id }))), {
    owners: [oldId, id].sort(),
    unknown: false
  });
  assert.equal(connectorOwners(Buffer.from('<?php // invalid'), null).unknown, true);
});

test('target proof detects wrong FTP target, shared root and wrong document root', async () => {
  const { files, remote } = fixture();
  const origin = 'https://target.example';
  const other = 'https://other.example';
  const marker = () => [...files.values()][0];
  const proof = request => proveAdoptTarget({ remote, root: '/', origin, otherOrigins: [other], request });
  await proof(async url => new Response(url.startsWith(origin) ? marker() : 'other website'));
  assert.equal(files.size, 0);
  await assert.rejects(() => proof(async () => new Response('wrong site')), /stimmen nicht nachweisbar/);
  assert.equal(files.size, 0);
  await assert.rejects(() => proof(async () => new Response(marker())), /auch von einer anderen/);
  assert.equal(files.size, 0);
  await assert.rejects(
    () => proof(async url => new Response(url.includes('/public/') ? marker() : 'wrong root')),
    error => error.agentStatus === 422
  );
  assert.equal(files.size, 0);
});
