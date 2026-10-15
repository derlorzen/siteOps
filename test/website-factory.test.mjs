import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebsiteFactory, defaultWebsiteRoot, websiteBlueprint, websiteCreateSchema } from '../lib/website-factory.mjs';

const accountId = '11111111-1111-4111-8111-111111111111';
const testRequest = { companyName: 'Containerdienst Schartau', location: 'Süderbrarup', baseUrl: 'https://container.lorzen.de' };
const allInklService = {
  async list() { return [{ id: accountId, name: 'Lorzen ALL-INKL' }]; },
  async domains() { return [{ domain_name: 'lorzen.de' }, { domain_name: 'other.example' }]; }
};

test('natural-language-sized website request produces four SEO-aware editable pages without inventing services', () => {
  assert.equal(websiteCreateSchema.safeParse(testRequest).success, true);
  const plan = websiteBlueprint(testRequest);
  assert.deepEqual(plan.pages.map(item => item.path), ['/', '/leistungen', '/ueber-uns', '/kontakt']);
  assert.match(plan.pages[0].body, /Containerdienst Schartau in Süderbrarup/);
  assert.doesNotMatch(plan.pages.map(item => item.body).join(' '), /10 Jahre|24 Stunden|kostenlos|Festpreis/);
  assert.match(plan.pages[1].body, /persönlichen Gespräch/);
  assert.match(plan.pages[3].body, /Kontaktdaten werden/);
  assert.equal(plan.seoIndexing, 'disabled');
  assert.ok(plan.reviewRequired);
  assert.equal(plan.pages[0].seo.canonical, 'https://container.lorzen.de/');
  assert.equal(plan.menu.length, 4);
});

test('provided business facts are escaped and unverified claims are not added', () => {
  const plan = websiteBlueprint({
    ...testRequest, services: ['Container < 5 m³', 'Bauschuttentsorgung'],
    contactEmail: 'kontakt@example.de', contactPhone: '+49 123 4567',
    description: 'Container für Privat- und Gewerbekunden.'
  });
  assert.match(plan.pages[1].body, /Container &lt; 5 m³/);
  assert.match(plan.pages[1].body, /Bauschuttentsorgung/);
  assert.match(plan.pages[3].body, /mailto:kontakt@example.de/);
  assert.match(plan.pages[3].body, /tel:\+491234567/);
});

test('webroot derives from the target domain and refuses account root or non-HTTPS URLs', () => {
  assert.equal(defaultWebsiteRoot('https://container.lorzen.de'), '/siteops-websites/container-lorzen-de');
  assert.equal(defaultWebsiteRoot('https://container.lorzen.de', '/kunden/projekte'), '/kunden/projekte/container-lorzen-de');
  assert.throws(() => defaultWebsiteRoot('https://container.lorzen.de', '/'), /Absolutes Unterverzeichnis/);
  assert.throws(() => websiteBlueprint({ ...testRequest, baseUrl: 'http://container.lorzen.de' }), /HTTPS/);
  assert.throws(() => websiteBlueprint({ ...testRequest, baseUrl: 'https://container.lorzen.de/admin' }), /HTTPS/);
});

test('website create uses account discovery, bundled CMS, encrypted install pipeline and one-time admin password', async () => {
  let created, bundled = 0;
  const cmsController = {
    async publishBundled() { bundled++; return { version: '3.5.0' }; },
    async create(input) { created = input; return { installationId: '22222222-2222-4222-8222-222222222222', jobId: '33333333-3333-4333-8333-333333333333' }; },
    async overview() { return { installations: [{ id: created?.id || '22222222-2222-4222-8222-222222222222', name: testRequest.companyName, state: 'ready', version: '3.5.0' }], jobs: [{ installationId: '22222222-2222-4222-8222-222222222222', state: 'succeeded' }] }; }
  };
  const factory = createWebsiteFactory({
    allInklService, cmsController, defaultAdminEmail: 'admin@example.de',
    randomBytes: () => Buffer.alloc(32, 42)
  });
  const plan = await factory.plan(testRequest);
  assert.equal(plan.allinklAccountId, accountId);
  assert.equal(plan.remoteRoot, '/siteops-websites/container-lorzen-de');
  assert.equal(bundled, 0);
  const result = await factory.create(testRequest);
  assert.equal(bundled, 1);
  assert.equal(created.allinklAccountId, accountId);
  assert.equal(created.version, '3.5.0');
  assert.deepEqual(created.database, { engine: 'sqlite' });
  assert.equal(created.websiteBlueprint.pages.length, 4);
  assert.equal(created.websiteBlueprint.seoIndexing, 'disabled');
  assert.equal(created.adminEmail, 'admin@example.de');
  assert.ok(result.generatedAdminPassword.length >= 30);
  assert.equal(result.generatedAdminPassword, created.adminPassword);
  const status = await factory.status(result.installationId);
  assert.equal(status.published, true);
  assert.equal(status.generatedAdminPassword, undefined);
});

test('creation refuses missing admin configuration, foreign zones, ambiguous KAS accounts and duplicate unsafe paths', async () => {
  const cmsController = { async publishBundled() { throw new Error('Must not be called'); } };
  await assert.rejects(
    createWebsiteFactory({ allInklService, cmsController }).create(testRequest), /SITEOPS_DEFAULT_CMS_ADMIN_EMAIL/
  );
  await assert.rejects(
    createWebsiteFactory({ allInklService, cmsController, defaultAdminEmail: 'admin@example.de' })
      .create({ ...testRequest, baseUrl: 'https://container.unknown.de' }), /Kein eingerichtetes/
  );
  const duplicates = { async list() { return [{ id: accountId }, { id: '44444444-4444-4444-8444-444444444444' }]; },
    async domains() { return [{ domain_name: 'lorzen.de' }]; } };
  await assert.rejects(
    createWebsiteFactory({ allInklService: duplicates, cmsController, defaultAdminEmail: 'admin@example.de' })
      .create(testRequest), /Mehrere/
  );
});
