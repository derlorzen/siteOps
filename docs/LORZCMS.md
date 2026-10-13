# LorzCMS in SiteOps

SiteOps manages independent CMS installations. The common MIT-licensed core lives
in `packages/lorzcms-core/`; SiteOps and the core have separate versions. Publishing
a release never updates websites automatically. Operators choose websites and
execution times on `/lorzcms` or through the CMS MCP tools.

## New website

1. Deploy this SiteOps version; its database migrations run at startup.
2. Open **LorzCMS** and publish the bundled core version.
3. At the hosting provider, prepare a new empty project directory and configure
   the HTTPS domain's document root as that directory's **public/** subdirectory.
   SiteOps cannot change registrar, domain mapping or PHP version using FTP.
4. Enter the website address, FTP/FTPS/SFTP credentials, project directory and
   first administrator. Choose SQLite for automatic database-file creation, or
   enter a dedicated empty MySQL/MariaDB database provisioned by the host.
5. Start the installation immediately or choose a time. SiteOps checks the empty
   target again immediately before upload, uploads the baseline and invokes the
   protected HTTPS installer. The installer checks the actual document root,
   PHP 8.3+, extensions and file hashes before creating an administrator and a
   published welcome page. The new login is at `/admin/`.

Hosting credentials and queued setup credentials are encrypted with the existing
SiteOps master key. Setup secrets are erased after successful completion or
cancellation. A pending or interrupted setup retains them for a deliberate retry.
Passwords are not included in API responses, audit records or job errors. The
server stores only a hash of its deployment token. The stored token remains
encrypted in SiteOps. A hosting account is never created by this workflow.

An incorrect document root, missing HTTPS, unsupported PHP or missing database
extension prevents installation. Fix the hosting setting and use **Erneut
starten**; completed actions use the same job ID. Do not point the domain at the
CMS project root: configuration, databases and deployment snapshots are private.

## Existing HSG and NorDiaMed installations

Register the existing hosting connection in SiteOps with the CMS **project root**
as `remoteRoot`, then use **Bestehendes LorzCMS anschließen**. The domain must
already use the `public/` document root. Connection credentials must have access
to the private project directories as well as `public/`.

Enrollment accepts the known bootstrap, index, router and rewrite files from the
two local CMS installations, identified by byte hashes in
`lib/lorzcms/supported-legacy.json`. Customized entry files are rejected for
inspection. The enrollment snapshots the existing core and assets as an immutable
`legacy-*` fallback and saves the original entry files under `.lorzcms/original/`.
Project-specific rendering, handlers, HSG integrations, configuration, media and
editorial databases stay in place. The unified core preserves both HSG's status
panels and NorDiaMed's photo picker. Enrolling a website does not install the
bundled new core: the operator schedules that separately.

## Updates and rollback

An update uploads a complete release below `.lorzcms/releases/VERSION/`, then
checks every hash and PHP file on the host. Before activation, the agent makes a
database snapshot and preserves private configuration below
`.lorzcms/backups/JOB/`. SQLite uses `VACUUM INTO`; MariaDB/MySQL uses a consistent
transaction snapshot of its base tables. Use a dedicated CMS database; table
definitions must not be changed concurrently while creating a MySQL backup.

Activation replaces a small JSON pointer atomically. Runtime, PHP classes and
admin assets all use that version. A short maintenance guard covers schema
installation. Published versions cannot be replaced with different contents.
The only supported schema is the existing additive schema 1; releases requesting
destructive migrations or a different schema are rejected.

SiteOps verifies the reported version, homepage and admin login. If validation
fails after an update, it activates and checks the previous core. If recovery
cannot be verified, the job remains **Prüfung nötig**. No editorial database is
automatically restored. A manual **Core zurückrollen** preserves edits and media
created since the update. Older releases remain on the host for rollback.

The database snapshots contain private data and configuration; they are never
uploaded to the normal GitHub file-backup repository. SiteOps adds exclusions for
`.lorzcms`, `config` and `var`. These local snapshots need their own protected
off-host backup policy; retention and automatic pruning are not implemented.
They do not include a copy of uploaded media. A full disaster recovery needs the
database, configuration, project files and media together. SQL restore is a
separate administrator operation, not the core rollback button.

Jobs are stored in MySQL with UTC execution times. The dashboard shows execution
times in Europe/Berlin and explicitly labels the scheduling form's device time
zone. SiteOps must be running for scheduled execution; an overdue queued job runs
when the service returns. A MySQL session lock serializes deployments across
SiteOps instances. An interrupted running job is marked for inspection rather
than blindly resumed; retry keeps the original idempotency key. A job records its
expected source version and rejects a conflicting later deployment.

This first implementation deploys CMS installations via direct FTP, FTPS or
SFTP. The existing Hostinger Git mode continues to work for other SiteOps tasks,
but is not a CMS installer. Neither the release-import button nor the worker
downloads arbitrary third-party archives or executes caller-selected shell commands.

## Release and validation

Update `packages/lorzcms-core/version.json` and run `npm run cms:build`. Import the
generated `dist/lorzcms-VERSION.json` from the LorzCMS page. The bundled-release
button is an alternative for the core shipped with the current SiteOps checkout.

`npm run cms:check` checks the PHP source; `npm test` includes a real local PHP
installation/update/rollback test when PHP 8.3+ and the required extensions are
available. `SITEOPS_PHP` and `SITEOPS_PHP_INI` can select a portable test runtime.
The coordinator test uses isolated tables in the configured test MySQL database.
CI supplies both runtimes, runs database migrations, and checks persisted jobs,
delayed execution, encrypted credentials, cancellation, conflicts and recovery.
