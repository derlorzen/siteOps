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

## Datenschutz und Cookies

Unter **Verwaltung → Datenschutz & Cookies** lassen sich veröffentlichte Impressums- und Datenschutzseiten für die Installation auswählen. Ohne Vorgabe werden vorhandene Standardpfade erkannt. Optionale Kategorien sind ab Werk deaktiviert.

Optionale, lokal bereitgestellte Skripte werden nur aus bewusst markierten Platzhaltern geladen, zum Beispiel `<script type="text/plain" data-lorzcms-consent="statistics" data-src="/assets/statistics.js"></script>`. Die Kategorie muss im CMS aktiviert sein. Solche Skripte und optionale Ressourcen dürfen nicht zusätzlich unmittelbar im Seitentemplate geladen werden. Die Auswahl gilt für die jeweilige Origin und Version der Einstellungen. Beim Widerruf lädt die Seite ohne die widerrufenen Skripte neu. Falls ein Dienst Browserdaten setzt, muss seine Integration die dafür erforderliche Bereinigung separat vorsehen.
