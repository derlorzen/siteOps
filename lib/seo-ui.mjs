// Dashboard fragments for the Screaming-Frog-style SEO checks (lib/seo-rules.mjs). Plain HTML
// strings like the rest of the server-rendered dashboard; `esc` is the app's HTML escaper.
import { CUSTOM_RULE_TYPES, DESCRIPTION_MAX_PX, TITLE_MAX_PX } from './seo-rules.mjs';

const kb = bytes => (bytes == null ? '–' : Math.round(bytes / 1024) + ' KB');
const fact = (label, value) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
const pill = (ok, text) => '<span class="pill ' + (ok ? 'ok' : 'bad') + '">' + text + '</span>';

function pixelBar(px, max) {
  const pct = Math.min(100, Math.round((px / max) * 100));
  return (
    '<span class="seo-pixel-bar" title="' +
    px +
    ' / ' +
    max +
    ' px"><i style="width:' +
    pct +
    '%;background:' +
    (px > max ? 'var(--bad, #c0392b)' : 'var(--ok, #2e7d32)') +
    '"></i></span> ' +
    px +
    ' / ' +
    max +
    ' px'
  );
}

/** Google-like search snippet with pixel widths (estimated with Arial metrics). */
export function seoSnippetPreviewHtml(p, details, esc) {
  const snippet = details?.snippet;
  if (!snippet) return '';
  const title = p.title || '(ohne Title)',
    description = p.meta_description || '',
    url = String(p.url || '');
  let crumb = url;
  try {
    const u = new URL(url);
    crumb = u.hostname + (u.pathname === '/' ? '' : ' › ' + u.pathname.split('/').filter(Boolean).join(' › '));
  } catch {
    // keep the raw URL
  }
  return (
    '<section><div class="sectionhead"><div><span class="eyebrow">Snippet</span><h2>Suchergebnis-Vorschau</h2></div><small>Breite geschätzt mit Arial-Metriken (Title 20 px, Description 14 px). Google kürzt ab ca. ' +
    TITLE_MAX_PX +
    ' bzw. ' +
    DESCRIPTION_MAX_PX +
    ' px.</small></div>' +
    '<div class="seo-snippet" style="max-width:640px;font-family:Arial,sans-serif;padding:12px 0"><div style="font-size:12px;opacity:.75">' +
    esc(crumb) +
    '</div><div style="font-size:20px;line-height:1.3;color:#1a0dab;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:' +
    TITLE_MAX_PX +
    'px">' +
    esc(title) +
    '</div><div style="font-size:14px;line-height:1.58;max-width:600px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">' +
    esc(description || 'Keine Meta Description – Google wählt selbst einen Textausschnitt.') +
    '</div></div><dl class="facts compact-facts">' +
    fact('Title-Breite', pixelBar(snippet.titlePx, snippet.titleMaxPx || TITLE_MAX_PX)) +
    fact('Description-Breite', pixelBar(snippet.descriptionPx, snippet.descriptionMaxPx || DESCRIPTION_MAX_PX)) +
    '</dl></section>'
  );
}

/** Technical details, Search Console metrics, images, privacy and custom extraction of one page. */
export function seoPageExtrasHtml(details, esc) {
  if (!details) return '';
  let html = '';
  const tech =
    fact('TTFB', details.ttfbMs == null ? '–' : details.ttfbMs + ' ms') +
    fact('X-Robots-Tag', esc(details.xRobotsTag || '–')) +
    fact('Canonical (HTTP-Header)', esc(details.headerCanonical || '–')) +
    fact('Canonical-Tags im HTML', String((details.canonicals || []).length)) +
    fact(
      'Viewport',
      details.viewport == null ? '–' : pill(details.viewport, details.viewport ? 'Vorhanden' : 'Fehlt')
    ) +
    fact(
      'Überschriften-Folge',
      esc(
        (details.headings || [])
          .slice(0, 30)
          .map(level => 'H' + level)
          .join(' ') || '–'
      )
    ) +
    fact('Rich-Result-Typen', esc((details.richResultTypes || []).join(', ') || '–'));
  let gsc = '<p class="lead">Keine Search-Console-Daten für diese URL (Property verknüpfen und synchronisieren).</p>';
  if (details.searchConsole) {
    const s = details.searchConsole;
    gsc =
      '<dl class="facts compact-facts">' +
      fact('Klicks', s.clicks) +
      fact('Impressionen', s.impressions) +
      fact('CTR', (s.ctr * 100).toFixed(1) + ' %') +
      fact('Ø Position', s.position ?? '–') +
      '</dl>';
  }
  html +=
    '<div class="twocol ops-grid"><section><div class="sectionhead"><div><span class="eyebrow">Technik</span><h2>Direktiven &amp; Antwort</h2></div></div><dl class="facts compact-facts">' +
    tech +
    '</dl></section><section><div class="sectionhead"><div><span class="eyebrow">Google</span><h2>Search Console</h2></div><small>Letzte Synchronisierung</small></div>' +
    gsc +
    '</section></div>';
  const images = details.images || [];
  if (images.length) {
    const rows = images
      .map(
        i =>
          '<tr><td><a href="' +
          esc(i.src) +
          '" target="_blank" rel="noopener">' +
          esc(i.src.length > 90 ? i.src.slice(0, 87) + '…' : i.src) +
          '</a></td><td>' +
          kb(i.bytes) +
          '</td><td>' +
          esc(i.contentType || '–') +
          '</td><td>' +
          (i.width && i.height ? esc(i.width + '×' + i.height) : '<span class="pill bad">fehlt</span>') +
          '</td><td>' +
          esc(i.alt || '–') +
          '</td></tr>'
      )
      .join('');
    html +=
      '<section><div class="sectionhead"><div><span class="eyebrow">Medien</span><h2>Bilder</h2></div><small>' +
      images.length +
      ' Bilder · Größe per HEAD-Anfrage ermittelt.</small></div><div class="tablewrap"><table><thead><tr><th>Bild</th><th>Größe</th><th>Format</th><th>width×height</th><th>Alt</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div></section>';
  }
  if (details.privacy) html += seoPrivacyHtml(details.privacy, esc, 'Diese Seite');
  if (details.extracted && Object.keys(details.extracted).length) {
    const rows = Object.entries(details.extracted)
      .map(
        ([name, values]) =>
          '<tr><td><strong>' + esc(name) + '</strong></td><td>' + esc((values || []).join(' · ') || '–') + '</td></tr>'
      )
      .join('');
    html +=
      '<section><div class="sectionhead"><div><span class="eyebrow">Eigene Regeln</span><h2>Extrahierte Werte</h2></div></div><div class="tablewrap"><table><thead><tr><th>Regel</th><th>Werte</th></tr></thead><tbody>' +
      rows +
      '</tbody></table></div></section>';
  }
  return html;
}

