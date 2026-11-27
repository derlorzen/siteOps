import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  anchorIssues,
  contentIssues,
  crossPageIssues,
  descriptionPixelWidth,
  directiveIssues,
  evaluateCustomRules,
  headingIssues,
  imageIssues,
  parseRobotsTxt,
  performanceIssues,
  privacyIssues,
  richResultIssues,
  robotsAllowed,
  searchConsoleIssues,
  snippetIssues,
  titlePixelWidth,
  urlIssues,
  validateCustomRules
} from '../lib/seo-rules.mjs';

const codes = list => list.map(i => i.code);
const keyOf = url => {
  const u = new URL(url);
  return u.hostname.replace(/^www\./, '') + (u.pathname.replace(/\/$/, '') || '/') + u.search;
};

test('robots.txt: longest match wins, Allow wins ties, wildcards and $', () => {
  const groups = parseRobotsTxt(
    [
      'User-agent: *',
      'Disallow: /intern/',
      'Allow: /intern/presse',
      'Disallow: /*.pdf$',
      '',
      'User-agent: Googlebot',
      'User-agent: Bingbot',
      'Disallow: /nur-google/',
      'Allow: /nur-google/frei'
    ].join('\n')
  );
  assert.equal(groups.length, 2);
  // Googlebot uses its own group only.
  assert.equal(robotsAllowed(groups, 'https://x.de/intern/geheim'), true);
  assert.equal(robotsAllowed(groups, 'https://x.de/nur-google/a'), false);
  assert.equal(robotsAllowed(groups, 'https://x.de/nur-google/frei'), true);
  assert.equal(robotsAllowed(groups, 'https://x.de/intern/geheim', 'otherbot'), false);
  assert.equal(robotsAllowed(groups, 'https://x.de/intern/presse/1', 'otherbot'), true);
  assert.equal(robotsAllowed(groups, 'https://x.de/a.pdf', 'otherbot'), false);
  assert.equal(robotsAllowed(groups, 'https://x.de/a.pdf?x=1', 'otherbot'), true);
  assert.equal(robotsAllowed([], 'https://x.de/'), true);
});

test('pixel widths flag long titles and descriptions', () => {
  assert.ok(titlePixelWidth('Kurz') < 80);
  assert.ok(titlePixelWidth('W'.repeat(40)) > 580);
  assert.ok(descriptionPixelWidth('a'.repeat(100)) < descriptionPixelWidth('W'.repeat(100)));
  const result = snippetIssues({ title: 'M'.repeat(40), metaDescription: 'kurz' });
  assert.deepEqual(codes(result.issues), ['title_pixel_width']);
  assert.ok(result.titlePx > 580 && result.descriptionPx > 0);
});

test('URL, heading, anchor and directive rules', () => {
  assert.deepEqual(codes(urlIssues('https://x.de/Ein_Pfad//test?a=1')).sort(), [
    'url_double_slash',
    'url_parameters',
    'url_underscore',
    'url_uppercase'
  ]);
  assert.deepEqual(urlIssues('https://x.de/sauber/'), []);
  assert.deepEqual(codes(headingIssues({ headings: [2, 1, 4], h1: ['Titel'], title: 'Titel' })).sort(), [
    'h1_equals_title',
    'heading_order',
    'heading_skipped'
  ]);
  const links = [
    { internal: true, anchor: '', imageAlt: 'Logo' },
    { internal: true, anchor: '' },
    { internal: true, anchor: 'Hier klicken' },
    { internal: true, anchor: 'Leistungen', nofollow: true },
    { internal: false, anchor: '' }
  ];
  assert.deepEqual(codes(anchorIssues(links)), ['anchor_empty', 'anchor_generic', 'internal_nofollow']);
  assert.match(anchorIssues(links)[0].text, /^1 /);
  assert.deepEqual(
    codes(
      directiveIssues({
        xRobotsTag: 'noindex, nofollow',
        canonicals: ['https://x.de/a', 'https://x.de/b'],
        headerCanonical: 'https://x.de/c',
        robots: 'noindex',
        viewport: false
      })
    ),
    [
      'x_robots_noindex',
      'x_robots_nofollow',
      'canonical_multiple',
      'canonical_conflict',
      'noindex_with_canonical',
      'viewport_missing'
    ]
  );
  assert.deepEqual(directiveIssues({ canonicals: ['https://x.de/a'], headerCanonical: 'https://x.de/a' }), []);
});

test('soft 404, placeholder text and performance', () => {
  assert.deepEqual(codes(contentIssues({ statusCode: 200, title: 'Seite nicht gefunden', wordCount: 30 })), [
    'soft_404'
  ]);
  assert.deepEqual(contentIssues({ statusCode: 404, title: 'Seite nicht gefunden' }), []);
  assert.deepEqual(codes(contentIssues({ statusCode: 200, title: 'Start', text: 'Lorem ipsum dolor sit amet' })), [
    'placeholder_text'
  ]);
  assert.deepEqual(codes(performanceIssues({ ttfbMs: 2000, contentBytes: 2 * 1024 * 1024 })), [
    'ttfb_slow',
    'page_large'
  ]);
  assert.equal(performanceIssues({ ttfbMs: 800 })[0].level, 'info');
  assert.deepEqual(performanceIssues({ ttfbMs: 100, contentBytes: 1000 }), []);
});

