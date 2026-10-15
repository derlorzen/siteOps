import crypto from 'node:crypto';
import { posix as posixPath } from 'node:path';
import * as z from 'zod/v4';
import { hostingTargetSchema } from './site-provisioning.mjs';
import { kasDomainNames, normalizeHost, splitSubdomain } from './allinkl.mjs';

/**
 * ChatGPT-facing one-request website creator. Any facts not explicitly passed
 * by the caller are left out; the new website stays noindex pending editorial
 * review, complete legal notices and SSL activation.
 */
export const websiteCreateSchema = z.object({
  companyName: z.string().trim().min(2).max(190),
  location: z.string().trim().min(2).max(190),
  baseUrl: z.url(),
  description: z.string().trim().max(900).optional(),
  services: z.array(z.string().trim().min(2).max(120)).max(12).default([]),
  contactEmail: z.email().optional(),
  contactPhone: z.string().trim().min(5).max(70).optional(),
  adminEmail: z.email().optional(),
  adminName: z.string().trim().min(2).max(190).optional(),
  adminPassword: z.string().min(12).max(72).optional(),
  allinklAccountId: z.uuid().optional(),
  remoteRoot: hostingTargetSchema.optional(),
  projectId: z.uuid().optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#b4da32'),
  previewOnly: z.boolean().default(false)
});

const escapeHtml = input =>
  String(input).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function normalizedOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash ||
      !['', '/'].includes(url.pathname)) {
    throw new Error('Website-Adresse muss eine reine HTTPS-Subdomain ohne Port und Pfad sein.');
  }
  return 'https://' + normalizeHost(url.hostname);
}

function shortName(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0,80) || 'website';
}

const page = (title, path, body, description, baseUrl) => ({
  title, path, body,
  seo: {
    title: title.slice(0,110),
    description: description.slice(0,240),
    canonical: baseUrl + (path === '/' ? '/' : path)
  }
});

export function websiteBlueprint(raw) {
  const x = websiteCreateSchema.parse(raw);
  const origin = normalizedOrigin(x.baseUrl);
  const name = x.companyName, city = x.location, services = [...new Set(x.services)];
  const nameHtml = escapeHtml(name), cityHtml = escapeHtml(city);
  const text = x.description?.trim() ||
    ('Informationen zu ' + name + ' in ' + city + '. Nehmen Sie Kontakt auf, um Ihr Anliegen zu besprechen.');
  const intro = escapeHtml(text);
  const serviceItems = services.length
    ? '<ul>' + services.map(value => '<li>' + escapeHtml(value) + '</li>').join('') + '</ul>'
    : '<p>Welche Leistungen für Ihr Vorhaben infrage kommen, klären wir gern im persönlichen Gespräch.</p>';
  const contact = [
    x.contactPhone
      ? '<p>Telefon: <a href="tel:' + escapeHtml(x.contactPhone.replace(/[^+0-9]/g,'')) + '">' +
        escapeHtml(x.contactPhone) + '</a></p>'
      : '',
    x.contactEmail
      ? '<p>E-Mail: <a href="mailto:' + escapeHtml(x.contactEmail) + '">' +
        escapeHtml(x.contactEmail) + '</a></p>'
      : ''
  ].filter(Boolean).join('');
  const contactBody = contact || '<p>Die Kontaktdaten werden vor der öffentlichen Freigabe ergänzt.</p>';
  const summary = name + ' in ' + city + ' – Informationen und Kontakt.';
  const pages = [
    page(name, '/', '<h2>' + nameHtml + ' in ' + cityHtml + '</h2><p>' + intro +
      '</p><p><a href="/leistungen">Leistungen ansehen</a> · <a href="/kontakt">Kontakt aufnehmen</a></p>' +
      '<h2>Leistungen</h2>' + serviceItems, summary, origin),
    page('Leistungen', '/leistungen', '<h2>Leistungen von ' + nameHtml + '</h2>' + serviceItems +
      '<p><a href="/kontakt">Jetzt Kontakt aufnehmen</a></p>',
      'Leistungen von ' + name + ' in ' + city + '.', origin),
    page('Über uns', '/ueber-uns', '<h2>' + nameHtml + '</h2><p>' + intro +
      '</p><p>Standort: ' + cityHtml + '</p><p><a href="/kontakt">Zum Kontakt</a></p>',
      'Mehr über ' + name + ' in ' + city + '.', origin),
    page('Kontakt', '/kontakt', '<h2>Kontakt zu ' + nameHtml + '</h2><p>Standort: ' +
      cityHtml + '</p>' + contactBody,
      'Kontakt zu ' + name + ' in ' + city + '.', origin)
  ];
  // This template uses the shared responsive LorzCMS layouts, rather than
  // embedding executable HTML, untrusted assets or invented testimonials.
  return {
    companyName: name,
    tagline: x.description?.trim().slice(0,255) || name + ' · ' + city,
    location: city,
    contactEmail: x.contactEmail || '',
    accent: x.accent,
    pages,
    menu: pages.map((item, i) => ({ id: 'siteops-' + i, label: item.path === '/' ? 'Start' : item.title, url: item.path, parent: '', location: 'header' })),
    reviewRequired: true,
    seoIndexing: 'disabled',
    legalNotice: 'Impressum und Datenschutz vor öffentlicher Suchmaschinen-Freigabe ergänzen.'
  };
}

