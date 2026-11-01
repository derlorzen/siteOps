import crypto from 'node:crypto';
import { redact } from './capability-registry.mjs';

const canonical = value =>
  JSON.stringify(value, (_key, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(
          Object.keys(val)
            .sort()
            .map(key => [key, val[key]])
        )
      : val
  );
const digest = value => crypto.createHash('sha256').update(canonical(value)).digest('hex');
const owner = actor => `${actor.subject || actor.type}\n${actor.clientId || ''}`;
const fail = (statusCode, publicCode) => {
  throw Object.assign(new Error(publicCode), { statusCode, publicCode });
};

export function createActionApprovals({ db, encrypt, decrypt, now = () => Date.now() }) {
  async function prepare({ tool, args, actor, state }) {
    const id = crypto.randomUUID();
    const expires = new Date(now() + 10 * 60 * 1000);
    await db.query(
      'INSERT INTO action_approvals(id,actor_key,tool_name,arguments_enc,arguments_hash,state_hash,expires_at,actor_subject) VALUES(?,?,?,?,?,?,?,?)',
      [
        id,
        digest(owner(actor)),
        tool,
        encrypt(args),
        digest(args),
        digest(state),
        expires.toISOString().slice(0, 23).replace('T', ' '),
        actor.subject
      ]
    );
    return {
      id,
      tool,
      arguments: redact(args),
      status: 'pending',
      expires_at: expires.toISOString(),
      approval_url: '/mcp-info#approvals',
      effect:
        tool === 'invoice_reset_to_draft' || tool.endsWith('/reset-draft')
          ? 'Die unbezahlte Originalrechnung wird storniert und bleibt archiviert. Ein eigener Stornobeleg und ein bearbeitbarer Folgeentwurf werden angelegt. Beim Ausstellen erhält der Folgeentwurf eine neue Rechnungsnummer.'
          : 'Die angegebenen Parameter werden nach Freigabe an den bestehenden fachlichen Service übergeben. Externe Änderungen können nicht immer rückgängig gemacht werden.',
      next_action:
        'Öffne die Freigabe in SiteOps, prüfe das Ziel und bestätige dort. Rufe anschließend dasselbe Tool mit approval_id auf.'
    };
  }
  async function pending(actor) {
    if (actor?.type !== 'dashboard_session') fail(403, 'DASHBOARD_APPROVAL_REQUIRED');
    const [items] = await db.query(
      "SELECT id,tool_name,arguments_enc,status,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%sZ') expires_at,created_at FROM action_approvals WHERE actor_subject=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3) ORDER BY created_at DESC LIMIT 50",
      [actor.subject]
    );
    return items.map(({ arguments_enc, ...row }) => ({ ...row, arguments: redact(decrypt(arguments_enc)) }));
  }
  async function approve(id, actor) {
    if (actor?.type !== 'dashboard_session') fail(403, 'DASHBOARD_APPROVAL_REQUIRED');
    const [result] = await db.query(
      "UPDATE action_approvals SET status='approved',approved_by=?,approved_at=UTC_TIMESTAMP() WHERE id=? AND actor_subject=? AND status='pending' AND expires_at>UTC_TIMESTAMP(3)",
      [actor.subject, id, actor.subject]
    );
    if (result.affectedRows !== 1) fail(409, 'APPROVAL_EXPIRED_OR_USED');
    return { id, status: 'approved', message: 'Freigegeben. Die Aktion wurde noch nicht ausgeführt.' };
  }
  async function consume({ id, tool, args, actor, state }) {
    if (!id) fail(403, 'APPROVAL_REQUIRED');
    // Compare-and-set consumes once before the provider runs. A failure requires a fresh
    // preview: retrying an ambiguous external operation must never execute it twice.
    const [result] = await db.query(
      "UPDATE action_approvals SET status='consumed',consumed_at=UTC_TIMESTAMP() WHERE id=? AND actor_key=? AND tool_name=? AND arguments_hash=? AND state_hash=? AND status='approved' AND expires_at>UTC_TIMESTAMP(3)",
      [id, digest(owner(actor)), tool, digest(args), digest(state)]
    );
    if (result.affectedRows !== 1) fail(409, 'APPROVAL_EXPIRED_USED_OR_CHANGED');
    return { id };
  }
  async function status(id, actor) {
    const [rows] = await db.query(
      "SELECT id,tool_name,status,DATE_FORMAT(expires_at,'%Y-%m-%dT%H:%i:%sZ') expires_at,consumed_at FROM action_approvals WHERE id=? AND actor_key=?",
      [id, digest(owner(actor))]
    );
    if (!rows[0]) fail(404, 'NOT_FOUND');
    return {
      ...rows[0],
      status: new Date(rows[0].expires_at).getTime() <= now() && !rows[0].consumed_at ? 'expired' : rows[0].status
    };
  }
  return { prepare, pending, approve, consume, status };
}
