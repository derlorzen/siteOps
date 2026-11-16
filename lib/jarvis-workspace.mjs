import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { jarvisModelRouter, openRouterModelId } from './jarvis-models.mjs';
import { registerJarvisPush } from './jarvis-push.mjs';

const uuid = z.uuid();
const projectKey = z.string().refine(value => {
  if (value === 'general') return true;
  const [type, id, extra] = value.split(':');
  return !extra && ['site', 'project'].includes(type) && uuid.safeParse(id).success;
});
const newProject = z.strictObject({ name: z.string().trim().min(1).max(100) });
const newChat = z.strictObject({ project: projectKey, id: uuid });
const revision = z.string().regex(/^\d{1,20}$/);
const message = z.strictObject({ prompt: z.string().trim().min(1).max(12_000), revision });
const selection = z.strictObject({ model: z.union([z.literal('default'), openRouterModelId]) });

const apiError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const ownerOf = req => createHash('sha256').update(req.siteopsAuth.subject).digest('hex');
const json = (value, fallback) => (typeof value === 'string' ? JSON.parse(value) : (value ?? fallback));

function chatView(row) {
  return {
    id: row.id,
    project: row.project_key,
    title: row.title,
    model: row.model_id,
    phase: row.phase,
    partial: row.partial_answer,
    revision: String(row.revision),
    messages: json(row.messages_json, []),
    recommendations: json(row.recommendations_json, null)
  };
}

function upstreamMessages(messages, website) {
  // Keep the saved transcript intact. Bound just the context sent back on each turn.
  const recent = messages.slice(-39);
  while (recent.length > 1 && Buffer.byteLength(JSON.stringify(recent)) > 185 * 1024) recent.splice(0, 2);
  return website
    ? [
        {
          role: 'system',
          content:
            'Dieses SiteOps-Website-Projekt bezieht sich auf die gespeicherte Domain ' +
            JSON.stringify(website.domain) +
            '. Nutze diese Domain als Bezug für projektbezogene Anfragen.'
        },
        ...recent
      ]
    : recent;
}