export function defaultWebsiteRoot(baseUrl, rootBase = '/siteops-websites') {
  const host = normalizeHost(new URL(normalizedOrigin(baseUrl)).hostname);
  const base = hostingTargetSchema.parse(rootBase);
  return hostingTargetSchema.parse(posixPath.join(base, host.replaceAll('.', '-')));
}

export function createWebsiteFactory({
  allInklService,
  cmsController,
  defaultAdminEmail = '',
  hostingRootBase = '/siteops-websites',
  randomBytes = crypto.randomBytes
}) {
  async function resolve(raw) {
    const x = websiteCreateSchema.parse(raw);
    const origin = normalizedOrigin(x.baseUrl);
    const hostname = new URL(origin).hostname;
    const allAccounts = await allInklService.list();
    const matched = [];
    for (const account of allAccounts.filter(a => !x.allinklAccountId || a.id === x.allinklAccountId)) {
      const domains = kasDomainNames(await allInklService.domains(account.id));
      try {
        splitSubdomain(hostname, domains);
        matched.push({ id: account.id, name: account.name, domains });
      } catch {
        // This KAS account does not administer the requested subdomain.
      }
    }
    if (matched.length !== 1) {
      throw new Error(matched.length
        ? 'Mehrere ALL-INKL-Konten verwalten diese Subdomain. allinklAccountId angeben.'
        : 'Kein eingerichtetes ALL-INKL-Konto verwaltet ' + hostname + '.');
    }
    const adminEmail = x.adminEmail || defaultAdminEmail;
    if (!z.email().safeParse(adminEmail).success)
      throw new Error('Einmalig SITEOPS_DEFAULT_CMS_ADMIN_EMAIL konfigurieren oder adminEmail angeben.');
    const remoteRoot = x.remoteRoot || defaultWebsiteRoot(origin, hostingRootBase);
    return { input: x, origin, hostname, account: matched[0], remoteRoot, adminEmail };
  }
  async function plan(raw) {
    const resolved = await resolve(raw);
    return {
      site: resolved.hostname,
      company: resolved.input.companyName,
      location: resolved.input.location,
      allinklAccount: resolved.account.name,
      allinklAccountId: resolved.account.id,
      remoteRoot: resolved.remoteRoot,
      adminEmail: resolved.adminEmail,
      content: websiteBlueprint({ ...resolved.input, baseUrl: resolved.origin }),
      warning: 'Die Website bleibt bis zur redaktionellen und rechtlichen Abnahme auf noindex. HTTPS muss bei ALL-INKL verfügbar sein.'
    };
  }
  async function create(raw) {
    const resolved = await resolve(raw);
    if (resolved.input.previewOnly) return plan(raw);
    const blueprint = websiteBlueprint({ ...resolved.input, baseUrl: resolved.origin });
    const released = await cmsController.publishBundled();
    const adminPassword = resolved.input.adminPassword || randomBytes(32).toString('base64url').slice(0,40);
    const site = await cmsController.create({
      slug: shortName(resolved.hostname),
      name: resolved.input.companyName,
      baseUrl: resolved.origin,
      version: released.version,
      remoteRoot: resolved.remoteRoot,
      allinklAccountId: resolved.account.id,
      publicRootReady: true,
      database: { engine: 'sqlite' },
      adminName: resolved.input.adminName || 'Website-Administration',
      adminEmail: resolved.adminEmail,
      adminPassword,
      projectId: resolved.input.projectId,
      websiteBlueprint: blueprint
    });
    return {
      ...site,
      website: resolved.origin,
      company: resolved.input.companyName,
      cmsVersion: released.version,
      state: 'queued',
      adminEmail: resolved.adminEmail,
      // Only returned to the authenticated creator and never persisted in
      // website status or the model's later status polling replies.
      ...(resolved.input.adminPassword ? {} : { generatedAdminPassword: adminPassword }),
      reviewRequired: true,
      nextStep: 'Website-Auftrag läuft. Über website_create_status prüfen; vor Indexfreigabe Kontakt, Impressum, Datenschutz, Fakten und SSL kontrollieren.'
    };
  }
  async function status(installationId) {
    const overview = await cmsController.overview();
    const website = overview.installations.find(item => item.id === installationId);
    if (!website) throw new Error('Website-Auftrag nicht gefunden.');
    const jobs = overview.jobs.filter(item => item.installationId === installationId);
    return {
      installationId,
      name: website.name,
      state: website.state,
      cmsVersion: website.version,
      latestJob: jobs[0] || null,
      published: website.state === 'ready',
      indexing: 'disabled_until_review',
      note: website.state === 'ready'
        ? 'CMS eingerichtet und Seiten veröffentlicht. Rechtsangaben und SEO-Indexierung bleiben zur manuellen Freigabe offen.'
        : 'Bei fehlendem SSL oder PHP wird der Auftrag zur Prüfung angehalten. Nach Korrektur über CMS-Aufträge erneut starten.'
    };
  }
  return { plan, create, status };
}
