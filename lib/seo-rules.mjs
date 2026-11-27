// Additional SEO checks modelled on Screaming Frog's report tabs. Pure functions on data the
// crawler already collected, so they run in-process and are unit-testable without a network.

// ---------------------------------------------------------------------------------------------
// robots.txt (Google's matching rules: longest match wins, Allow wins a tie, `*` and `$`)
// ---------------------------------------------------------------------------------------------
export function parseRobotsTxt(text) {
  const groups = [];
  let current = null,
    lastWasAgent = false;
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(),
      value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current || (key !== 'allow' && key !== 'disallow')) continue;
    current.rules.push({ allow: key === 'allow', path: value });
  }
  return groups;
}

function robotsPatternMatches(pattern, path) {
  if (!pattern) return false;
  const anchored = pattern.endsWith('$'),
    body = anchored ? pattern.slice(0, -1) : pattern,
    regex = new RegExp(
      '^' +
        body
          .split('*')
          .map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
          .join('.*') +
        (anchored ? '$' : '')
    );
  return regex.test(path);
}

/** @returns {boolean} whether `url` may be crawled by `agent` (default Googlebot). */
export function robotsAllowed(groups, url, agent = 'googlebot') {
  if (!groups?.length) return true;
  let path;
  try {
    const u = new URL(url);
    path = u.pathname + u.search;
  } catch {
    return true;
  }
  const name = agent.toLowerCase();
  const specific = groups.filter(g => g.agents.some(a => a !== '*' && name.includes(a))),
    applicable = specific.length ? specific : groups.filter(g => g.agents.includes('*'));
  let best = null;
  for (const rule of applicable.flatMap(g => g.rules)) {
    if (!rule.path) continue; // "Disallow:" with an empty value allows everything
    if (!robotsPatternMatches(rule.path, path)) continue;
    const length = rule.path.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) best = { ...rule, length };
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------------------------
// Snippet pixel width (Arial; Google shows titles at about 20px and descriptions at about 14px)
// ---------------------------------------------------------------------------------------------
const ARIAL = {
  ' ': 278,
  '!': 278,
  '"': 355,
  '#': 556,
  $: 556,
  '%': 889,
  '&': 667,
  "'": 191,
  '(': 333,
  ')': 333,
  '*': 389,
  '+': 584,
  ',': 278,
  '-': 333,
  '.': 278,
  '/': 278,
  ':': 278,
  ';': 278,
  '<': 584,
  '=': 584,
  '>': 584,
  '?': 556,
  '@': 1015,
  '[': 278,
  '\\': 278,
  ']': 278,
  _: 556,
  '|': 260,
  '–': 556,
  '—': 1000,
  '·': 278,
  '„': 333,
  '“': 333,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  ß: 611,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611
};
export const TITLE_MAX_PX = 580;
export const DESCRIPTION_MAX_PX = 920;

export function textPixelWidth(text, fontPx) {
  let units = 0;
  for (const ch of String(text || '')) {
    const base = ch.normalize('NFD')[0];
    units += ARIAL[ch] ?? ARIAL[base] ?? (/\d/.test(ch) ? 556 : 556);
  }
  return Math.round((units / 1000) * fontPx);
}
export const titlePixelWidth = text => textPixelWidth(text, 20);
export const descriptionPixelWidth = text => textPixelWidth(text, 14);

// ---------------------------------------------------------------------------------------------
// Per-page rules
// ---------------------------------------------------------------------------------------------
const issue = (level, code, text) => ({ level, code, text });

export function urlIssues(url) {
  const out = [];
  let u;
  try {
    u = new URL(url);
  } catch {
    return out;
  }
  const path = u.pathname;
  if (/[A-Z]/.test(path)) out.push(issue('info', 'url_uppercase', 'URL enthält Großbuchstaben'));
  if (path.includes('_')) out.push(issue('info', 'url_underscore', 'URL enthält Unterstriche statt Bindestrichen'));
  if (/\/\/+/.test(path)) out.push(issue('warn', 'url_double_slash', 'URL enthält doppelte Schrägstriche'));
  if (/%[89A-F][0-9A-F]|[^\x20-\x7e]/i.test(path))
    out.push(issue('info', 'url_non_ascii', 'URL enthält Umlaute oder andere Nicht-ASCII-Zeichen'));
  if (u.search) out.push(issue('info', 'url_parameters', 'URL enthält Parameter'));
  if (url.length > 115) out.push(issue('info', 'url_long', 'URL länger als 115 Zeichen (' + url.length + ')'));
  if (/\s|%20/.test(path)) out.push(issue('warn', 'url_whitespace', 'URL enthält Leerzeichen'));
  return out;
}

export function headingIssues({ headings = [], h1 = [], title = '' }) {
  const out = [];
  let previous = 0;
  for (const level of headings) {
    if (previous && level > previous + 1) {
      out.push(
        issue('info', 'heading_skipped', 'Überschriftenebene übersprungen (H' + previous + ' → H' + level + ')')
      );
      break;
    }
    previous = level;
  }
  if (headings.length && headings[0] !== 1 && h1.length)
    out.push(issue('info', 'heading_order', 'Erste Überschrift ist nicht die H1'));
  if (h1[0] && title && h1[0].trim().toLowerCase() === title.trim().toLowerCase())
    out.push(issue('info', 'h1_equals_title', 'H1 ist identisch mit dem Title'));
  if (h1.some(text => text.length > 70)) out.push(issue('info', 'h1_long', 'H1 länger als 70 Zeichen'));
  return out;
}

export function snippetIssues({ title = '', metaDescription = '' }) {
  const out = [];
  const tw = title ? titlePixelWidth(title) : 0,
    dw = metaDescription ? descriptionPixelWidth(metaDescription) : 0;
  if (tw > TITLE_MAX_PX)
    out.push(
      issue('warn', 'title_pixel_width', 'Title ca. ' + tw + ' px breit, Google kürzt ab ca. ' + TITLE_MAX_PX + ' px')
    );
  if (dw > DESCRIPTION_MAX_PX)
    out.push(
      issue(
        'info',
        'description_pixel_width',
        'Description ca. ' + dw + ' px breit, Google kürzt ab ca. ' + DESCRIPTION_MAX_PX + ' px'
      )
    );
  return { issues: out, titlePx: tw, descriptionPx: dw };
}

const GENERIC_ANCHORS = new Set(
  (
    'hier|hier klicken|klicken sie hier|klick hier|mehr|mehr erfahren|mehr lesen|mehr infos|mehr informationen|' +
    'weiterlesen|weiter|zum artikel|details|link|click here|here|read more|more|learn more|continue|info'
  ).split('|')
);
export function anchorIssues(links = [], { maxInternalLinks = 150 } = {}) {
  const out = [];
  const internal = links.filter(l => l.internal),
    empty = internal.filter(l => !l.anchor && !l.imageAlt),
    generic = internal.filter(l =>
      GENERIC_ANCHORS.has(
        String(l.anchor || '')
          .toLowerCase()
          .replace(/[.:!…»›→]+$/g, '')
          .trim()
      )
    ),
    nofollow = internal.filter(l => l.nofollow);
  if (empty.length) out.push(issue('warn', 'anchor_empty', empty.length + ' interne Links ohne Ankertext'));
  if (generic.length)
    out.push(
      issue(
        'info',
        'anchor_generic',
        generic.length + ' interne Links mit nichtssagendem Ankertext (z. B. „' + generic[0].anchor + '“)'
      )
    );
  if (nofollow.length) out.push(issue('warn', 'internal_nofollow', nofollow.length + ' interne Links mit nofollow'));
  if (internal.length > maxInternalLinks)
    out.push(issue('info', 'links_too_many', internal.length + ' interne Links auf einer Seite'));
  return out;
}

export function directiveIssues({
  xRobotsTag = '',
  canonicals = [],
  headerCanonical = '',
  robots = '',
  viewport = true
}) {
  const out = [];
  if (/noindex/i.test(xRobotsTag)) out.push(issue('error', 'x_robots_noindex', 'X-Robots-Tag-Header: noindex'));
  if (/nofollow/i.test(xRobotsTag)) out.push(issue('warn', 'x_robots_nofollow', 'X-Robots-Tag-Header: nofollow'));
  const unique = [...new Set([...canonicals, headerCanonical].filter(Boolean))];
  if (canonicals.length > 1)
    out.push(issue('warn', 'canonical_multiple', canonicals.length + ' Canonical-Tags im HTML'));
  if (unique.length > 1)
    out.push(issue('warn', 'canonical_conflict', 'Widersprüchliche Canonicals (HTML/HTTP-Header)'));
  if (/noindex/i.test(robots) && canonicals.length)
    out.push(
      issue('info', 'noindex_with_canonical', 'noindex zusammen mit Canonical gesetzt (widersprüchliches Signal)')
    );
  if (!viewport) out.push(issue('warn', 'viewport_missing', 'Kein Viewport-Meta-Tag (Mobilansicht)'));
  return out;
}

const NOT_FOUND =
  /(seite (wurde )?nicht gefunden|page not found|404|nicht mehr verfügbar|existiert nicht|not be found)/i;
const PLACEHOLDER = /\blorem ipsum\b|\bdolor sit amet\b|\bplatzhaltertext\b|\bblindtext\b/i;
export function contentIssues({ statusCode, title = '', h1 = [], text = '', wordCount = 0 }) {
  const out = [];
  if (statusCode === 200 && (NOT_FOUND.test(title) || NOT_FOUND.test(h1[0] || '')) && wordCount < 400)
    out.push(issue('error', 'soft_404', 'Seite liefert HTTP 200, meldet aber „nicht gefunden“ (Soft 404)'));
  if (PLACEHOLDER.test(text)) out.push(issue('warn', 'placeholder_text', 'Platzhaltertext (Lorem ipsum) gefunden'));
  return out;
}

export function performanceIssues({ ttfbMs, contentBytes }) {
  const out = [];
  if (ttfbMs > 1500) out.push(issue('warn', 'ttfb_slow', 'Serverantwort langsam (TTFB ' + ttfbMs + ' ms)'));
  else if (ttfbMs > 600) out.push(issue('info', 'ttfb_slow', 'Serverantwort mäßig (TTFB ' + ttfbMs + ' ms)'));
  if (contentBytes > 1024 * 1024)
    out.push(issue('warn', 'page_large', 'HTML-Dokument ' + Math.round(contentBytes / 1024) + ' KB groß'));
  return out;
}

const MODERN_IMAGE = /\.(webp|avif|svg)(?:$|\?)/i;
/** images: [{src, alt, width, height}], sizes: Map(src -> {bytes, contentType}) */
export function imageIssues(images = [], sizes = new Map(), { maxBytes = 100 * 1024 } = {}) {
  const out = [];
  const noDims = images.filter(i => !i.width || !i.height),
    longAlt = images.filter(i => (i.alt || '').length > 125),
    large = [],
    legacy = [];
  for (const img of images) {
    const size = sizes.get(img.src);
    if (!size?.bytes) continue;
    if (size.bytes > maxBytes) large.push({ ...img, bytes: size.bytes });
    const type = String(size.contentType || '');
    if (size.bytes > 30 * 1024 && !MODERN_IMAGE.test(img.src) && !/webp|avif|svg/i.test(type)) legacy.push(img);
  }
  if (large.length)
    out.push(
      issue(
        'warn',
        'image_large',
        large.length +
          ' Bilder über ' +
          Math.round(maxBytes / 1024) +
          ' KB (größtes ' +
          Math.round(Math.max(...large.map(i => i.bytes)) / 1024) +
          ' KB)'
      )
    );
  if (noDims.length)
    out.push(issue('info', 'image_dimensions_missing', noDims.length + ' Bilder ohne width/height (Layoutsprünge)'));
  if (legacy.length)
    out.push(issue('info', 'image_legacy_format', legacy.length + ' größere Bilder nicht als WebP/AVIF'));
  if (longAlt.length) out.push(issue('info', 'image_alt_long', longAlt.length + ' Alt-Texte länger als 125 Zeichen'));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Structured data: Google rich result required / recommended properties
// ---------------------------------------------------------------------------------------------
const has = (node, key) => {
  const v = node?.[key];
  return v != null && v !== '' && !(Array.isArray(v) && !v.length);
};
const RICH_RESULTS = {
  Product: {
    anyOf: [['offers', 'review', 'aggregateRating']],
    required: ['name'],
    recommended: ['image', 'description']
  },
  Offer: { required: [], anyOf: [['price', 'priceSpecification']], recommended: ['priceCurrency', 'availability'] },
  AggregateRating: { required: ['ratingValue'], anyOf: [['ratingCount', 'reviewCount']] },
  Review: { required: ['author', 'reviewRating'] },
  Event: { required: ['name', 'startDate', 'location'], recommended: ['endDate', 'image', 'description'] },
  Recipe: { required: ['name', 'image'], recommended: ['recipeIngredient', 'recipeInstructions'] },
  JobPosting: {
    required: ['title', 'description', 'datePosted', 'hiringOrganization'],
    anyOf: [['jobLocation', 'jobLocationType']]
  },
  LocalBusiness: {
    required: ['name', 'address'],
    recommended: ['telephone', 'openingHoursSpecification', 'geo', 'url']
  },
  Organization: { required: [], recommended: ['name', 'url', 'logo'] },
  Article: { required: [], recommended: ['headline', 'image', 'datePublished', 'author'] },
  NewsArticle: { required: [], recommended: ['headline', 'image', 'datePublished', 'author'] },
  BlogPosting: { required: [], recommended: ['headline', 'image', 'datePublished', 'author'] },
  VideoObject: { required: ['name', 'thumbnailUrl', 'uploadDate'], recommended: ['description', 'contentUrl'] },
  BreadcrumbList: { required: ['itemListElement'] },
  FAQPage: { required: ['mainEntity'] },
  Question: { required: ['name', 'acceptedAnswer'] },
  SoftwareApplication: { required: ['name'], anyOf: [['offers'], ['aggregateRating', 'review']] }
};
const LOCAL_BUSINESS =
  /^(LocalBusiness|Restaurant|Store|Dentist|Physician|LegalService|AutomotiveBusiness|HomeAndConstructionBusiness|ProfessionalService|MedicalBusiness|FoodEstablishment|LodgingBusiness|HealthAndBeautyBusiness|Hotel)$/;

function walkSchema(node, visit, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  if (Array.isArray(node)) return node.forEach(n => walkSchema(n, visit, depth + 1));
  if (node['@graph']) walkSchema(node['@graph'], visit, depth + 1);
  if (node['@type']) visit(node);
  for (const [key, value] of Object.entries(node))
    if (key !== '@graph' && value && typeof value === 'object') walkSchema(value, visit, depth + 1);
}

export function richResultIssues(structuredData = []) {
  const out = [],
    found = new Set();
  walkSchema(
    structuredData.filter(x => !x?.invalid),
    node => {
      for (const rawType of [].concat(node['@type'])) {
        const type = LOCAL_BUSINESS.test(rawType) ? 'LocalBusiness' : rawType,
          spec = RICH_RESULTS[type];
        if (!spec) continue;
        found.add(rawType);
        const missing = (spec.required || []).filter(k => !has(node, k));
        for (const group of spec.anyOf || []) if (!group.some(k => has(node, k))) missing.push(group.join(' oder '));
        if (missing.length)
          out.push(
            issue('warn', 'rich_result_required_missing', rawType + ': Pflichtfeld fehlt (' + missing.join(', ') + ')')
          );
        const recommended = (spec.recommended || []).filter(k => !has(node, k));
        if (recommended.length && !missing.length)
          out.push(issue('info', 'rich_result_recommended_missing', rawType + ': empfohlen ' + recommended.join(', ')));
        if (type === 'BreadcrumbList')
          for (const item of [].concat(node.itemListElement || []))
            if (!has(item, 'position') || (!has(item, 'name') && !has(item?.item, 'name'))) {
              out.push(
                issue('warn', 'rich_result_required_missing', 'BreadcrumbList: Eintrag ohne position oder name')
              );
              break;
            }
      }
    }
  );
  // One message per distinct text is enough.
  const seen = new Set();
  return { issues: out.filter(i => !seen.has(i.text) && seen.add(i.text)), types: [...found] };
}

// ---------------------------------------------------------------------------------------------
// Custom search / extraction rules (per site)
// ---------------------------------------------------------------------------------------------
export const CUSTOM_RULE_TYPES = [
  'css_exists',
  'css_missing',
  'text_contains',
  'text_missing',
  'regex_html',
  'regex_html_missing',
  'extract'
];

export function validateCustomRules(rules) {
  if (!Array.isArray(rules)) throw new Error('Regeln müssen eine Liste sein');
  if (rules.length > 30) throw new Error('Höchstens 30 Regeln je Website');
  return rules.map((rule, index) => {
    const name = String(rule?.name || '')
        .trim()
        .slice(0, 80),
      type = String(rule?.type || ''),
      value = String(rule?.value || '').slice(0, 500),
      attr = rule?.attr ? String(rule.attr).slice(0, 40) : undefined;
    if (!name) throw new Error('Regel ' + (index + 1) + ': Name fehlt');
    if (!CUSTOM_RULE_TYPES.includes(type)) throw new Error('Regel ' + (index + 1) + ': unbekannter Typ ' + type);
    if (!value) throw new Error('Regel ' + (index + 1) + ': Wert fehlt');
    if (type.startsWith('regex')) {
      if (value.length > 200) throw new Error('Regel ' + (index + 1) + ': regulärer Ausdruck zu lang');
      // Reject nested quantifiers, the usual catastrophic-backtracking shape.
      if (/\([^)]*[+*][^)]*\)[+*{]/.test(value))
        throw new Error('Regel ' + (index + 1) + ': verschachtelte Wiederholung nicht erlaubt');
      new RegExp(value, 'i');
    }
    return { name, type, value, ...(attr ? { attr } : {}) };
  });
}

/** $: cheerio document; html: raw string; text: extracted main text */
export function evaluateCustomRules(rules = [], { $, html = '', text = '' }) {
  const issues = [],
    extracted = {};
  for (const rule of rules) {
    try {
      if (rule.type === 'extract') {
        const values = $(rule.value)
          .slice(0, 10)
          .map((_, e) => (rule.attr ? $(e).attr(rule.attr) : $(e).text()).replace(/\s+/g, ' ').trim())
          .get()
          .filter(Boolean);
        extracted[rule.name] = values;
        continue;
      }
      let hit;
      if (rule.type === 'css_exists' || rule.type === 'css_missing') hit = $(rule.value).length > 0;
      else if (rule.type === 'text_contains' || rule.type === 'text_missing')
        hit =
          text.toLowerCase().includes(rule.value.toLowerCase()) ||
          $.root().text().toLowerCase().includes(rule.value.toLowerCase());
      else hit = new RegExp(rule.value, 'i').test(html.slice(0, 2_000_000));
      const expected = ['css_exists', 'text_contains', 'regex_html'].includes(rule.type);
      if (hit !== expected) issues.push(issue('warn', 'custom_rule', 'Eigene Regel „' + rule.name + '“ nicht erfüllt'));
    } catch {
      issues.push(
        issue('info', 'custom_rule_error', 'Eigene Regel „' + rule.name + '“ konnte nicht ausgewertet werden')
      );
    }
  }
  return { issues, extracted };
}

// ---------------------------------------------------------------------------------------------
// Privacy / GDPR: third parties and cookies before any consent interaction
// ---------------------------------------------------------------------------------------------
const THIRD_PARTIES = [
  [/(^|\.)fonts\.(googleapis|gstatic)\.com$/, 'Google Fonts', 'warn'],
  [
    /(^|\.)(google-analytics\.com|analytics\.google\.com|googletagmanager\.com)$/,
    'Google Analytics / Tag Manager',
    'warn'
  ],
  [/(^|\.)(doubleclick\.net|googleadservices\.com|googlesyndication\.com)$/, 'Google Ads', 'warn'],
  [/(^|\.)(facebook\.(net|com)|fbcdn\.net)$/, 'Meta / Facebook', 'warn'],
  [/(^|\.)(youtube\.com|youtube-nocookie\.com|ytimg\.com|googlevideo\.com)$/, 'YouTube', 'warn'],
  [/(^|\.)maps\.(googleapis|gstatic)\.com$/, 'Google Maps', 'warn'],
  [/(^|\.)(hotjar\.com|hotjar\.io)$/, 'Hotjar', 'warn'],
  [/(^|\.)(licdn\.com|linkedin\.com)$/, 'LinkedIn', 'warn'],
  [/(^|\.)(tiktok\.com|tiktokcdn\.com)$/, 'TikTok', 'warn'],
  [/(^|\.)(bing\.com|clarity\.ms)$/, 'Microsoft Bing / Clarity', 'warn'],
  [/(^|\.)(vimeo\.com|vimeocdn\.com)$/, 'Vimeo', 'warn'],
  [/(^|\.)(pinterest\.com|pinimg\.com)$/, 'Pinterest', 'warn'],
  [/(^|\.)(hubspot\.com|hs-scripts\.com|hs-analytics\.net|hsforms\.com)$/, 'HubSpot', 'warn'],
  [/(^|\.)(gstatic\.com|google\.com|recaptcha\.net)$/, 'Google (reCAPTCHA/sonstige)', 'warn'],
  [
    /(^|\.)(cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|unpkg\.com|code\.jquery\.com|ajax\.googleapis\.com|use\.fontawesome\.com|kit\.fontawesome\.com|use\.typekit\.net)$/,
    'Externes CDN',
    'info'
  ]
];
const CONSENT_TOOLS = [
  [/(^|\.)cookiebot\.(com|eu)$/, 'Cookiebot'],
  [/(^|\.)usercentrics\.(eu|com)$/, 'Usercentrics'],
  [/(^|\.)consentmanager\.(net|de)$/, 'consentmanager'],
  [/(^|\.)(cookielaw\.org|onetrust\.com)$/, 'OneTrust'],
  [/(^|\.)cookieyes\.com$/, 'CookieYes'],
  [/(^|\.)iubenda\.com$/, 'iubenda'],
  [/(^|\.)ccm19\.de$/, 'CCM19'],
  [/(^|\.)klaro\.(org|kiprotect\.com)$/, 'Klaro']
];
const CONSENT_PATHS = [
  [/borlabs-cookie/i, 'Borlabs Cookie'],
  [/complianz/i, 'Complianz'],
  [/real-cookie-banner/i, 'Real Cookie Banner'],
  [/cookie-law-info|cookieyes/i, 'CookieYes'],
  [/klaro(\.min)?\.js/i, 'Klaro']
];
const TRACKING_COOKIES =
  /^(_ga(_.*)?|_gid|_gat.*|_gcl_.*|_fbp|_fbc|_hj.*|_clck|_clsk|_uet.*|IDE|NID|DSID|test_cookie|li_sugr|bcookie|lidc|_tt_.*|_ttp|_pin_unauth|__hstc|hubspotutk|__hssc|__hssrc|_pk_id.*|_pk_ses.*|YSC|VISITOR_INFO1_LIVE)$/;

function registrable(host) {
  const parts = String(host || '')
    .toLowerCase()
    .replace(/^www\./, '')
    .split('.');
  return parts.slice(-2).join('.');
}

/** privacy: {requests:[{host, url?, type, count}], cookies:[{name, domain}], scripts:[url]} */
export function privacyIssues(privacy, siteHost) {
  if (!privacy) return { issues: [], summary: null };
  const own = registrable(siteHost),
    providers = new Map(),
    unknown = new Set();
  let consentTool = null;
  for (const r of privacy.requests || []) {
    const host = String(r.host || '').toLowerCase();
    if (!host || registrable(host) === own) {
      for (const [re, name] of CONSENT_PATHS) if (re.test(r.url || '')) consentTool ||= name;
      continue;
    }
    const consent = CONSENT_TOOLS.find(([re]) => re.test(host));
    if (consent) {
      consentTool ||= consent[1];
      continue;
    }
    const known = THIRD_PARTIES.find(([re]) => re.test(host));
    if (known) {
      const entry = providers.get(known[1]) || { name: known[1], level: known[2], hosts: new Set(), requests: 0 };
      entry.hosts.add(host);
      entry.requests += r.count || 1;
      providers.set(known[1], entry);
    } else unknown.add(host);
  }
  const cookies = (privacy.cookies || []).map(c => ({
    name: c.name,
    domain: String(c.domain || '').replace(/^\./, ''),
    thirdParty: registrable(String(c.domain || '').replace(/^\./, '')) !== own,
    tracking: TRACKING_COOKIES.test(c.name)
  }));
  const tracking = cookies.filter(c => c.tracking || c.thirdParty),
    out = [];
  for (const p of providers.values())
    out.push(
      issue(
        p.level,
        p.level === 'warn' ? 'privacy_third_party' : 'privacy_cdn',
        p.name + ' wird ohne Interaktion geladen (' + [...p.hosts].slice(0, 3).join(', ') + ')'
      )
    );
  if (tracking.length)
    out.push(
      issue(
        'warn',
        'privacy_tracking_cookie',
        tracking.length +
          ' Tracking- oder Drittanbieter-Cookies ohne Interaktion gesetzt (' +
          tracking
            .slice(0, 5)
            .map(c => c.name)
            .join(', ') +
          ')'
      )
    );
  if (!consentTool && (providers.size || tracking.length))
    out.push(issue('info', 'privacy_no_consent_tool', 'Kein bekanntes Consent-Tool erkannt'));
  return {
    issues: out,
    summary: {
      consentTool,
      providers: [...providers.values()].map(p => ({
        name: p.name,
        level: p.level,
        hosts: [...p.hosts],
        requests: p.requests
      })),
      otherThirdPartyHosts: [...unknown].slice(0, 30),
      cookies: cookies.slice(0, 60)
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Cross-page rules (need the whole crawl)
// ---------------------------------------------------------------------------------------------
/**
 * @param {object} ctx
 * @param {object[]} ctx.pages
 * @param {(url:string)=>string} ctx.keyOf
 * @param {string[]} ctx.sitemapPages
 * @param {Array} ctx.robots parsed robots groups
 * @param {string} ctx.rootKey
 */
export function crossPageIssues({ pages, keyOf, sitemapPages = [], robots = [] }) {
  const byKey = new Map(pages.map(p => [keyOf(p.url), p])),
    push = (p, level, code, text) => p.issues.push(issue(level, code, text));
  const sitemap = { redirect: 0, broken: 0, noindex: 0, nonCanonical: 0, blocked: 0 };

  for (const p of pages) {
    // Canonical target state
    if (p.canonical && keyOf(p.canonical) !== keyOf(p.url)) {
      const target = byKey.get(keyOf(p.canonical));
      if (target) {
        if (target.statusCode >= 400 || target.statusCode === 0)
          push(
            p,
            'error',
            'canonical_target_broken',
            'Canonical zeigt auf HTTP ' + target.statusCode + ': ' + p.canonical
          );
        else if (target.redirectCount > 0)
          push(p, 'warn', 'canonical_target_redirect', 'Canonical zeigt auf eine Weiterleitung: ' + p.canonical);
        else if (!target.indexable)
          push(p, 'warn', 'canonical_target_noindex', 'Canonical zeigt auf eine noindex-Seite: ' + p.canonical);
        else if (target.canonical && keyOf(target.canonical) !== keyOf(target.url))
          push(p, 'warn', 'canonical_chain', 'Canonical-Kette: Ziel canonicalisiert weiter auf ' + target.canonical);
      }
    }
    // hreflang targets and return links
    const alternates = p.hreflang || [];
    if (alternates.length) {
      if (!alternates.some(h => /^x-default$/i.test(h.lang)))
        push(p, 'info', 'hreflang_no_x_default', 'hreflang ohne x-default');
      if (!alternates.some(h => keyOf(h.href) === keyOf(p.url)))
        push(p, 'warn', 'hreflang_no_self', 'hreflang-Gruppe ohne Selbstverweis');
      const langs = alternates.map(h => h.lang.toLowerCase());
      if (new Set(langs).size !== langs.length)
        push(p, 'warn', 'hreflang_duplicate_lang', 'hreflang-Sprache mehrfach angegeben');
      for (const h of alternates) {
        if (keyOf(h.href) === keyOf(p.url)) continue;
        const target = byKey.get(keyOf(h.href));
        if (!target) continue;
        if (target.statusCode !== 200 || target.redirectCount > 0)
          push(
            p,
            'warn',
            'hreflang_target_status',
            'hreflang „' +
              h.lang +
              '“ zeigt auf HTTP ' +
              target.statusCode +
              (target.redirectCount ? ' mit Weiterleitung' : '') +
              ': ' +
              h.href
          );
        else if (!target.indexable)
          push(p, 'warn', 'hreflang_target_noindex', 'hreflang „' + h.lang + '“ zeigt auf noindex-Seite: ' + h.href);
        else if (target.canonical && keyOf(target.canonical) !== keyOf(target.url))
          push(
            p,
            'warn',
            'hreflang_target_non_canonical',
            'hreflang „' + h.lang + '“ zeigt auf nicht-canonical URL: ' + h.href
          );
        else if (!(target.hreflang || []).some(back => keyOf(back.href) === keyOf(p.url)))
          push(p, 'warn', 'hreflang_no_return', 'Kein Rückverweis von ' + h.href + ' (hreflang „' + h.lang + '“)');
      }
    }
    // robots.txt
    if (robots.length && !robotsAllowed(robots, p.url))
      push(p, p.indexable ? 'warn' : 'info', 'robots_blocked', 'Durch robots.txt für Googlebot gesperrt');
    if (robots.length) {
      const blockedResources = (p.resources || []).filter(
        r => /\.(css|js)(?:$|\?)/i.test(r) && byHostSame(r, p.url) && !robotsAllowed(robots, r)
      );
      if (blockedResources.length)
        push(
          p,
          'warn',
          'robots_blocked_resource',
          blockedResources.length + ' CSS/JS-Dateien per robots.txt gesperrt (Rendering)'
        );
      const blockedLinks = (p.links || []).filter(l => l.internal && !robotsAllowed(robots, l.target));
      if (blockedLinks.length)
        push(
          p,
          'info',
          'link_to_robots_blocked',
          blockedLinks.length + ' interne Links auf per robots.txt gesperrte URLs'
        );
    }
  }
  // Sitemap hygiene
  const sitemapKeys = new Set(sitemapPages.map(keyOf)),
    byRequested = new Map(
      pages.filter(p => p.redirectCount > 0 && p.requestedUrl).map(p => [keyOf(p.requestedUrl), p])
    );
  for (const key of sitemapKeys) {
    // A sitemap URL that redirects is stored under its final URL.
    const p = byRequested.get(key) || byKey.get(key);
    if (!p) continue;
    if (p.statusCode >= 400 || p.statusCode === 0) {
      sitemap.broken++;
      push(p, 'error', 'sitemap_broken', 'In der Sitemap, liefert aber HTTP ' + p.statusCode);
    } else if (p.redirectCount > 0 && p.requestedUrl && keyOf(p.requestedUrl) === key) {
      sitemap.redirect++;
      push(p, 'warn', 'sitemap_redirect', 'In der Sitemap mit einer weiterleitenden URL');
    } else if (!p.indexable) {
      sitemap.noindex++;
      push(p, 'warn', 'sitemap_noindex', 'In der Sitemap, aber noindex');
    } else if (p.canonical && keyOf(p.canonical) !== keyOf(p.url)) {
      sitemap.nonCanonical++;
      push(p, 'warn', 'sitemap_non_canonical', 'In der Sitemap, aber nicht canonical');
    }
    if (robots.length && !robotsAllowed(robots, p.url)) sitemap.blocked++;
  }
  return { sitemap };
}
function byHostSame(a, b) {
  try {
    return new URL(a).hostname.replace(/^www\./, '') === new URL(b).hostname.replace(/^www\./, '');
  } catch {
    return false;
  }
}

/** Search Console page rows → per-page metrics and findings. rows: [{keys:[url], clicks, impressions, ctr, position}] */
export function searchConsoleIssues({ pages, keyOf, rows = [] }) {
  const byKey = new Map(pages.map(p => [keyOf(p.url), p])),
    uncrawled = [];
  for (const row of rows) {
    const url = row.keys?.[0];
    if (!url) continue;
    const p = byKey.get(keyOf(url));
    const metrics = {
      clicks: Number(row.clicks) || 0,
      impressions: Number(row.impressions) || 0,
      ctr: Number(row.ctr) || 0,
      position: row.position == null ? null : Number(Number(row.position).toFixed(1))
    };
    if (!p) {
      if (metrics.impressions > 0) uncrawled.push({ url, ...metrics });
      continue;
    }
    p.searchConsole = metrics;
    if (metrics.impressions > 0 && (p.statusCode >= 400 || p.statusCode === 0))
      p.issues.push(
        issue('error', 'gsc_impressions_broken', 'Hat Google-Impressionen, liefert aber HTTP ' + p.statusCode)
      );
    else if (metrics.impressions > 0 && !p.indexable)
      p.issues.push(issue('warn', 'gsc_impressions_noindex', 'Hat Google-Impressionen, steht aber auf noindex'));
    if (metrics.impressions >= 100 && metrics.ctr < 0.01 && metrics.position != null && metrics.position <= 10)
      p.issues.push(
        issue(
          'info',
          'gsc_low_ctr',
          'Top-10-Position (' + metrics.position + '), aber CTR unter 1 % – Title/Description prüfen'
        )
      );
  }
  uncrawled.sort((a, b) => b.impressions - a.impressions);
  return { uncrawled: uncrawled.slice(0, 50), uncrawledCount: uncrawled.length };
}
