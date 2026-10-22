import crypto from 'node:crypto';
import { posix } from 'node:path';
import * as z from 'zod/v4';

export const deletionPlanSchema = z.object({
  site: z.string().min(1),
  deleteFolder: z.boolean(),
  deleteDomain: z.boolean(),
  accountId: z.uuid().optional()
});
export const deletionConfirmSchema = z.object({
  token: z.string().min(1),
  confirmation: z.string().min(1)
});
function deletionError(message, statusCode = 409) {
  return Object.assign(new Error(message), { statusCode });
}
function parseInput(schema, raw) {
  const result = schema.safeParse(raw);
  if (!result.success) throw deletionError('Ungültige Löschanfrage. Umfang und Bestätigung prüfen.', 400);
  return result.data;
}
export function safeDeletionRoot(raw) {
  if (
    typeof raw !== 'string' ||
    !raw.startsWith('/') ||
    raw.includes('\\') ||
    raw.includes('\0') ||
    raw.split('/').some(p => p === '..' || p === '.')
  )
    throw deletionError('Unsicheres Website-Verzeichnis.');
  const root = posix.normalize(raw).replace(/\/$/, '');
  if (!root || root === '/' || root.split('/').filter(Boolean).length < 1)
    throw deletionError('Serverwurzel darf nicht gelöscht werden.');
  return root;
}
export function createSiteDeletion({ db, getSite, listSites, connectSite, allInklService, now = Date.now }) {
  const pending = new Map();
  const fingerprint = target => JSON.stringify(target);
  async function validate(input) {
    const site = await getSite(input.site);
    let root = null,
      domain = null;
    const sites = await listSites();
    if (input.deleteFolder) {
      if ((site.deployment_mode || 'webspace') !== 'webspace')
        throw deletionError('FTP-Löschung nur bei Webspace-Websites möglich.');
      root = safeDeletionRoot(site.remote_root);
      for (const other of sites) {
        if (other.id === site.id || other.host !== site.host || other.username !== site.username) continue;
        const path = posix.normalize(other.remote_root || '/').replace(/\/$/, '') || '/';
        // Deleting a child leaves its parent intact; only sites inside the target are at risk.
        if (path === root || path.startsWith(root + '/'))
          throw deletionError('Verzeichnis überschneidet sich mit einer anderen Website: ' + other.name);
      }
    }
    if (input.deleteDomain) {
      if (!input.accountId) throw deletionError('ALL-INKL-Konto auswählen.');
      const hostname = new URL(site.domain.includes('://') ? site.domain : 'https://' + site.domain).hostname;
      if (
        sites.some(
          other => other.id !== site.id && (other.domain === site.domain || other.domain.endsWith('.' + hostname))
        )
      )
        throw deletionError('Domain wird von weiteren Websites verwendet.');
      domain = await allInklService.deletionTarget(input.accountId, hostname, site);
    }
    return { site, root, domain };
  }
  return {
    async preview(raw) {
      const input = parseInput(deletionPlanSchema, raw);
      const target = await validate(input);
      for (const [key, plan] of pending) if (plan.expires <= now()) pending.delete(key);
      if (pending.size >= 1000) throw deletionError('Zu viele offene Löschvorschauen.');
      const token = crypto.randomUUID();
      pending.set(token, { input, fingerprint: fingerprint(target), expires: now() + 600000 });
      return {
        token,
        confirmation: target.site.slug,
        site: target.site.name,
        deleteEntry: true,
        folder: target.root,
        domain: target.domain,
        expiresInSeconds: 600,
        warning:
          'Eintrag und zugehörige SiteOps-Verläufe werden entfernt. Ausgewählte FTP-Dateien und KAS-Domain werden unwiderruflich gelöscht. KAS-Löschung ist keine Kündigung der Domainregistrierung.',
        question:
          'Soll nur der SiteOps-Eintrag oder zusätzlich der ausgewählte FTP-Ordner und/oder die ALL-INKL-Domain gelöscht werden? Umfang ausdrücklich bestätigen; bei Änderungen neue Vorschau erstellen.'
      };
    },
    async confirm(raw) {
      const { token, confirmation } = parseInput(deletionConfirmSchema, raw);
      const plan = pending.get(token);
      if (!plan || plan.expires <= now()) throw deletionError('Löschvorschau abgelaufen oder bereits verwendet.');
      pending.delete(token); // Claim before asynchronous checks to prevent concurrent execution.
      const target = await validate(plan.input);
      if (confirmation !== target.site.slug || fingerprint(target) !== plan.fingerprint)
        throw deletionError('Bestätigung passt nicht oder Website wurde geändert. Neue Vorschau erforderlich.');
      const completed = [];
      try {
        if (target.root) {
          const remote = await connectSite(target.site);
          try {
            await remote.removeDirectory(target.root);
            completed.push('folder');
          } finally {
            await remote.close();
          }
        }
        if (target.domain) {
          await allInklService.deleteTarget(target.domain);
          completed.push('domain');
        }
        await db.query('DELETE FROM sites WHERE id=?', [target.site.id]);
        return { ok: true, deleted: [...completed, 'entry'] };
      } catch (error) {
        return {
          ok: false,
          completed,
          entryRetained: true,
          error: error.message,
          message:
            'Löschung unvollständig. Bereits gelöschte Ressourcen bleiben gelöscht. Zustand prüfen und neue Vorschau erstellen.'
        };
      }
    }
  };
}
