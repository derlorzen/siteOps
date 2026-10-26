import * as z from 'zod/v4';

export const DEFAULT_ACCENT = '#2465E8';
const accentSchema = z
  .object({
    accent: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Farbe muss als #RRGGBB angegeben werden.')
  })
  .strict();

export function createThemeService({ q, storeSetting }) {
  async function get() {
    const result = await q('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', ['ui_accent_color']);
    const stored = result.rows?.[0]?.setting_value;
    const color = accentSchema.safeParse({ accent: stored });
    return { accent: color.success ? color.data.accent.toUpperCase() : DEFAULT_ACCENT };
  }

  async function save(raw) {
    const result = accentSchema.safeParse(raw);
    if (!result.success) {
      const error = new Error('Ungültige Akzentfarbe. Bitte einen HEX-Wert wie #0F766E eingeben.');
      error.statusCode = 400;
      throw error;
    }
    const accent = result.data.accent.toUpperCase();
    await storeSetting('ui_accent_color', accent);
    return { accent };
  }

  return { get, save };
}

export function registerThemeRoutes(app, service, allowedOrigin) {
  app.get('/api/ui-theme', async () => service.get());
  app.put('/api/ui-theme', async (request, reply) => {
    if (
      !String(request.headers['content-type'] || '')
        .toLowerCase()
        .startsWith('application/json')
    )
      return reply.code(415).send({ error: 'JSON erforderlich.' });
    const origin = request.headers.origin;
    if (origin && origin !== allowedOrigin()) return reply.code(403).send({ error: 'Fremde Herkunft abgelehnt.' });
    const fetchSite = request.headers['sec-fetch-site'];
    if (fetchSite && !['same-origin', 'none'].includes(fetchSite))
      return reply.code(403).send({ error: 'Fremde Herkunft abgelehnt.' });
    return service.save(request.body);
  });
}