test('image weight, format, dimensions and alt length', () => {
  const images = [
    { src: 'https://x.de/a.jpg', alt: 'A', width: '10', height: '10' },
    { src: 'https://x.de/b.webp', alt: 'x'.repeat(130) },
    { src: 'https://x.de/c.png', alt: '', width: '1', height: '1' }
  ];
  const sizes = new Map([
    ['https://x.de/a.jpg', { bytes: 300 * 1024, contentType: 'image/jpeg' }],
    ['https://x.de/b.webp', { bytes: 200 * 1024, contentType: 'image/webp' }],
    ['https://x.de/c.png', { bytes: 5 * 1024, contentType: 'image/png' }]
  ]);
  const result = imageIssues(images, sizes);
  assert.deepEqual(codes(result), ['image_large', 'image_dimensions_missing', 'image_legacy_format', 'image_alt_long']);
  assert.match(result[0].text, /^2 Bilder über 100 KB \(größtes 300 KB\)/);
  assert.match(result[2].text, /^1 /);
});

test('rich results: required and recommended fields, also inside @graph', () => {
  const result = richResultIssues([
    {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'Product', name: 'Tasse' },
        {
          '@type': 'Restaurant',
          name: 'Fischhaus',
          address: 'Hafen 1',
          telephone: '1',
          openingHoursSpecification: [],
          geo: {},
          url: 'x'
        },
        { '@type': 'Event', name: 'Fest', startDate: '2026-12-01', location: 'Hafen' }
      ]
    },
    { invalid: true }
  ]);
  assert.deepEqual(result.types.sort(), ['Event', 'Product', 'Restaurant']);
  assert.ok(
    result.issues.some(i => i.code === 'rich_result_required_missing' && /Product: .*offers oder review/.test(i.text))
  );
  assert.ok(result.issues.some(i => i.code === 'rich_result_required_missing' && /Restaurant/.test(i.text)) === false);
  assert.ok(
    result.issues.some(i => i.code === 'rich_result_recommended_missing' && /Event: empfohlen endDate/.test(i.text))
  );
});

test('custom rules: validation and evaluation', () => {
  assert.throws(() => validateCustomRules([{ name: 'x', type: 'nope', value: 'a' }]), /unbekannter Typ/);
  assert.throws(() => validateCustomRules([{ name: 'x', type: 'regex_html', value: '(a+)+' }]), /verschachtelte/);
  assert.throws(() => validateCustomRules([{ name: 'x', type: 'regex_html', value: '(' }]));
  assert.throws(() =>
    validateCustomRules(Array.from({ length: 31 }, () => ({ name: 'x', type: 'css_exists', value: 'a' })))
  );
  const rules = validateCustomRules([
    { name: 'Tel', type: 'css_exists', value: 'footer a[href^="tel:"]' },
    { name: 'Kein GA', type: 'regex_html_missing', value: 'googletagmanager' },
    { name: 'Hinweis', type: 'text_contains', value: 'Öffnungszeiten' },
    { name: 'Autor', type: 'extract', value: 'meta[name="author"]', attr: 'content' },
    { name: 'Preis', type: 'extract', value: '.preis' }
  ]);
  const html =
    '<html><head><meta name="author" content="Lorzen"><script src="https://www.googletagmanager.com/gtm.js"></script></head><body><p class="preis"> 9,90 € </p><footer>Kontakt</footer></body></html>';
  const result = evaluateCustomRules(rules, { $: cheerio.load(html), html, text: 'Kontakt' });
  assert.deepEqual(
    result.issues.map(i => i.text),
    ['Eigene Regel „Tel“ nicht erfüllt', 'Eigene Regel „Kein GA“ nicht erfüllt', 'Eigene Regel „Hinweis“ nicht erfüllt']
  );
  assert.deepEqual(result.extracted, { Autor: ['Lorzen'], Preis: ['9,90 €'] });
});

