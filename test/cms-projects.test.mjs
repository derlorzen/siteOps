import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  createCmsProjects,
  validateProjectManifest,
  projectSeedSummary,
  cmsProjectBeginSchema
} from '../lib/cms-projects.mjs';
import * as z from 'zod/v4';

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const seed = {
  format: 'sitecms-content-v1',
  project: 'practice',
  contents: [
    {
      id: 'home',
      type: 'page',
      title: 'Praxis',
      path: '/',
      status: 'published',
      fields: { body: '<p>Moin</p>' },
      seo: {}
    },
    {
      id: 'team',
      type: 'page',
      title: 'Team',
      path: '/unser-team/',
      status: 'published',
      fields: { body: '<p>Team</p>' },
      seo: {}
    },
    { id: 'person', type: 'person', title: 'Person', path: null, status: 'published', fields: {}, seo: {} }
  ]
};
function fixture() {
  const files = [
    ['projects/practice/project.php', Buffer.from('<?php return [];')],
    ['migration/practice-content.json', Buffer.from(JSON.stringify(seed))],
    ['public/wp-content/uploads/2022/05/photo.jpg', Buffer.from([0, 255, 128, 44, 10])]
  ];
  return {
    files,
    manifest: {
      project: 'practice',
      name: 'Praxis',
      seedPath: 'migration/practice-content.json',
      files: files.map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: hash(bytes) }))
    }
  };
}
function memoryStore() {
  const packages = new Map(),
    files = new Map();
  async function q(sql, params) {
    if (sql.startsWith('INSERT IGNORE INTO cms_project_packages')) {
      if (![...packages.values()].some(row => row.digest === params[1]))
        packages.set(params[0], { id: params[0], digest: params[1], manifest: params[2], state: 'uploading' });
    } else if (sql.startsWith('SELECT id FROM cms_project_packages')) {
      return { rows: [...packages.values()].filter(row => row.digest === params[0]).map(row => ({ id: row.id })) };
    } else if (sql.startsWith('SELECT * FROM cms_project_packages')) {
      return { rows: [packages.get(params[0])].filter(Boolean) };
    } else if (sql.startsWith('INSERT INTO cms_project_files')) {
      files.set(params[0] + ':' + params[1], {
        package_id: params[0],
        path: params[2],
        sha256: params[3],
        bytes: params[4],
        content: params[5]
      });
    } else if (sql.startsWith('SELECT path,')) {
      return { rows: [...files.values()].filter(row => row.package_id === params[0]) };
    } else if (sql.startsWith('UPDATE cms_project_packages')) packages.get(params[0]).state = 'ready';
    else throw new Error('Unexpected SQL in test: ' + sql);
    return { rows: [], meta: { affectedRows: 1 } };
  }
  return { q, packages, files };
}

test('manifest rejects private paths, traversal, ambiguous casing, wrong project and excessive sizes', () => {
  const { manifest } = fixture();
  assert.doesNotThrow(() => z.toJSONSchema(cmsProjectBeginSchema));
  for (const path of [
    'config/local.php',
    'var/cms.sqlite',
    'packages/cms/src/Admin.php',
    'public/index.php',
    'public/siteops.php',
    'public/wp-content/uploads/x.php',
    'public/assets/../x.css',
    '/public/assets/x.css',
    'public/assets/a//x.css',
    'public/.htaccess'
  ]) {
    const changed = JSON.parse(JSON.stringify(manifest));
    changed.files[0].path = path;
    assert.throws(() => validateProjectManifest(changed), undefined, path);
  }
  assert.throws(() => validateProjectManifest({ ...manifest, project: 'other' }));
  assert.throws(() =>
    validateProjectManifest({
      ...manifest,
      files: [...manifest.files, { ...manifest.files[0], path: manifest.files[0].path.toUpperCase() }]
    })
  );
  assert.throws(() =>
    validateProjectManifest({ ...manifest, files: manifest.files.map(file => ({ ...file, bytes: 6 * 1024 * 1024 })) })
  );
  assert.throws(() => validateProjectManifest({ ...manifest, password: 'must-not-be-imported' }));
});

test('MCP project transfer preserves binary bytes, resumes missing files, is idempotent and seals before use', async () => {
  const db = memoryStore(),
    api = createCmsProjects(db),
    source = fixture();
  const started = await api.begin(source.manifest);
  assert.equal((await api.begin(source.manifest)).packageId, started.packageId);
  assert.equal((await api.status(started.packageId)).missing.length, 3);
  await assert.rejects(api.load(started.packageId), /abschließen/);
  await assert.rejects(api.finish(started.packageId), /fehlt/);
  const [path, bytes] = source.files[2];
  await assert.rejects(
    api.put({ packageId: started.packageId, path, content: Buffer.from('changed').toString('base64') }),
    /stimmt nicht/
  );
  await assert.rejects(
    api.put({ packageId: started.packageId, path: 'config/local.php', content: 'eA==' }),
    /gehört nicht/
  );
  for (const [path, bytes] of source.files) {
    const request = { packageId: started.packageId, path, content: bytes.toString('base64') };
    await api.put(request);
    await api.put(request);
  }
  const sealed = await api.finish(started.packageId);
  assert.deepEqual(sealed.routes, ['/', '/unser-team/']);
  assert.equal(sealed.contents, 3);
  assert.equal((await api.status(started.packageId)).ready, true);
  const loaded = await api.load(started.packageId);
  assert.deepEqual(loaded.files.find(file => file.path === path).content, bytes);
  assert.doesNotMatch(JSON.stringify(await api.status(started.packageId)), /content|base64/);
  db.files.values().next().value.content = Buffer.from('corrupted');
  await assert.rejects(api.load(started.packageId), /verändert/);
});

test('seed review catches duplicate routes, foreign projects, unsafe paths and missing homepage', () => {
  assert.deepEqual(projectSeedSummary(Buffer.from(JSON.stringify(seed)), 'practice').routes, ['/', '/unser-team/']);
  for (const changed of [
    { ...seed, project: 'other' },
    { ...seed, contents: [seed.contents[1]] },
    { ...seed, contents: [...seed.contents, { ...seed.contents[0], id: 'other' }] },
    { ...seed, contents: [{ ...seed.contents[0], path: '//evil.example/' }] }
  ])
    assert.throws(() => projectSeedSummary(Buffer.from(JSON.stringify(changed)), 'practice'));
});
