import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accidentInsuranceBlueprint, accidentInsuranceSports } from '../lib/website-presets.mjs';
import { createWebsiteFactory, websiteBlueprint, websiteCreateSchema } from '../lib/website-factory.mjs';

const input = { baseUrl: 'https://unfall.lorzen.de', preset: 'accident-insurance' };
const id = '11111111-1111-4111-8111-111111111111';

test('one request for insurance website needs no fictional business name or city', () => {
  assert.equal(websiteCreateSchema.safeParse(input).success, true);
  assert.equal(websiteCreateSchema.safeParse({ baseUrl: input.baseUrl }).success, false);
  assert.equal(websiteCreateSchema.safeParse({ baseUrl: input.baseUrl, preset: 'business' }).success, false);
  const site = websiteBlueprint(input);
  assert.equal(site.companyName, 'Unfallversicherung verständlich erklärt');
  assert.equal(site.pages.length, 6);
  assert.equal(site.menu.length, 6);
  assert.deepEqual(
    site.pages.map(x => x.path),
    [
      '/',
      '/gesetzlich-privat',
      '/unfallversicherung-fussball',
      '/unfallversicherung-skisport',
      '/unfallversicherung-radfahren',
      '/unfallversicherung-handball'
    ]
  );
  assert.equal(site.seoIndexing, 'disabled');
  assert.equal(site.reviewRequired, true);
  assert.match(site.themeCss, /max-width:720px/);
});

test('sports are the top four by reported ERGO claims in 2025, without asserting person-hour risk', () => {
  assert.deepEqual(
    accidentInsuranceSports.map(x => x.name),
    ['Fußball', 'Skisport', 'Radfahren', 'Handball']
  );
  assert.deepEqual(
    accidentInsuranceSports.map(x => x.count),
    ['2.308', '1.001', '579', '189']
  );
  assert.deepEqual(
    accidentInsuranceSports.map(x => x.share),
    ['35,6', '15,4', '8,9', '2,9']
  );
  const site = accidentInsuranceBlueprint({ origin: input.baseUrl });
  const home = site.pages[0].body;
  const all = site.pages.map(p => p.body).join('\n');
  for (const sport of accidentInsuranceSports) {
    assert.match(home, new RegExp(sport.name));
    assert.ok(site.pages.some(p => p.path === '/unfallversicherung-' + sport.key));
  }
  assert.match(home, /nicht das Unfallrisiko pro Sportstunde/);
  assert.match(
    all,
    /keine individuelle Unfallwahrscheinlichkeit|keine bundesweit repräsentative|keine individuelle Unfallwahrscheinlichkeit/i
  );
  assert.match(all, /www\.ergo\.com\/de\/newsroom-ergo\/reports-dossiers\/sportunfaelle/);
  assert.match(all, /www\.dguv\.de/);
  assert.match(home, /Berufsunfähigkeitsversicherung/);
  assert.match(home, /dauerhaft/i);
  assert.doesNotMatch(all, /100 ?% Schutz|garantierte Auszahlung|kostenloser Schutz/i);
});

test('individual SEO metadata and canonical URLs are valid for all landing pages', () => {
  const site = websiteBlueprint(input);
  assert.equal(new Set(site.pages.map(p => p.seo.title)).size, site.pages.length);
  for (const page of site.pages) {
    assert.ok(page.seo.description.length > 45 && page.seo.description.length < 250, page.path);
    assert.equal(page.seo.canonical, 'https://unfall.lorzen.de' + (page.path === '/' ? '/' : page.path));
    assert.match(page.body, /<h2>/);
    assert.ok(page.body.length > 500, page.path);
  }
});

test('website_create passes insurance preset to the same CMS installation worker as business sites', async () => {
  let submitted;
  const factory = createWebsiteFactory({
    allInklService: {
      list: async () => [{ id, name: 'Lorzen Hosting' }],
      domains: async () => [{ domain_name: 'lorzen.de' }]
    },
    cmsController: {
      publishBundled: async () => ({ version: '3.5.0' }),
      create: async details => {
        submitted = details;
        return {
          installationId: '22222222-2222-4222-8222-222222222222',
          jobId: '33333333-3333-4333-8333-333333333333'
        };
      }
    },
    defaultAdminEmail: 'admin@example.de',
    randomBytes: () => Buffer.alloc(32, 42)
  });
  const result = await factory.create(input);
  assert.equal(result.website, input.baseUrl);
  assert.equal(submitted.name, 'Unfallversicherung verständlich erklärt');
  assert.equal(submitted.remoteRoot, '/siteops-websites/unfall-lorzen-de');
  assert.equal(submitted.allinklAccountId, id);
  assert.equal(submitted.websiteBlueprint.pages.length, 6);
  assert.match(submitted.websiteBlueprint.themeCss, /#1c658f/);
  assert.ok(result.generatedAdminPassword.length >= 30);
});

test('a source link is provided for every page and the comparison does not misstate statutory benefits', () => {
  const pages = websiteBlueprint(input).pages;
  for (const page of pages) assert.match(page.body, /href="https:\/\//, page.path);
  const comparison = pages.find(p => p.path === '/gesetzlich-privat').body;
  assert.match(comparison, /Verletztengeld/);
  assert.match(comparison, /Schulsport/);
  assert.match(comparison, /Freizeitsport/);
  assert.match(comparison, /Krankenversicherung/);
  assert.match(comparison, /Nicht jeder Unfall/);
});
