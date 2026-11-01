import { escapeHtml as esc } from './product-ui.mjs';

const paths = {
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c4 5 4 13 0 18-4-5-4-13 0-18Z',
  project: 'M4 5h6l2 2h8v13H4zM8 12h8M8 16h5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 7v5l3 2',
  receipt: 'M6 3h9l4 4v14H6zM9 11h7M9 15h7',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  cms: 'M12 2 22 12 12 22 2 12ZM8 12l4 4 4-4-4-4Z',
  video: 'M4 5h16v14H4zM10 9l5 3-5 3z',
  connection: 'M3 7h16l-4-4M21 17H5l4 4',
  tools: 'M8 3v18M16 3v18M3 8h18M3 16h18'
};
export const workspaceNavigation = [
  { href: '/', label: 'Arbeitszentrale', icon: 'home' },
  { href: '/websites', label: 'Websites', icon: 'globe' },
  {
    label: 'Kunden & Projekte',
    icon: 'project',
    children: [
      { href: '/billing', label: 'Projekte', icon: 'project' },
      { href: '/billing/customers', label: 'Kunden', icon: 'globe' },
      { href: '/billing/time', label: 'Zeiterfassung', icon: 'clock' },
      { href: '/billing/invoices', label: 'Rechnungen', icon: 'receipt' },
      { href: '/billing/activity', label: 'Aktivitäten', icon: 'clock' },
      { href: '/billing/settings', label: 'Abrechnung', icon: 'settings' }
    ]
  },
  { href: '/lorzcms', label: 'LorzCMS', icon: 'cms' },
  { href: '/video-suite', label: 'Video Suite', icon: 'video' },
  { href: '/tools', label: 'Werkzeuge', icon: 'tools' },
  { href: '/ai', label: 'KI & Kosten', icon: 'receipt' },
  {
    label: 'Integrationen',
    icon: 'connection',
    children: [
      { href: '/mcp-info', label: 'MCP & KI-Zugriff', icon: 'connection' },
      { href: '/hosting', label: 'Hosting & DNS', icon: 'globe' },
      { href: '/coolify', label: 'Coolify & Supabase', icon: 'cms' },
      { href: '/search-console', label: 'Google Search Console', icon: 'globe' },
      { href: '/youtube', label: 'YouTube & Kanäle', icon: 'video' }
    ]
  },
  {
    label: 'Einstellungen',
    icon: 'settings',
    children: [
      { href: '/settings#system', label: 'System & Design', icon: 'settings' },
      { href: '/settings#backups', label: 'GitHub & Backups', icon: 'project' },
      { href: '/settings#defaults', label: 'Website-Standards', icon: 'project' },
      { href: '/settings#alerts', label: 'Benachrichtigungen', icon: 'clock' },
      { href: '/settings#seo', label: 'SEO & Tests', icon: 'globe' }
    ]
  }
];
export const icon = name =>
  `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.project}"/></svg>`;

export function renderWorkspaceShell(body, title) {
  const link = (item, parent) =>
    `<a href="${esc(item.href)}" class="ops-nav-item${parent ? ' ops-nav-subitem' : ''}" data-workspace-href="${esc(item.href)}"${parent ? ` data-nav-parent="${esc(parent)}"` : ''}><span class="ops-nav-icon" aria-hidden="true">${icon(item.icon)}</span><span>${esc(item.label)}</span></a>`;
  const menu = workspaceNavigation
    .map(item =>
      item.children
        ? `<details class="siteops-nav-group" data-nav-group="${esc(item.label)}"><summary><span class="ops-nav-icon" aria-hidden="true">${icon(item.icon)}</span><span>${esc(item.label)}</span><span class="siteops-nav-chevron" aria-hidden="true">⌄</span></summary><div class="siteops-nav-children">${item.children.map(child => link(child, item.label)).join('')}</div></details>`
        : link(item)
    )
    .join('');
  return `<div class="siteops-shell ops-workspace"><a class="siteops-skip" href="#siteopsMain">Zum Inhalt springen</a><header class="siteops-topbar ops-workspace-bar"><button type="button" class="siteops-menu-toggle" aria-controls="siteopsSidebar" aria-expanded="false" aria-label="Hauptmenü öffnen">${icon('menu')}</button><a class="siteops-brand" href="/"><span class="siteops-brand-mark" aria-hidden="true">S</span><span>SiteOps<small>Dein Arbeitsbereich</small></span></a><nav class="siteops-breadcrumb" aria-label="Aktueller Arbeitsbereich"><a href="/">SiteOps</a><span aria-hidden="true">/</span><strong id="siteopsCurrentPage">${esc(title)}</strong></nav><div class="ops-top-actions"><a href="/setup" class="ops-top-new">Website hinzufügen</a></div></header><aside class="siteops-sidebar ops-sidebar" id="siteopsSidebar"><span class="siteops-menu-label">Arbeitsbereiche</span><nav class="ops-side-links" aria-label="SiteOps-Navigation">${menu}</nav><div class="ops-side-footer"><a href="/logout" class="siteops-logout">Abmelden</a></div></aside><button type="button" class="siteops-nav-backdrop" aria-label="Hauptmenü schließen" hidden></button><div class="siteops-content ops-content"><main class="ops-main" id="siteopsMain" tabindex="-1">${body}</main></div></div>`;
}