test('privacy: third parties, tracking cookies and consent tools', () => {
  const result = privacyIssues(
    {
      requests: [
        { host: 'www.beispiel.de', url: 'https://www.beispiel.de/style.css', count: 3 },
        { host: 'fonts.googleapis.com', count: 1 },
        { host: 'fonts.gstatic.com', count: 2 },
        { host: 'www.googletagmanager.com', count: 1 },
        { host: 'cdn.jsdelivr.net', count: 1 },
        { host: 'tracker.example', count: 1 }
      ],
      cookies: [
        { name: '_ga', domain: '.beispiel.de' },
        { name: 'session', domain: 'www.beispiel.de' }
      ]
    },
    'www.beispiel.de'
  );
  assert.deepEqual(codes(result.issues), [
    'privacy_third_party',
    'privacy_third_party',
    'privacy_cdn',
    'privacy_tracking_cookie',
    'privacy_no_consent_tool'
  ]);
  assert.equal(result.summary.providers.find(p => p.name === 'Google Fonts').requests, 3);
  assert.deepEqual(result.summary.otherThirdPartyHosts, ['tracker.example']);
  const withConsent = privacyIssues(
    {
      requests: [
        { host: 'beispiel.de', url: 'https://beispiel.de/wp-content/plugins/borlabs-cookie/x.js' },
        { host: 'fonts.googleapis.com' }
      ],
      cookies: []
    },
    'beispiel.de'
  );
  assert.equal(withConsent.summary.consentTool, 'Borlabs Cookie');
  assert.deepEqual(codes(withConsent.issues), ['privacy_third_party']);
  assert.deepEqual(privacyIssues(null, 'x.de'), { issues: [], summary: null });
});

const page = (url, extra = {}) => ({
  url,
  statusCode: 200,
  indexable: true,
  redirectCount: 0,
  canonical: url,
  hreflang: [],
  links: [],
  resources: [],
  issues: [],
  ...extra
});

test('cross-page: canonical targets, hreflang return links, robots and sitemap hygiene', () => {
  const pages = [
    page('https://x.de/', {
      hreflang: [
        { lang: 'de', href: 'https://x.de/' },
        { lang: 'en', href: 'https://x.de/en/' }
      ],
      resources: ['https://x.de/intern/app.js'],
      links: [{ internal: true, target: 'https://x.de/intern/seite' }]
    }),
    page('https://x.de/en/', { hreflang: [{ lang: 'en', href: 'https://x.de/en/' }] }),
    page('https://x.de/a', { canonical: 'https://x.de/b' }),
    page('https://x.de/b', { indexable: false }),
    page('https://x.de/c', { canonical: 'https://x.de/weg' }),
    page('https://x.de/weg', { statusCode: 404, indexable: false }),
    page('https://x.de/neu', { requestedUrl: 'https://x.de/alt', redirectCount: 1 }),
    page('https://x.de/intern/seite')
  ];
  const robots = parseRobotsTxt('User-agent: *\nDisallow: /intern/');
  const result = crossPageIssues({
    pages,
    keyOf,
    sitemapPages: ['https://x.de/', 'https://x.de/b', 'https://x.de/weg', 'https://x.de/alt', 'https://x.de/a'],
    robots
  });
  const by = url => codes(pages.find(p => p.url === url).issues);
  assert.deepEqual(by('https://x.de/'), [
    'hreflang_no_x_default',
    'hreflang_no_return',
    'robots_blocked_resource',
    'link_to_robots_blocked'
  ]);
  assert.deepEqual(by('https://x.de/en/'), ['hreflang_no_x_default']);
  assert.deepEqual(by('https://x.de/a'), ['canonical_target_noindex', 'sitemap_non_canonical']);
  assert.deepEqual(by('https://x.de/c'), ['canonical_target_broken']);
  assert.deepEqual(by('https://x.de/weg'), ['sitemap_broken']);
  assert.deepEqual(by('https://x.de/b'), ['sitemap_noindex']);
  assert.deepEqual(by('https://x.de/neu'), ['sitemap_redirect']);
  assert.deepEqual(by('https://x.de/intern/seite'), ['robots_blocked']);
  assert.deepEqual(result.sitemap, { redirect: 1, broken: 1, noindex: 1, nonCanonical: 1, blocked: 0 });
});

test('Search Console rows map to pages and flag contradictions', () => {
  const pages = [
    page('https://x.de/'),
    page('https://x.de/weg', { statusCode: 404, indexable: false }),
    page('https://x.de/privat', { indexable: false })
  ];
  const result = searchConsoleIssues({
    pages,
    keyOf,
    rows: [
      { keys: ['https://www.x.de/'], clicks: 0, impressions: 500, ctr: 0.002, position: 4.25 },
      { keys: ['https://x.de/weg'], clicks: 1, impressions: 20, ctr: 0.05, position: 12 },
      { keys: ['https://x.de/privat/'], clicks: 0, impressions: 3, ctr: 0, position: 30 },
      { keys: ['https://x.de/nicht-gecrawlt'], clicks: 2, impressions: 40, ctr: 0.05, position: 8 }
    ]
  });
  assert.deepEqual(pages[0].searchConsole, { clicks: 0, impressions: 500, ctr: 0.002, position: 4.3 });
  assert.deepEqual(codes(pages[0].issues), ['gsc_low_ctr']);
  assert.deepEqual(codes(pages[1].issues), ['gsc_impressions_broken']);
  assert.deepEqual(codes(pages[2].issues), ['gsc_impressions_noindex']);
  assert.equal(result.uncrawledCount, 1);
  assert.equal(result.uncrawled[0].url, 'https://x.de/nicht-gecrawlt');
});