function seoPrivacyHtml(privacy, esc, scope) {
  const providers = (privacy.providers || [])
    .map(
      p =>
        '<tr><td>' +
        esc(p.name) +
        '</td><td><span class="pill ' +
        (p.level === 'warn' ? 'bad' : '') +
        '">' +
        (p.level === 'warn' ? 'Einwilligung nötig' : 'Prüfen') +
        '</span></td><td>' +
        esc((p.hosts || []).join(', ')) +
        '</td></tr>'
    )
    .join('');
  const cookies = (privacy.cookies || []).filter(c => c.tracking || c.thirdParty);
  return (
    '<section><div class="sectionhead"><div><span class="eyebrow">Datenschutz</span><h2>Vor der Einwilligung geladen</h2></div><small>' +
    esc(scope) +
    ' im frischen Browser ohne Klick auf den Cookie-Banner. Technische Prüfung, keine Rechtsberatung.</small></div><dl class="facts compact-facts">' +
    fact('Consent-Tool', esc(privacy.consentTool || 'Nicht erkannt')) +
    fact(
      'Tracking-/Drittanbieter-Cookies',
      cookies.length ? esc(cookies.map(c => c.name).join(', ')) : pill(true, 'Keine')
    ) +
    '</dl><div class="tablewrap"><table><thead><tr><th>Anbieter</th><th>Bewertung</th><th>Hosts</th></tr></thead><tbody>' +
    (providers || '<tr><td colspan="3">Keine bekannten Drittanbieter vor der Einwilligung.</td></tr>') +
    '</tbody></table></div>' +
    ((privacy.otherThirdPartyHosts || []).length
      ? '<p class="lead">Weitere externe Hosts: ' + esc(privacy.otherThirdPartyHosts.join(', ')) + '</p>'
      : '') +
    '</section>'
  );
}

