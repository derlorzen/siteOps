import crypto from 'node:crypto';
import { createVideoIntros } from './video-intros.mjs';
import { validateOutroScenes } from '../runner/video-outro.mjs';
import { createVideoPublication } from './video-publication.mjs';
import { Readable } from 'node:stream';
import * as z from 'zod/v4';
import { videoSuiteOpenAIConfiguration } from './video-suite-config.mjs';
import { createDemoLogins } from './video-demo-logins.mjs';
import { createDemoPolicySettings } from './video-policy-settings.mjs';
import { DEMO_POLICY_VERSION, demoPolicy } from '../runner/video-policy.mjs';
import { capturePlan, requireCapturePlan } from '../runner/video-capture.mjs';
import { validatedDemoSteps, validatedDemoUrl } from '../runner/video-demo.mjs';
import {
  projectChangesSchema,
  projectSettings,
  sceneSchema,
  videoJobSchema,
  metadataSchema,
  templateSchema,
  defaultVideoMetadata,
  parseVideoInput,
  voices
} from './video-production.mjs';
import { createVideoDownloadTickets } from './video-downloads.mjs';

const uuid = z.uuid();
const originAllowed = (req, origin) => !req.headers.origin || req.headers.origin === origin();
const safeJson = value => (typeof value === 'string' ? JSON.parse(value) : value);
const failure = (code, message) => {
  const e = new Error(message);
  e.statusCode = code;
  throw e;
};
const ensureUuid = value => parseVideoInput(uuid, value);
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

