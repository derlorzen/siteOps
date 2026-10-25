import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import * as z from 'zod/v4';
import { createDemoPolicySettings } from './video-policy-settings.mjs';
import { DEMO_POLICY_VERSION, demoPolicy } from '../runner/video-policy.mjs';

const uuid = z.uuid();
const originAllowed = (req, origin) => !req.headers.origin || req.headers.origin === origin();
const projectInput = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.string().trim().min(2).max(120).default('Bagisto'),
  language: z.enum(['en', 'de']).default('en'),
  voice_provider: z.enum(['kokoro', 'piper', 'openai']).optional(),
  voice: z.string().max(30).optional()
});
const sceneInput = z.object({
  headline: z.string().trim().max(160).default(''),
  narration: z.string().trim().min(5).max(1400),
  demoUrl: z.string().url().optional(),
  demoSteps: z
    .array(
      z.object({
        action: z.enum(['click', 'hover', 'fill', 'press', 'scroll', 'wait', 'goto']),
        selector: z.string().max(240).optional(),
        url: z.string().url().optional(),
        value: z.string().max(160).optional(),
        key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp']).optional(),
        pixels: z.number().int().min(-1400).max(1400).optional(),
        ms: z.number().int().min(100).max(4000).optional()
      })
    )
    .max(16)
    .optional()
});
const jobInput = z.object({
  project_id: uuid,
  title: z.string().trim().min(3).max(200),
  topic: z.string().trim().max(500).default(''),
  script: z.string().trim().min(30).max(18000),
  scenes: z.array(sceneInput).min(1).max(24).optional(),
  format: z.enum(['landscape', 'portrait']).default('landscape')
});
const safeJson = value => (typeof value === 'string' ? JSON.parse(value) : value);
const failure = (code, message) => {
  const e = new Error(message);
  e.statusCode = code;
  throw e;
};
const ensureUuid = value => uuid.parse(value);
const buildScenes = raw => {
  if (raw.scenes?.length) return raw.scenes;
  const blocks = raw.script
    .split(/\n\s*\n/)
    .map(s => s.trim())
    .filter(Boolean);
  if (!blocks.length || blocks.length > 24) failure(422, 'Bitte 1 bis 24 Absätze als Szenen eingeben.');
  const scenes = blocks.map((block, i) => ({ headline: i === 0 ? raw.title : 'Scene ' + (i + 1), narration: block }));
  if (scenes.some(x => x.narration.length > 1400 || x.narration.length < 5))
    failure(422, 'Jede Szene benötigt 5 bis 1400 Zeichen.');
  return scenes;
};

