import crypto from 'node:crypto';
import { validateDemoLogin } from '../runner/video-login.mjs';

const fail = (statusCode, message) => {
  throw Object.assign(Error(message), { statusCode });
};
export function createDemoLogins({ db, encrypt, decrypt }) {
  const read = async () => {
    const [rows] = await db.query('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', [
      'video_demo_logins'
    ]);
    return rows.length ? decrypt(rows[0].setting_value) : [];
  };
  const list = async () =>
    (await read()).map(({ password, ...profile }) => ({ ...profile, password_configured: Boolean(password) }));
  const get = async id => (await read()).find(x => x.id === id) || fail(422, 'Demo-Loginprofil nicht gefunden.');
  const save = async raw => {
    if (!encrypt || !decrypt) fail(503, 'Verschlüsselte Speicherung ist nicht verfügbar.');
    const profiles = await read(),
      previous = profiles.find(x => x.id === raw?.id);
    const id = previous?.id || crypto.randomUUID();
    if (raw?.id && !previous) fail(404, 'Demo-Loginprofil nicht gefunden.');
    if (!previous && profiles.length >= 10) fail(422, 'Maximal zehn Demo-Konten möglich.');
    if (typeof raw?.name !== 'string' || raw.name.trim().length < 2 || raw.name.length > 100)
      fail(422, 'Profilname erforderlich (2–100 Zeichen).');
    if (previous && !raw.password && (raw.login_url !== previous.login_url || raw.username !== previous.username))
      fail(422, 'Nach Änderung von Login-URL oder Benutzername das Passwort erneut eingeben.');
    let profile;
    try {
      const host = new URL(raw.login_url).hostname;
      profile = {
        ...validateDemoLogin({ ...raw, id, password: raw.password || previous?.password }, [host]),
        name: raw.name.trim()
      };
    } catch (error) {
      fail(422, error.message);
    }
    const next = [...profiles.filter(x => x.id !== id), profile];
    await db.query(
      'INSERT INTO app_settings(setting_key,setting_value,encrypted) VALUES(?,?,1) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),encrypted=1,updated_at=NOW()',
      ['video_demo_logins', encrypt(next)]
    );
    return { saved: true, id };
  };
  return { list, get, save };
}
