# LorzCMS Core

Shared PHP core, administration assets and runtime. Website-specific code stays in
the installation's `projects/`; configuration, databases and media stay outside
the public document root. Imported from the project's MIT-licensed SiteCMS 3.2
core. This directory retains that MIT license; SiteOps has its own license.

To produce a release, update `version.json`, run `npm run cms:build`, then import
the generated JSON from the authenticated SiteOps LorzCMS page. Versions are
immutable after import. Schema 1 is the existing additive CMS schema. Renaming or
dropping a table/column requires a new migration and an explicit compatibility
policy before a release may be accepted. The current deployment agent rejects
schema versions other than 1.

Core 3.4 adds reusable header/footer partials and four page layouts. See
[CMS template guide](../../docs/CMS-TEMPLATES.md) for styling, per-page selection,
project extension hooks and compatibility when rolling back to an older core.
