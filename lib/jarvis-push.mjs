import { createHash } from 'node:crypto';
import webPush from 'web-push';
import { z } from 'zod';

const supportedPushHosts = new Set([
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
  'wns.windows.com'
]);
const endpointSchema = z
  .url()
  .max(2048)
  .refine(value => {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      supportedPushHosts.has(url.hostname) &&
      !url.port &&
      !url.username &&
      !url.password &&
      !url.hash &&
      url.pathname.length > 1
    );
  });
const subscriptions = z.strictObject({
  endpoint: endpointSchema,
  expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/)
  })
});
const remove = z.strictObject({ endpoint: endpointSchema });
const digest = endpoint => createHash('sha256').update(endpoint).digest('hex');

export function registerJarvisPush(app, { env, q, ownerOf, limited }) {
  const publicKey = env.JARVIS_VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.JARVIS_VAPID_PRIVATE_KEY?.trim();
  const subject = env.JARVIS_VAPID_SUBJECT?.trim();
  let details;
  if (publicKey && privateKey && subject) {
    try {
      webPush.generateRequestDetails({ endpoint: 'https://fcm.googleapis.com/fcm/send/validate' }, null, {
        vapidDetails: { publicKey, privateKey, subject }
      });
      details = { publicKey, privateKey, subject };
    } catch {
      app.log.warn('Invalid Jarvis Web Push configuration');
    }
  }

  app.post('/api/jarvis/push', limited, async (req, reply) => {
    if (!details) return reply.code(503).send({ message: 'Web Push ist für Jarvis noch nicht eingerichtet.' });
    const subscription = subscriptions.parse(req.body);
    const hash = digest(subscription.endpoint);
    await q(
      'INSERT INTO jarvis_push_subscriptions (owner_key, endpoint_hash, subscription_json) VALUES (?,?,?) ON DUPLICATE KEY UPDATE subscription_json=VALUES(subscription_json), updated_at=CURRENT_TIMESTAMP(3)',
      [ownerOf(req), hash, JSON.stringify(subscription)]
    );
    return { subscribed: true };
  });
  app.post('/api/jarvis/push/remove', limited, async req => {
    const { endpoint } = remove.parse(req.body);
    await q('DELETE FROM jarvis_push_subscriptions WHERE owner_key=? AND endpoint_hash=?', [
      ownerOf(req),
      digest(endpoint)
    ]);
    return { subscribed: false };
  });

  async function notify(owner, chatId) {
    if (!details) return;
    const { rows } = await q(
      'SELECT endpoint_hash, subscription_json FROM jarvis_push_subscriptions WHERE owner_key=? ORDER BY updated_at DESC LIMIT 12',
      [owner]
    );
    await Promise.allSettled(
      rows.map(async row => {
        const raw = row.subscription_json;
        const subscription = subscriptions.parse(typeof raw === 'string' ? JSON.parse(raw) : raw);
        try {
          await webPush.sendNotification(subscription, JSON.stringify({ chatId }), {
            vapidDetails: details,
            TTL: 3600,
            timeout: 5000
          });
        } catch (error) {
          if ([404, 410].includes(error.statusCode)) {
            await q('DELETE FROM jarvis_push_subscriptions WHERE owner_key=? AND endpoint_hash=?', [
              owner,
              row.endpoint_hash
            ]);
          }
        }
      })
    );
  }
  return { notify, publicKey: details?.publicKey };
}