export function registerJarvisWorkspace(app, { q, env, fetcher, config, streamHermes }) {
  const router = jarvisModelRouter(env, fetcher);
  const controllers = new Map();
  const prefix = '/api/jarvis';
  const limited = { bodyLimit: 64 * 1024, config: { rateLimit: { max: 15, timeWindow: '1 minute' } } };
  const push = registerJarvisPush(app, { env, q, ownerOf, limited });
  app.addHook('onClose', async () => {
    for (const controller of controllers.values()) controller.abort();
  });

  async function project(owner, key) {
    if (key === 'general') return null;
    const [type, id] = key.split(':');
    const result =
      type === 'site'
        ? await q('SELECT id, name, domain FROM sites WHERE id=?', [id])
        : await q('SELECT id, name FROM jarvis_projects WHERE owner_key=? AND id=?', [owner, id]);
    if (!result.rows[0]) throw apiError(404, 'Projekt nicht gefunden.');
    return result.rows[0];
  }

  async function getChat(owner, id) {
    await q(
      "UPDATE jarvis_chats SET phase='interrupted', run_id=NULL, run_until=NULL, revision=revision+1 WHERE owner_key=? AND id=? AND phase='running' AND run_until<=CURRENT_TIMESTAMP(3)",
      [owner, id]
    );
    const { rows } = await q('SELECT * FROM jarvis_chats WHERE owner_key=? AND id=?', [owner, id]);
    if (!rows[0]) throw apiError(404, 'Chat nicht gefunden.');
    return rows[0];
  }

  async function update(sql, params, row) {
    const { meta } = await q(
      'UPDATE jarvis_chats SET ' +
        sql +
        ', revision=revision+1, updated_at=CURRENT_TIMESTAMP(3) WHERE owner_key=? AND id=? AND revision=?',
      [...params, row.owner_key, row.id, row.revision]
    );
    if (meta.affectedRows !== 1) throw apiError(409, 'Der Chat wurde gerade geändert. Bitte lade ihn neu.');
  }

  async function run(row, messages, model, website, controller) {
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]);
    let answer = '';
    let lastWrite = 0;
    try {
      for await (const delta of streamHermes(upstreamMessages(messages, website), model, signal, row.id)) {
        answer = (answer + delta).slice(0, 128_000);
        if (Date.now() - lastWrite < 1200) continue;
        lastWrite = Date.now();
        const { meta } = await q(
          "UPDATE jarvis_chats SET partial_answer=? WHERE owner_key=? AND id=? AND run_id=? AND phase='running'",
          [answer, row.owner_key, row.id, row.run_id]
        );
        if (!meta.affectedRows) {
          controller.abort();
          return;
        }
      }
      if (!answer.trim()) throw new Error('Empty Hermes response');
      const completed = [...messages, { role: 'assistant', content: answer.trim() }];
      const { meta } = await q(
        "UPDATE jarvis_chats SET messages_json=?, phase='idle', partial_answer=NULL, run_id=NULL, run_until=NULL, revision=revision+1, updated_at=CURRENT_TIMESTAMP(3) WHERE owner_key=? AND id=? AND run_id=? AND phase='running'",
        [JSON.stringify(completed), row.owner_key, row.id, row.run_id]
      );
      if (meta.affectedRows)
        void push
          .notify(row.owner_key, row.id)
          .catch(error => app.log.warn({ code: error.code }, 'Unable to deliver Jarvis notification'));
    } catch {
      await q(
        "UPDATE jarvis_chats SET phase='interrupted', partial_answer=?, run_id=NULL, run_until=NULL, revision=revision+1 WHERE owner_key=? AND id=? AND run_id=? AND phase='running'",
        [answer || null, row.owner_key, row.id, row.run_id]
      );
    }
  }

  async function start(row, messages, modelId, website) {
    if (!selection.safeParse({ model: modelId }).success)
      throw apiError(422, 'Dieses Modell ist nicht mehr eingerichtet.');
    const model = modelId === 'default' ? { model: config.model } : { model: modelId, provider: 'openrouter' };
    if (config.state !== 'configured') throw apiError(503, 'Hermes ist in SiteOps noch nicht eingerichtet.');
    if (controllers.size >= 8)
      throw apiError(429, 'Hermes verarbeitet gerade zu viele Anfragen. Bitte versuche es gleich erneut.');
    const controller = new AbortController();
    const runId = randomUUID();
    await update(
      "messages_json=?, model_id=?, phase='running', partial_answer=NULL, run_id=?, run_until=DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 195 SECOND)",
      [JSON.stringify(messages), modelId, runId],
      row
    );
    controllers.set(runId, controller);
    void run({ ...row, run_id: runId }, messages, model, website, controller)
      .catch(error => app.log.error({ code: error.code }, 'Unable to save Jarvis result'))
      .finally(() => controllers.delete(runId));
    return chatView({
      ...row,
      messages_json: messages,
      model_id: modelId,
      phase: 'running',
      partial_answer: null,
      revision: BigInt(row.revision) + 1n
    });
  }

  app.get(prefix + '/workspace', async req => {
    const owner = ownerOf(req);
    const [sites, projects, chats] = await Promise.all([
      q('SELECT id, name, domain FROM sites ORDER BY name, id'),
      q('SELECT id, name FROM jarvis_projects WHERE owner_key=? ORDER BY name, id', [owner]),
      q(
        "SELECT id, project_key, title, phase FROM jarvis_chats WHERE owner_key=? AND messages_json<>'[]' ORDER BY updated_at DESC, id DESC LIMIT 200",
        [owner]
      )
    ]);
    return {
      sites: sites.rows.map(site => ({ ...site, id: 'site:' + site.id })),
      projects: projects.rows.map(item => ({ ...item, id: 'project:' + item.id })),
      chats: chats.rows.map(row => ({ id: row.id, project: row.project_key, title: row.title, phase: row.phase })),
      pushPublicKey: push.publicKey
    };
  });

  app.post(prefix + '/projects', limited, async req => {
    const { name } = newProject.parse(req.body);
    const id = randomUUID();
    await q('INSERT INTO jarvis_projects(id,owner_key,name) VALUES(?,?,?)', [id, ownerOf(req), name]);
    return { id: 'project:' + id, name };
  });

  app.post(prefix + '/chats', limited, async req => {
    const input = newChat.parse(req.body);
    const owner = ownerOf(req);
    await project(owner, input.project);
    await q(
      'INSERT INTO jarvis_chats (id,owner_key,project_key,messages_json) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE id=id',
      [input.id, owner, input.project, '[]']
    );
    const row = await getChat(owner, input.id);
    if (row.project_key !== input.project) throw apiError(409, 'Der Chat gehört zu einem anderen Projekt.');
    return chatView(row);
  });

  app.get(prefix + '/chats/:id', async req => chatView(await getChat(ownerOf(req), uuid.parse(req.params.id))));

  app.post(prefix + '/chats/:id/messages', limited, async req => {
    const incoming = message.parse(req.body);
    const { prompt } = incoming;
    const row = await getChat(ownerOf(req), uuid.parse(req.params.id));
    if (incoming.revision !== String(row.revision) || row.phase !== 'idle')
      throw apiError(409, 'In diesem Chat ist bereits eine Anfrage offen.');
    const selectedProject = await project(row.owner_key, row.project_key);
    const messages = [...json(row.messages_json, []), { role: 'user', content: prompt }];
    if (row.model_id) return start(row, messages, row.model_id, selectedProject);
    const recommendations = await router.recommend(prompt);
    const title = Array.from(prompt.replace(/\s+/g, ' ')).slice(0, 96).join('');
    await update(
      "title=?, messages_json=?, recommendations_json=?, phase='choosing'",
      [title, JSON.stringify(messages), JSON.stringify(recommendations)],
      row
    );
    return chatView({
      ...row,
      title,
      messages_json: messages,
      recommendations_json: recommendations,
      phase: 'choosing',
      revision: BigInt(row.revision) + 1n
    });
  });

  app.post(prefix + '/chats/:id/model', limited, async req => {
    const { model } = selection.parse(req.body);
    const row = await getChat(ownerOf(req), uuid.parse(req.params.id));
    const recommendations = json(row.recommendations_json, { options: [] });
    const allowed =
      model === 'default'
        ? !recommendations.options.length
        : recommendations.source === 'openrouter' && recommendations.options.some(item => item.id === model);
    if (row.phase !== 'choosing' || !allowed) {
      throw apiError(409, 'Wähle eine der Modell-Empfehlungen für diesen Chat.');
    }
    return start(row, json(row.messages_json, []), model, await project(row.owner_key, row.project_key));
  });

  app.post(prefix + '/chats/:id/retry', limited, async req => {
    const row = await getChat(ownerOf(req), uuid.parse(req.params.id));
    const messages = json(row.messages_json, []);
    if (row.phase === 'choosing' && json(row.recommendations_json, { options: [] }).options.length === 0) {
      const recommendations = await router.recommend(messages[0].content);
      await update('recommendations_json=?', [JSON.stringify(recommendations)], row);
      return chatView({ ...row, recommendations_json: recommendations, revision: BigInt(row.revision) + 1n });
    }
    if (!['interrupted', 'stopped'].includes(row.phase)) throw apiError(409, 'Es gibt keine unterbrochene Antwort.');
    return start(row, messages, row.model_id, await project(row.owner_key, row.project_key));
  });

  app.post(prefix + '/chats/:id/stop', limited, async req => {
    const row = await getChat(ownerOf(req), uuid.parse(req.params.id));
    if (row.phase !== 'running') return chatView(row);
    await update("phase='stopped', run_id=NULL, run_until=NULL", [], row);
    controllers.get(row.run_id)?.abort();
    return chatView(await getChat(row.owner_key, row.id));
  });
}
