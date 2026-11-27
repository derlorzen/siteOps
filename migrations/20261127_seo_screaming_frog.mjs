// SEO suite extension: per-page details (TTFB, snippet pixel widths, images, Search Console
// metrics, privacy findings, custom extraction) and per-site custom search/extraction rules.
export default async function run({ ensureColumn }) {
  await ensureColumn('seo_pages', 'details', 'LONGTEXT NULL');
  await ensureColumn('sites', 'seo_custom_rules', 'LONGTEXT NULL');
}
