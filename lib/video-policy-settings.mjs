import { demoPolicy } from '../runner/video-policy.mjs';

const key = 'video_demo_policy_v1';
export function createDemoPolicySettings(db) {
  return {
    read: async () => {
      const [rows] = await db.query('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', [key]);
      if (!rows.length) return null;
      try {
        return demoPolicy(JSON.parse(rows[0].setting_value));
      } catch {
        throw Object.assign(new Error('Gespeicherte Demo-Domains sind ungültig. Bitte in Video Studio korrigieren.'), {
          statusCode: 503,
          code: 'INVALID_SAVED_DEMO_POLICY'
        });
      }
    },
    save: async value => {
      // Validate before touching storage; null explicitly restores environment fallback.
      const policy = value === null ? null : demoPolicy(value);
      if (policy === null) await db.query('DELETE FROM app_settings WHERE setting_key=?', [key]);
      else
        await db.query(
          'INSERT INTO app_settings(setting_key,setting_value,encrypted) VALUES(?,?,0) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),encrypted=0,updated_at=NOW()',
          [key, JSON.stringify(policy)]
        );
      return policy;
    }
  };
}