export function createVideoStudio({ db, runnerUrl, runnerToken, publicBaseUrl, downloadKey, encrypt, decrypt }) {
  const policySettings = createDemoPolicySettings(db);
  const demoLogins = createDemoLogins({ db, encrypt, decrypt });
  const tickets = downloadKey ? createVideoDownloadTickets(downloadKey) : null;
  const sql = async (query, params = []) => (await db.query(query, params))[0];
  const listProjects = async () =>
    sql(
      'SELECT id,name,channel,language,voice_provider,voice,created_at FROM video_studio_projects ORDER BY created_at DESC'
    );
  const getProject = async id =>
    (await sql('SELECT * FROM video_studio_projects WHERE id=? LIMIT 1', [ensureUuid(id)]))[0] ||
    failure(404, 'Videoprojekt nicht gefunden.');
  const createProject = async data => {
    const x = projectSettings(data),
      id = crypto.randomUUID(),
      voiceProvider = x.voice_provider,
      voice = x.voice;
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
  const updateProject = async (id, changes) => {
    const existing = await getProject(id);
    const update = parseVideoInput(projectChangesSchema, changes);
    if (!Object.keys(update).length) failure(422, 'Mindestens eine Projekteinstellung ändern.');
    const merged = { ...existing, ...update };
    if (update.language && update.language !== existing.language && !update.voice_provider) {
      delete merged.voice_provider;
      delete merged.voice;
    } else if (update.voice_provider && update.voice_provider !== existing.voice_provider && !update.voice)
      delete merged.voice;
    const x = projectSettings(merged);
    await sql('UPDATE video_studio_projects SET name=?,channel=?,language=?,voice_provider=?,voice=? WHERE id=?', [
      x.name,
      x.channel,
      x.language,
      x.voice_provider,
      x.voice,
      id
    ]);
    return getProject(id);
  };
  const listDemoTemplates = async () =>
    (await sql('SELECT * FROM video_studio_demo_templates ORDER BY name')).map(x => ({
      ...x,
      scene: safeJson(x.scene)
    }));
  const getDemoTemplate = async id => {
    const row = (await sql('SELECT * FROM video_studio_demo_templates WHERE id=? LIMIT 1', [ensureUuid(id)]))[0];
    if (!row) failure(404, 'Demoszene nicht gefunden.');
    return { ...row, scene: safeJson(row.scene) };
  };
  const validateDemoScenes = async scenes => {
    const state = await getDemoPolicy();
    const effective =
      state.source === 'siteops' ? state.policy : state.source === 'environment' ? state.environmentPolicy : null;
    if (!state.supported || !effective)
      failure(409, 'Demo-Domainfreigaben auf dem Runner zuerst konfigurieren oder Runner aktualisieren.');
    for (const scene of scenes.filter(s => s.demoUrl)) {
      if (scene.test_data_only !== true)
        failure(422, 'Browser-Demos benötigen test_data_only=true: ausschließlich Testkonten und Testdaten verwenden.');
      if (scene.login_profile_id) {
        const profile = await demoLogins.get(scene.login_profile_id);
        if (new URL(profile.login_url).origin !== new URL(scene.demoUrl).origin)
          failure(422, 'Demo-Szene und Loginprofil müssen dieselbe Herkunft verwenden.');
      }
      try {
        validatedDemoUrl(scene.demoUrl, effective.hosts);
        validatedDemoSteps(scene.demoSteps || [], scene.demoUrl, effective.hosts);
      } catch (error) {
        failure(422, error.message);
      }
    }
  };
  const saveDemoTemplate = async (data, id) => {
    const x = parseVideoInput(templateSchema, data);
    await validateDemoScenes([x.scene]);
    if (id) {
      await getDemoTemplate(id);
      await sql('UPDATE video_studio_demo_templates SET name=?,language=?,scene=? WHERE id=?', [
        x.name,
        x.language,
        JSON.stringify(x.scene),
        id
      ]);
    } else {
      id = crypto.randomUUID();
      await sql('INSERT INTO video_studio_demo_templates(id,name,language,scene) VALUES(?,?,?,?)', [
        id,
        x.name,
        x.language,
        JSON.stringify(x.scene)
      ]);
    }
    return getDemoTemplate(id);
  };
  const updateMetadata = async (id, input) => {
    await getJob(id);
    const metadata = parseVideoInput(metadataSchema, input);
    await sql('UPDATE video_studio_jobs SET youtube_metadata=? WHERE id=?', [JSON.stringify(metadata), id]);
    return getJob(id);
  };
  const downloads = async id => {
    const job = await refreshJob(id);
    if (job.status !== 'done') failure(409, 'Video noch nicht fertig. Status zuerst abfragen.');
    const base = new URL(publicBaseUrl());
    if (base.protocol !== 'https:') failure(503, 'Downloads benötigen eine öffentliche HTTPS-Adresse.');
    return {
      id,
      status: job.status,
      metadata: job.youtube,
      expires_in_seconds: tickets ? 300 : null,
      files: [
        ...(job.result?.files || []).filter(kind => ['video', 'short', 'subtitles', 'thumbnail'].includes(kind)),
        ...(job.youtube ? ['metadata'] : [])
      ].map(kind => ({
        kind,
        url:
          base.origin +
          (tickets
            ? '/video-studio/download/' + tickets.issue(id, kind)
            : '/api/video-studio/jobs/' + id + '/file?kind=' + kind),
        authentication: tickets ? 'signed capability, valid for 5 minutes' : 'SiteOps dashboard session required'
      }))
    };
  };
  const ticketDownload = async token => {
    if (!tickets) failure(503, 'Downloadfreigaben nicht konfiguriert.');
    const { id, kind } = tickets.verify(token);
    return download(id, kind);
  };
  const artifactResponse = async (id, kind, { method = 'GET', start, end } = {}) => {
    const job = await refreshJob(id);
    if (job.status !== 'done' || !['video', 'short', 'subtitles', 'thumbnail'].includes(kind))
      failure(409, 'Videodatei nicht verfügbar.');
    return runner('/video/jobs/' + encodeURIComponent(job.runner_job_id) + '/file?kind=' + kind, {
      method,
      headers: start === undefined ? {} : { Range: 'bytes=' + start + '-' + end }
    });
  };
  const getJob = async id => {
    const row = (await sql('SELECT * FROM video_studio_jobs WHERE id=? LIMIT 1', [ensureUuid(id)]))[0];
    if (!row) failure(404, 'Videoauftrag nicht gefunden.');
    return {
      ...row,
      scenes: safeJson(row.scenes),
      result: row.result ? safeJson(row.result) : null,
      render_settings: row.render_settings ? safeJson(row.render_settings) : null,
      youtube: row.youtube_metadata ? safeJson(row.youtube_metadata) : null
    };
  };
  const listJobs = async (projectId, { limit = 100, offset = 0, deleted = false } = {}) => {
    if (projectId) await getProject(projectId);
    return sql(
      'SELECT id,project_id,title,topic,status,error,runner_job_id,created_at,updated_at,deleted_at FROM video_studio_jobs' +
        ' WHERE deleted_at IS ' +
        (deleted ? 'NOT NULL' : 'NULL') +
        (projectId ? ' AND project_id=?' : '') +
        ' ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [
        ...(projectId ? [projectId] : []),
        z.number().int().min(1).max(100).parse(limit),
        z.number().int().min(0).max(100000).parse(offset)
      ]
    );
  };
  const trashJob = async id => {
    await getJob(id);
    await sql('UPDATE video_studio_jobs SET deleted_at=COALESCE(deleted_at,NOW(3)) WHERE id=?', [id]);
    return { deleted: true, id };
  };
  const restoreJob = async id => {
    await getJob(id);
    await sql('UPDATE video_studio_jobs SET deleted_at=NULL WHERE id=?', [id]);
    return { restored: true, id };
  };
  const createJob = async data => {
    const x = parseVideoInput(videoJobSchema, data);
    const project = await getProject(x.project_id);
    const expanded = await Promise.all(
      buildScenes(x).map(async scene => {
        if (!scene.template_id) return scene;
        const template = await getDemoTemplate(scene.template_id);
        if (template.language !== project.language)
          failure(422, 'Demoszene und Projekt müssen dieselbe Sprache verwenden.');
        return {
          ...scene,
          ...template.scene,
          capture_mode: scene.capture_mode || template.scene.capture_mode,
          narration: scene.narration,
          headline: scene.headline || template.scene.headline,
          visual_directions: scene.visual_directions || template.scene.visual_directions
        };
      })
    );
    const scenes = sceneSchema.array().min(1).max(24).parse(expanded);
    validateOutroScenes(scenes);
    if (scenes.some(s => s.demoUrl)) await validateDemoScenes(scenes);
    const selectedIntro = x.intro_id ? await intros.get(x.intro_id, x.project_id) : null;
    if (selectedIntro && selectedIntro.status !== 'ready') failure(409, 'Intro zuerst vollständig hochladen.');
    const metadata = x.youtube || defaultVideoMetadata(x, project, scenes);
    const website = scenes.at(-1)?.outro?.website;
    if (website && !metadata.description.includes(website)) metadata.description += '\n\n' + website;
    parseVideoInput(metadataSchema, metadata);
    const id = crypto.randomUUID();
    await sql(
      'INSERT INTO video_studio_jobs(id,project_id,title,topic,script,scenes,format,status,render_settings,youtube_metadata) VALUES(?,?,?,?,?,?,?,?,?,?)',
      [
        id,
        x.project_id,
        x.title,
        x.topic,
        x.script,
        JSON.stringify(scenes),
        x.format,
        'draft',
        JSON.stringify({
          language: project.language,
          voice_provider: project.voice_provider,
          voice: project.voice,
          ...(selectedIntro
            ? { intro: { id: selectedIntro.id, name: selectedIntro.name, ...selectedIntro.metadata } }
            : {})
        }),
        JSON.stringify(metadata)
      ]
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
        signal: AbortSignal.timeout(
          ['/video/demo-login/test', '/video/openai-audio-test', '/video/capture-test'].includes(path) ||
            /^\/video\/intros\/[^/]+\/complete$/.test(path)
            ? 100000
            : 30000
        )
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
  const testCapture = async raw => {
    const input = parseVideoInput(
      z
        .object({
          project_id: z.uuid(),
          scene: sceneSchema,
          format: z.enum(['landscape', 'portrait']).default('landscape')
        })
        .strict(),
      raw
    );
    const project = await getProject(input.project_id);
    let scene = input.scene;
    if (scene.template_id) {
      const template = await getDemoTemplate(scene.template_id);
      if (template.language !== project.language)
        failure(422, 'Demoszene und Projekt müssen dieselbe Sprache verwenden.');
      scene = { ...scene, ...template.scene, capture_mode: scene.capture_mode || template.scene.capture_mode };
    }
    const [plan] = capturePlan([scene]);
    if (!plan.ok) return { ok: false, ...plan, checked_at: new Date().toISOString(), message: plan.issues.join(' ') };
    if (plan.mode === 'text')
      return {
        ok: true,
        ...plan,
        checked_at: new Date().toISOString(),
        message: 'Texttafel: keine Bildschirmaufnahme geplant.'
      };
    await validateDemoScenes([scene]);
    const info = await capabilities();
    if (info.capturePreflightVersion !== 1) failure(409, 'Aufnahmeprüfung benötigt Browser Runner ab Version 1.2.0.');
    const saved = await policySettings.read();
    const profile = scene.login_profile_id ? await demoLogins.get(scene.login_profile_id) : undefined;
    const response = await runner('/video/capture-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scene,
        format: input.format,
        demoPolicy: saved === null ? info.demoEnvironmentPolicy : saved,
        ...(profile ? { profile } : {})
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) failure(response.status === 422 ? 422 : 502, result.error || 'Aufnahmeprüfung fehlgeschlagen.');
    return { ...result, mode: plan.mode, checked_at: new Date().toISOString() };
  };
  const renderJob = async id => {
    const j = await getJob(id);
    if (j.deleted_at) failure(409, 'Produktion zuerst aus dem Papierkorb wiederherstellen.');
    if (!['draft', 'failed'].includes(j.status)) failure(409, 'Video wurde bereits zur Produktion übergeben.');
    const logins = [];
    for (const id of new Set(j.scenes.map(s => s.login_profile_id).filter(Boolean)))
      logins.push(await demoLogins.get(id));
    validateOutroScenes(j.scenes);
    if (j.scenes.some(s => s.outro) && (await capabilities()).outroVersion !== 1)
      failure(409, 'Für das gestaltete Outro den Browser Runner auf mindestens 1.3.0 aktualisieren.');
    const plan = requireCapturePlan(j.scenes);
    if (plan.some(s => s.mode !== 'text') && (await capabilities()).capturePreflightVersion !== 1)
      failure(409, 'Für geprüfte Bildschirmaufnahmen den Browser Runner auf mindestens 1.2.0 aktualisieren.');
    if (j.scenes.some(s => s.demoUrl)) await validateDemoScenes(j.scenes);
    if (logins.length && (await capabilities()).demoLoginVersion !== 1)
      failure(409, 'Browser Runner zuerst aktualisieren: Anmeldung vor der Aufnahme benötigt Demo-Login-Protokoll 1.');
    const project = j.render_settings || (await getProject(j.project_id));
    if (project.intro && (await capabilities()).introVersion !== 1)
      failure(409, 'Für das vorgeschaltete Intro den Browser Runner auf mindestens 1.4.0 aktualisieren.');
    const policy = await policySettings.read();
    if (policy !== null) await requirePolicyProtocol();
    const credential = project.voice_provider === 'openai' ? await narrationCredential() : null;
    const renderId = j.status === 'failed' ? crypto.randomUUID() : j.id;
    const response = await runner('/video/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: renderId,
        title: j.title,
        voice: project.voice,
        voiceProvider: project.voice_provider || 'kokoro',
        language: project.language,
        format: j.format,
        scenes: j.scenes,
        ...(project.intro ? { introId: project.intro.id } : {}),
        ...(credential?.apiKey ? { openaiApiKey: credential.apiKey } : {}),
        ...(logins.length ? { demoLogins: logins } : {}),
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
        JSON.stringify({
          files: r.files || [],
          duration: r.duration || null,
          resolution: r.resolution || null,
          captures: r.captures || [],
          outro: r.outro || null,
          intro: r.intro || null
        }),
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
    const info = await response.json();
    const config = await videoSuiteOpenAIConfiguration({ db, decrypt });
    const shared = Boolean(config.api_key && info.openaiKeyForwardingVersion === 1);
    return {
      ...info,
      connected: true,
      voices,
      openaiNarration: {
        ready: shared || Boolean(info.openaiConfigured),
        source: shared ? 'suite' : info.openaiConfigured ? 'runner' : 'missing',
        suiteKeyConfigured: Boolean(config.api_key),
        requiresRunnerUpdate: Boolean(config.api_key && !shared && !info.openaiConfigured),
        model: 'gpt-audio-1.5'
      }
    };
  };
  const narrationCredential = async () => {
    const config = await videoSuiteOpenAIConfiguration({ db, decrypt });
    const info = await capabilities();
    if (config.api_key && info.openaiKeyForwardingVersion === 1) return { apiKey: config.api_key };
    if (info.openaiConfigured) return {};
    if (config.api_key)
      failure(
        409,
        'Der Suite-Schlüssel ist gespeichert, aber dieser Runner kann ihn noch nicht pro Auftrag übernehmen. Runner auf mindestens 1.1.1 aktualisieren oder OPENAI_API_KEY dort hinterlegen. Der Responses-Test prüft keine Sprachausgabe.'
      );
    failure(
      409,
      'OpenAI-Schlüssel unter Video Suite → Einstellungen speichern oder OPENAI_API_KEY auf dem Runner setzen.'
    );
  };
  const testOpenAINarration = async () => {
    const credential = await narrationCredential();
    const info = await capabilities();
    if (info.openaiKeyForwardingVersion !== 1)
      failure(409, 'Für den separaten Audio-Test Runner auf mindestens 1.1.1 aktualisieren.');
    const response = await runner('/video/openai-audio-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...(credential.apiKey ? { apiKey: credential.apiKey } : {}) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      failure(response.status === 422 ? 422 : 502, result.error || 'OpenAI-Sprachausgabe fehlgeschlagen.');
    return {
      ok: true,
      model: result.model,
      message: 'OpenAI-Sprachausgabe über den Browser Runner erfolgreich geprüft (gpt-audio-1.5).'
    };
  };
  const testDemoLogin = async id => {
    const profile = await demoLogins.get(id);
    const info = await capabilities();
    if (info.demoLoginVersion !== 1) failure(409, 'Browser Runner zuerst aktualisieren: Demo-Login-Protokoll 1 fehlt.');
    const stored = await policySettings.read();
    const policy = stored === null ? info.demoEnvironmentPolicy : stored;
    if (!policy) failure(409, 'Demo-Domains zuerst freigeben.');
    try {
      validatedDemoUrl(profile.login_url, policy.hosts);
      validatedDemoUrl(profile.landing_url, policy.hosts);
    } catch {
      failure(422, 'Login-Domain zuerst unter Demo-Domains freigeben.');
    }
    const response = await runner('/video/demo-login/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile, demoPolicy: policy })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) failure(response.status === 422 ? 422 : 502, result.error || 'Demo-Anmeldung fehlgeschlagen.');
    return {
      ok: true,
      message: 'Demo-Anmeldung und geschützte Zielseite erfolgreich geprüft. Login wird vor der Aufnahme ausgeführt.'
    };
  };
  const download = async (id, kind) => {
    const j = await refreshJob(id);
    if (j.status !== 'done') failure(409, 'Video noch nicht fertig.');
    if (kind === 'metadata') return { body: JSON.stringify(j.youtube, null, 2), type: 'application/json', kind };
    if (!['video', 'short', 'subtitles', 'thumbnail'].includes(kind)) failure(400, 'Unbekannter Dateityp.');
    const response = await runner('/video/jobs/' + encodeURIComponent(j.runner_job_id) + '/file?kind=' + kind);
    if (!response.ok) failure(502, 'Video-Datei nicht verfügbar.');
    return {
      body: Readable.fromWeb(response.body),
      type: response.headers.get('content-type') || 'application/octet-stream',
      kind
    };
  };
  const intros = createVideoIntros({ db, getProject, runner, capabilities });
  const publication = createVideoPublication({ db, getJob, updateMetadata });
  return {
    publication,
    intros,
    testCapture,
    testOpenAINarration,
    listDemoLogins: demoLogins.list,
    saveDemoLogin: demoLogins.save,
    testDemoLogin,
    listProjects,
    getProject,
    createProject,
    getJob,
    listJobs,
    trashJob,
    restoreJob,
    createJob,
    renderJob,
    refreshJob,
    download,
    capabilities,
    getDemoPolicy,
    saveDemoPolicy,
    updateProject,
    listDemoTemplates,
    getDemoTemplate,
    saveDemoTemplate,
    updateMetadata,
    downloads,
    ticketDownload,
    artifactResponse,
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
  app.get('/api/video-studio/intro-assets', req => studio.intros.list(req.query.project_id));
  app.post('/api/video-studio/intro-assets', req => studio.intros.start(req.body));
  app.post('/api/video-studio/intro-assets/:id/chunks', { bodyLimit: 1500000 }, req =>
    studio.intros.chunk(req.params.id, req.body)
  );
  app.post('/api/video-studio/intro-assets/:id/complete', req => studio.intros.complete(req.params.id));
  app.post('/api/video-studio/intro-assets/:id/cancel', req => studio.intros.cancel(req.params.id));
  app.get('/api/video-studio/intro-assets/:id/file', async (req, reply) => {
    const response = await studio.intros.file(req.params.id, req.headers.range);
    reply.code(response.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges'])
      if (response.headers.has(header)) reply.header(header, response.headers.get(header));
    return reply
      .header('Cache-Control', 'private, no-store')
      .send(response.body ? Readable.fromWeb(response.body) : Buffer.alloc(0));
  });
  app.get('/api/video-studio/capabilities', () => studio.capabilities());
  app.get('/api/video-studio/demo-policy', () => studio.getDemoPolicy());
  app.post('/api/video-studio/demo-policy', async (req, reply) => {
    if (req.headers.origin !== origin() || req.headers['sec-fetch-site'] === 'cross-site')
      return reply.code(403).send({ error: 'Gleiche Herkunft für Domainänderungen erforderlich.' });
    if (!req.body || Object.keys(req.body).length !== 1 || !Object.hasOwn(req.body, 'policy'))
      return reply.code(422).send({ error: 'Ein versioniertes policy-Objekt oder null ist erforderlich.' });
    return studio.saveDemoPolicy(req.body.policy);
  });
  app.post('/api/video-studio/openai-audio-test', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, () =>
    studio.testOpenAINarration()
  );
  app.get('/api/video-studio/demo-logins', () => studio.listDemoLogins());
  app.post('/api/video-studio/demo-logins', req => studio.saveDemoLogin(req.body));
  app.post(
    '/api/video-studio/demo-logins/:id/test',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    req => studio.testDemoLogin(req.params.id)
  );
  app.get('/api/video-studio/projects', () => studio.listProjects());
  app.post('/api/video-studio/projects/:id', req => studio.updateProject(req.params.id, req.body));
  app.get('/api/video-studio/demo-templates', () => studio.listDemoTemplates());
  app.post('/api/video-studio/demo-templates', req => studio.saveDemoTemplate(req.body));
  app.post('/api/video-studio/demo-templates/:id', req => studio.saveDemoTemplate(req.body, req.params.id));
  app.post('/api/video-studio/jobs/:id/metadata', req => studio.updateMetadata(req.params.id, req.body));
  app.get('/api/video-studio/jobs/:id/downloads', req => studio.downloads(req.params.id));
  app.get('/video-studio/download/:token', { logLevel: 'silent' }, async (req, reply) => {
    const file = await studio.ticketDownload(req.params.token);
    return reply
      .type(file.type)
      .header('Cache-Control', 'private, no-store')
      .header('Referrer-Policy', 'no-referrer')
      .header(
        'Content-Disposition',
        'attachment; filename="siteops-video.' +
          { video: 'mp4', short: 'mp4', thumbnail: 'png', subtitles: 'srt', metadata: 'json' }[file.kind] +
          '"'
      )
      .send(file.body);
  });
  app.post('/api/video-studio/projects', async (req, reply) =>
    reply.code(201).send(await studio.createProject(req.body))
  );
  app.get('/api/video-studio/jobs', req =>
    studio.listJobs(req.query.project_id, {
      limit: Number(req.query.limit || 100),
      offset: Number(req.query.offset || 0),
      deleted: req.query.deleted === 'true'
    })
  );
  app.post('/api/video-studio/jobs/:id/trash', req => studio.trashJob(req.params.id));
  app.post('/api/video-studio/jobs/:id/restore', req => studio.restoreJob(req.params.id));
  app.post('/api/video-studio/jobs', async (req, reply) => reply.code(201).send(await studio.createJob(req.body)));
  app.get('/api/video-studio/jobs/:id', req => studio.refreshJob(req.params.id));
  app.get('/api/video-studio/jobs/:id/publication', req => studio.publication.read(req.params.id));
  app.post('/api/video-studio/jobs/:id/publication', { bodyLimit: 2900000 }, req =>
    studio.publication.save(req.params.id, req.body)
  );
  app.get('/api/video-studio/jobs/:id/publication/thumbnail', async (req, reply) =>
    reply
      .type('image/jpeg')
      .header('Cache-Control', 'private, no-store')
      .send(await studio.publication.thumbnail(req.params.id))
  );
  app.post('/api/video-studio/capture-test', { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } }, req =>
    studio.testCapture(req.body)
  );
  app.post('/api/video-studio/jobs/:id/render', req => studio.renderJob(req.params.id));
  app.get('/api/video-studio/jobs/:id/file', async (req, reply) => {
    const kind = String(req.query.kind || 'video');
    const file = await studio.download(req.params.id, kind);
    const ext = { video: 'mp4', short: 'mp4', subtitles: 'srt', thumbnail: 'png', metadata: 'json' }[kind];
    return reply
      .type(file.type)
      .header('Content-Disposition', 'attachment; filename="siteops-video.' + ext + '"')
      .send(file.body);
  });
}