/** Site-wide overview of the extended checks for the SEO dashboard. */
export function seoAuditOverviewHtml(summary, esc) {
  if (!summary || summary.sitemapHygiene === undefined) return '';
  const sm = summary.sitemapHygiene || {},
    img = summary.images || {},
    gsc = summary.searchConsole || {};
  let html =
    '<section><div class="sectionhead"><div><span class="eyebrow">Technik</span><h2>Indexierung, Sitemap &amp; Performance</h2></div><small>Prüfungen nach Vorbild der Screaming-Frog-Reports.</small></div><div class="twocol ops-grid"><dl class="facts compact-facts">' +
    fact('robots.txt', pill(summary.robotsTxtFound, summary.robotsTxtFound ? 'Vorhanden' : 'Fehlt')) +
    fact('Per robots.txt gesperrte Seiten', summary.robotsBlockedPages ?? 0) +
    fact(
      'Sitemap-URLs mit Problemen',
      (sm.broken || 0) +
        ' defekt · ' +
        (sm.redirect || 0) +
        ' Weiterleitung · ' +
        (sm.noindex || 0) +
        ' noindex · ' +
        (sm.nonCanonical || 0) +
        ' nicht canonical'
    ) +
    fact('hreflang-Hinweise', summary.hreflangIssues ?? 0) +
    fact('Canonical-Probleme', summary.canonicalIssues ?? 0) +
    fact('Soft 404', summary.softPages404 ?? 0) +
    '</dl><dl class="facts compact-facts">' +
    fact('Ø TTFB', summary.avgTtfbMs == null ? '–' : summary.avgTtfbMs + ' ms') +
    fact('Bilder gemessen', img.measured ?? 0) +
    fact('Zu große Bilder', img.large ?? 0) +
    fact('Bildgewicht gesamt', kb(img.totalBytes)) +
    fact(
      'Eigene Regeln',
      (summary.customRules || 0) + ' aktiv · ' + (summary.customRuleFailures || 0) + ' nicht erfüllt'
    ) +
    fact(
      'Search Console',
      gsc.available
        ? gsc.matchedPages +
            ' Seiten mit Daten · ' +
            gsc.uncrawledWithImpressions +
            ' URLs mit Impressionen nicht gecrawlt'
        : esc(gsc.reason || 'Nicht verknüpft')
    ) +
    '</dl></div>';
  if (gsc.available && (gsc.uncrawled || []).length)
    html +=
      '<div class="tablewrap"><table><thead><tr><th>URL mit Impressionen, aber nicht im Crawl</th><th>Impressionen</th><th>Klicks</th></tr></thead><tbody>' +
      gsc.uncrawled
        .slice(0, 10)
        .map(r => '<tr><td>' + esc(r.url) + '</td><td>' + r.impressions + '</td><td>' + r.clicks + '</td></tr>')
        .join('') +
      '</tbody></table></div>';
  html += '</section>';
  if (summary.privacy)
    html += seoPrivacyHtml(
      {
        consentTool: summary.privacy.consentTool,
        providers: summary.privacy.providers,
        cookies: (summary.privacy.trackingCookies || []).map(name => ({ name, tracking: true }))
      },
      esc,
      summary.privacy.pages + (summary.privacy.pages === 1 ? ' Seite' : ' Seiten')
    );
  return html;
}

const RULE_TYPE_LABELS = {
  css_exists: 'CSS-Selektor muss vorkommen',
  css_missing: 'CSS-Selektor darf nicht vorkommen',
  text_contains: 'Text muss vorkommen',
  text_missing: 'Text darf nicht vorkommen',
  regex_html: 'Regex muss im HTML passen',
  regex_html_missing: 'Regex darf im HTML nicht passen',
  extract: 'Wert extrahieren (CSS, optional Attribut)'
};

/** Editor for the per-site custom search/extraction rules (JSON list, saved via PUT). */
export function seoCustomRulesEditorHtml(siteSlug, rules, esc) {
  const example = [
    {
      name: 'Google Analytics nicht direkt eingebunden',
      type: 'regex_html_missing',
      value: 'gtag\\(|googletagmanager'
    },
    { name: 'Telefonnummer im Footer', type: 'css_exists', value: 'footer a[href^="tel:"]' },
    { name: 'Autor', type: 'extract', value: 'meta[name="author"]', attr: 'content' }
  ];
  return (
    '<section><div class="sectionhead"><div><span class="eyebrow">Eigene Regeln</span><h2>Benutzerdefinierte Suche &amp; Extraktion</h2></div><small>Bis zu 30 Regeln, gelten ab dem nächsten Crawl. Leere Liste entfernt alle Regeln.</small></div>' +
    '<p class="lead">Typen: ' +
    CUSTOM_RULE_TYPES.map(t => '<code>' + t + '</code> (' + esc(RULE_TYPE_LABELS[t]) + ')').join(', ') +
    '.</p><textarea id="seoRulesInput" rows="10" spellcheck="false" style="width:100%;font-family:monospace">' +
    esc(JSON.stringify(rules?.length ? rules : [], null, 2)) +
    '</textarea><div class="actions"><button type="button" id="seoRulesSave">Regeln speichern</button><button type="button" class="ghost" id="seoRulesExample">Beispiel einfügen</button><span id="seoRulesState"></span></div>' +
    '<script>(()=>{const input=document.getElementById("seoRulesInput"),state=document.getElementById("seoRulesState");document.getElementById("seoRulesExample").addEventListener("click",()=>{input.value=' +
    JSON.stringify(JSON.stringify(example, null, 2)).replace(/</g, '\\u003c') +
    ';});document.getElementById("seoRulesSave").addEventListener("click",async()=>{let rules;try{rules=JSON.parse(input.value||"[]");}catch(e){state.textContent="✗ Kein gültiges JSON";return;}state.textContent="Speichere…";const r=await fetch("/api/sites/' +
    encodeURIComponent(siteSlug) +
    '/seo/rules",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({rules})}),x=await r.json();state.textContent=r.ok?"✓ "+x.rules.length+" Regeln gespeichert":"✗ "+(x.message||x.error||JSON.stringify(x));if(r.ok)input.value=JSON.stringify(x.rules,null,2);});})();</script></section>'
  );
}