export function createVideoStudio({ db, runnerUrl, runnerToken, publicBaseUrl }) {
  const policySettings = createDemoPolicySettings(db);
  const sql = async (query, params = []) => (await db.query(query, params))[0];
  const listProjects = async () =>
    sql(
      'SELECT id,name,channel,language,voice_provider,voice,created_at FROM video_studio_projects ORDER BY created_at DESC'
    );
  const getProject = async id =>
    (await sql('SELECT * FROM video_studio_projects WHERE id=? LIMIT 1', [ensureUuid(id)]))[0] ||
    failure(404, 'Videoprojekt nicht gefunden.');
  const createProject = async data => {
    const x = projectInput.parse(data),
      id = crypto.randomUUID();
    const voiceProvider = x.voice_provider || (x.language === 'de' ? 'piper' : 'kokoro');
    const voices =
      voiceProvider === 'openai'
        ? [
            'alloy',
            'ash',
            'ballad',
            'coral',
            'echo',
            'fable',
            'nova',
            'onyx',
            'sage',
            'shimmer',
            'verse',
            'marin',
            'cedar'
          ]
        : voiceProvider === 'piper'
          ? ['de_DE-thorsten-medium']
          : ['am_michael', 'am_adam', 'af_heart', 'bf_emma', 'bm_george'];
    const defaultVoice =
      voiceProvider === 'openai' ? 'alloy' : voiceProvider === 'piper' ? 'de_DE-thorsten-medium' : 'am_michael';
    const voice = x.voice || defaultVoice;
    if ((x.language === 'de' && voiceProvider === 'kokoro') || (x.language === 'en' && voiceProvider === 'piper'))
      failure(422, 'Kokoro unterstützt hier Englisch, Piper Deutsch. Alternativ OpenAI wählen.');
    if (!voices.includes(voice)) failure(422, 'Die Stimme passt nicht zum gewählten Anbieter.');
    await sql('INSERT INTO video_studio_projects(id,name,channel,language,voice_provider,voice) VALUES(?,?,?,?,?,?)', [
      id,
      x.name,
      x.channel,
      x.language,
      voiceProvider,
      voice
    ]);
    return getProject(id);
  };
  const getJob = async id => {
    const row = (await sql('SELECT * FROM video_studio_jobs WHERE id=? LIMIT 1', [ensureUuid(id)]))[0];
    if (!row) failure(404, 'Videoauftrag nicht gefunden.');
    return { ...row, scenes: safeJson(row.scenes), result: row.result ? safeJson(row.result) : null };
  };
  const listJobs = async () =>
    await sql(
      'SELECT id,project_id,title,topic,status,error,runner_job_id,created_at,updated_at FROM video_studio_jobs ORDER BY created_at DESC LIMIT 100'
    );
  const createJob = async data => {
    const x = jobInput.parse(data);
    await getProject(x.project_id);
    const scenes = sceneInput.array().min(1).max(24).parse(buildScenes(x));
    const id = crypto.randomUUID();
    await sql(
      'INSERT INTO video_studio_jobs(id,project_id,title,topic,script,scenes,format,status) VALUES(?,?,?,?,?,?,?,?)',
      [id, x.project_id, x.title, x.topic, x.script, JSON.stringify(scenes), x.format, 'draft']
    );
    return getJob(id);
  };
  async function runner(path, options = {}) {
    const url = runnerUrl(),
      token = runnerToken();
    if (!url || !token) failure(503, 'Browser Runner in SiteOps Einstellungen konfigurieren.');
    if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(url))
      failure(503, 'Runner-URL muss HTTPS verwenden.');
    try {
      return await fetch(url.replace(/\/$/, '') + path, {
        ...options,
        redirect: 'error',
        headers: { ...options.headers, Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(30000)
      });
    } catch (error) {
      failure(
        error.name === 'TimeoutError' ? 504 : 503,
        error.name === 'TimeoutError'
          ? 'Browser Runner antwortet nicht rechtzeitig. Bitte später erneut versuchen.'
          : 'Browser Runner nicht erreichbar oder Weiterleitung abgelehnt. Runner-URL und HTTPS-Verbindung prüfen.'
      );
    }
  }
  const requirePolicyProtocol = async () => {
    const info = await capabilities();
    if (info.demoPolicyVersion !== DEMO_POLICY_VERSION)
      failure(409, 'Browser Runner zuerst aktualisieren: sichere Demo-Domainfreigaben benötigen Protokollversion 1.');
    return info;
  };
  const getDemoPolicy = async () => {
    let policy = null,
      settingsError = null;
    try {
      policy = await policySettings.read();
    } catch (error) {
      settingsError = error.message;
    }
    let info = null,
      runnerError = null;
    try {
      info = await capabilities();
    } catch (error) {
      runnerError = error.message;
    }
    return {
      policy,
      settingsError,
      source: settingsError ? 'invalid' : policy === null ? 'environment' : 'siteops',
      supported: info?.demoPolicyVersion === DEMO_POLICY_VERSION,
      environmentPolicy: info?.demoEnvironmentPolicy || null,
      environmentError: info?.demoEnvironmentError || null,
      runnerError
    };
  };
  const saveDemoPolicy = async value => {
    const policy = value === null ? null : demoPolicy(value);
    // Even reset must not silently downgrade to an incompatible runner.
    await requirePolicyProtocol();
    await policySettings.save(policy);
    return getDemoPolicy();
  };
  const renderJob = async id => {
    const j = await getJob(id);
    if (!['draft', 'failed'].includes(j.status)) failure(409, 'Video wurde bereits zur Produktion übergeben.');
    const project = await getProject(j.project_id);
    const policy = await policySettings.read();
    if (policy !== null) await requirePolicyProtocol();
    const response = await runner('/video/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: j.id,
        title: j.title,
        voice: project.voice,
        voiceProvider: project.voice_provider || 'kokoro',
        language: project.language,
        format: j.format,
        scenes: j.scenes,
        ...(policy !== null ? { demoPolicy: policy } : {})
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload.error === 'string' ? payload.error.slice(0, 350) : '';
      if (response.status === 422) {
        const error = Object.assign(
          new Error(
            'Renderauftrag abgelehnt (422): ' +
              detail +
              ' Bitte Szenenplan, HTTPS-Demo-URLs und Demo-Domains in Video Studio prüfen.'
          ),
          { statusCode: 422, code: 'VIDEO_RENDER_VALIDATION' }
        );
        throw error;
      }
      if ([401, 403].includes(response.status))
        failure(503, 'Browser Runner hat die Anmeldung abgelehnt. Runner-Token prüfen.');
      if (response.status === 429) failure(429, 'Video-Warteschlange ist voll. Bitte später erneut versuchen.');
      if (response.status === 409)
        failure(
          409,
          'Dieser Renderauftrag ist auf dem Runner bereits vorhanden. Status prüfen oder neuen Entwurf erstellen.'
        );
      failure(502, 'Browser Runner konnte den Auftrag nicht annehmen (HTTP ' + response.status + ').');
    }
    if (typeof payload.id !== 'string' || !uuid.safeParse(payload.id).success)
      failure(502, 'Browser Runner hat eine ungültige Auftragsbestätigung geliefert.');
    await sql('UPDATE video_studio_jobs SET status=?,runner_job_id=?,error=NULL WHERE id=?', [
      'queued',
      payload.id || j.id,
      j.id
    ]);
    return getJob(j.id);
  };
  const refreshJob = async id => {
    const j = await getJob(id);
    if (!j.runner_job_id || !['queued', 'running'].includes(j.status)) return j;
    let response;
    try {
      response = await runner('/video/jobs/' + encodeURIComponent(j.runner_job_id));
    } catch (e) {
      return { ...j, runner_warning: String(e.message || e) };
    }
    if (!response.ok) return { ...j, runner_warning: 'Runner-Status HTTP ' + response.status };
    const r = await response.json();
    if (['queued', 'running', 'done', 'failed'].includes(r.status)) {
      await sql('UPDATE video_studio_jobs SET status=?,error=?,result=? WHERE id=?', [
        r.status,
        r.error || null,
        JSON.stringify({ files: r.files || [], duration: r.duration || null }),
        j.id
      ]);
    }
    return getJob(id);
  };
  const capabilities = async () => {
    const response = await runner('/video/capabilities');
    if ([401, 403].includes(response.status))
      failure(503, 'Browser Runner hat die Anmeldung abgelehnt. Runner-Token prüfen.');
    if (!response.ok) failure(502, 'Runner unterstützt die Video-Statusabfrage noch nicht: HTTP ' + response.status);
    return response.json();
  };
  const download = async (id, kind) => {
    const j = await refreshJob(id);
    if (j.status !== 'done') failure(409, 'Video noch nicht fertig.');
    if (!['video', 'short', 'subtitles', 'thumbnail'].includes(kind)) failure(400, 'Unbekannter Dateityp.');
    const response = await runner('/video/jobs/' + encodeURIComponent(j.runner_job_id) + '/file?kind=' + kind);
    if (!response.ok) failure(502, 'Video-Datei nicht verfügbar.');
    return {
      body: Readable.fromWeb(response.body),
      type: response.headers.get('content-type') || 'application/octet-stream',
      kind
    };
  };
  return {
    listProjects,
    getProject,
    createProject,
    getJob,
    listJobs,
    createJob,
    renderJob,
    refreshJob,
    download,
    capabilities,
    getDemoPolicy,
    saveDemoPolicy,
    publicBaseUrl
  };
}
export function registerVideoStudioRoutes(app, studio, page, renderPage, origin) {
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/video-studio/') || ['GET', 'HEAD'].includes(req.method)) return;
    if (!originAllowed(req, origin)) return reply.code(403).send({ error: 'Fremde Herkunft abgelehnt.' });
    if (!String(req.headers['content-type'] || '').startsWith('application/json'))
      return reply.code(415).send({ error: 'JSON erforderlich.' });
  });
  app.get('/video-studio', async (_req, reply) => reply.type('text/html').send(page('Video Studio', renderPage())));
  app.get('/api/video-studio/capabilities', () => studio.capabilities());
  app.get('/api/video-studio/demo-policy', () => studio.getDemoPolicy());
  app.post('/api/video-studio/demo-policy', async (req, reply) => {
    if (req.headers.origin !== origin() || req.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({ error: 'Gleiche Herkunft für Domainänderungen erforderlich.' });
    if (!req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'policy'))
      return reply.code(422).send({ error: 'Ein versioniertes policy-Objekt oder null ist erforderlich.' });
    return studio.saveDemoPolicy(req.body.policy);
  });
  app.get('/api/video-studio/projects', () => studio.listProjects());
  app.post('/api/video-studio/projects', async (req, reply) =>
    reply.code(201).send(await studio.createProject(req.body))
  );
  app.get('/api/video-studio/jobs', () => studio.listJobs());
  app.post('/api/video-studio/jobs', async (req, reply) => reply.code(201).send(await studio.createJob(req.body)));
  app.get('/api/video-studio/jobs/:id', req => studio.refreshJob(req.params.id));
  app.post('/api/video-studio/jobs/:id/render', req => studio.renderJob(req.params.id));
  app.get('/api/video-studio/jobs/:id/file', async (req, reply) => {
    const kind = String(req.query.kind || 'video');
    const file = await studio.download(req.params.id, kind);
    const ext = { video: 'mp4', short: 'mp4', subtitles: 'srt', thumbnail: 'png' }[kind];
    return reply
      .type(file.type)
      .header('Content-Disposition', 'attachment; filename="siteops-video.' + ext + '"')
      .send(file.body);
  });
}
