import { z } from 'zod';

const tasks = ['web', 'code', 'analysis', 'writing', 'visual', 'general'];
const catalogSchema = z
  .array(
    z.strictObject({
      id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
      label: z.string().trim().min(1).max(80),
      model: z.string().trim().min(1).max(160),
      provider: z.string().regex(/^[a-z0-9_-]{1,60}$/),
      strengths: z.array(z.enum(tasks)).min(1),
      description: z.string().trim().min(1).max(160)
    })
  )
  .max(24)
  .refine(items => {
    const routes = new Set(items.map(item => item.provider + '/' + item.model));
    return (
      routes.size === items.length &&
      new Set(items.map(item => item.id)).size === items.length &&
      items.every(item => item.id !== 'default')
    );
  });

function taskSignals(prompt, website) {
  const matches = [
    ['web', /\b(siteops|website|shop|deploy\w*|http|ssl|seo|browser|störung\w*|logs?)\b/i],
    ['code', /\b(code|debug\w*|php|git\w*|javascript|laravel|bagisto|fehler\w*|implementier\w*|programmier\w*)\b/i],
    ['analysis', /\b(analys\w*|vergleich\w*|diagnos\w*|plan\w*|risiko|recherch\w*)\b/i],
    ['writing', /\b(text\w*|schreib\w*|formulier\w*|e-mail|voiceover|zusammenfass\w*)\b/i],
    ['visual', /\b(video\w*|bild\w*|screenshot\w*|design\w*|szene\w*)\b/i]
  ]
    .filter(([, pattern]) => pattern.test(prompt))
    .map(([task]) => task);
  return { tasks: matches.length ? matches : [website ? 'web' : 'general'], detailed: prompt.length > 600 };
}

const rankingSchema = z
  .array(
    z.strictObject({
      id: z.string(),
      reason: z.string().trim().min(1).max(160)
    })
  )
  .length(3);

export function jarvisModelRouter(env, fetcher, defaultModel) {
  const defaultEntry = {
    id: 'default',
    label: 'Hermes-Standard',
    model: defaultModel,
    strengths: ['general'],
    description: 'Standardmodell der verbundenen Hermes-Installation.'
  };
  let catalog = [];
  let catalogInvalid = false;
  try {
    catalog = catalogSchema.parse(JSON.parse(env.JARVIS_MODELS_JSON || '[]'));
  } catch {
    catalogInvalid = true;
  }
  const models = [...catalog, defaultEntry];
  const options = new Map(models.map(model => [model.id, model]));
  const key = env.JARVIS_OPENROUTER_KEY?.trim();

  async function recommend(prompt, website) {
    const signals = taskSignals(prompt, website);
    const ranked = [...models].sort(
      (a, b) =>
        b.strengths.filter(task => signals.tasks.includes(task)).length -
        a.strengths.filter(task => signals.tasks.includes(task)).length
    );
    const local = ranked.slice(0, 3).map(({ id, label, description }) => ({ id, label, reason: description }));
    if (!key || models.length < 3) return { source: 'local', options: local };
    try {
      const candidates = ranked.slice(0, 12).map(({ id, label, strengths, description }) => ({
        id,
        label,
        strengths,
        description
      }));
      const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(6000),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'openrouter/free',
          max_tokens: 600,
          messages: [
            {
              role: 'system',
              content:
                'Rank exactly three distinct candidates for the given task. Reply only with a JSON array of objects with id and reason keys. Reasons are short, German, and explain the match to the task; do not invent strengths or prices.'
            },
            { role: 'user', content: JSON.stringify({ task: signals, candidates }) }
          ]
        })
      });
      if (!response.ok) {
        await response.body?.cancel();
        return { source: 'local', options: local };
      }
      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      const ranking = rankingSchema.parse(
        JSON.parse(content?.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, ''))
      );
      const offered = new Map(candidates.map(candidate => [candidate.id, candidate.label]));
      if (new Set(ranking.map(item => item.id)).size !== 3 || ranking.some(item => !offered.has(item.id))) {
        return { source: 'local', options: local };
      }
      return { source: 'openrouter', options: ranking.map(item => ({ ...item, label: offered.get(item.id) })) };
    } catch {
      return { source: 'local', options: local };
    }
  }

  return { recommend, get: id => options.get(id), count: models.length, catalogInvalid };
}
