import * as z from 'zod/v4';
import { parseVideoInput } from './video-production.mjs';

// Skills are named working methods for the Video Suite producer. The same list serves the SiteOps
// interface and the MCP tools, so a task started in either place follows the same method.
export const skillModes = ['strategy', 'script', 'edit', 'seo', 'thumbnail', 'social'];
export const skillModeLabels = {
  strategy: 'Strategie & Ideen',
  script: 'Skript & Storyboard',
  edit: 'Schnitt & Dramaturgie',
  seo: 'YouTube SEO',
  thumbnail: 'Titelbild-Konzepte',
  social: 'Social Posts & Shorts'
};
export const skillId = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Kennung: Kleinbuchstaben, Ziffern und Bindestriche.');
export const skillSchema = z
  .object({
    id: skillId,
    name: z.string().trim().min(2).max(80),
    summary: z.string().trim().min(5).max(240),
    mode: z.enum(skillModes),
    starter: z.string().trim().max(2000).default(''),
    instructions: z.string().trim().min(20).max(6000)
  })
  .strict();
const storedSchema = z.object({ skills: z.array(skillSchema).max(60) }).strict();
const settingKey = 'video_suite_skills';

const builtin = [
  {
    id: 'themenfinder',
    name: 'Themenfinder',
    summary: 'Fünf belegbare Videoideen mit Zielgruppe, Problem, Blickwinkel und Arbeitstitel.',
    mode: 'strategy',
    starter:
      'Finde fünf Videoideen zu meinem Thema. Nenne je Idee Zielgruppe, Problem, Blickwinkel, Arbeitstitel und Einstieg.',
    instructions:
      'Propose exactly five distinct video ideas for the given topic. For each: audience, the concrete problem it solves, the angle that makes it different, a working title, a one-sentence hook and the suggested format and length. Build only on product knowledge and context that were provided; mark anything that still needs verification. Rank the ideas by expected usefulness for the audience and explain the ranking in one sentence each. End with the single idea you would produce first and why. Return draft=null.'
  },
  {
    id: 'hook-varianten',
    name: 'Hook-Varianten',
    summary: 'Fünf Einstiege für die ersten 15 Sekunden, jeweils mit anderer Dramaturgie.',
    mode: 'script',
    starter: 'Schreibe fünf verschiedene Einstiege für die ersten 15 Sekunden meines Videos.',
    instructions:
      'Write five alternative openings for the first 15 seconds (about 35 spoken words each). Use five different approaches: the viewer problem, the finished result first, a common mistake, a concrete number or time saving that the context supports, and a direct question. Each opening must make an honest promise that the existing script actually keeps. After the list, recommend one opening and name the scene it would replace. Do not rewrite the rest of the script. Return draft=null.'
  },
  {
    id: 'video-komplett',
    name: 'Video komplett planen',
    summary: 'Vollständiger Entwurf: Hook, Sprechertext, Szenenplan und YouTube-Metadaten.',
    mode: 'script',
    starter:
      'Erstelle aus meinem Thema ein vollständiges, etwa vierminütiges Tutorial mit Hook, Sprechertext, Szenenplan, Bildanweisungen und YouTube-Metadaten.',
    instructions:
      'Produce a complete production draft. Work in this order: audience and promise, hook, steps in the order a viewer would perform them, payoff, call to action, outro. One idea per scene; narration in natural spoken sentences. Choose capture_mode per scene deliberately and reuse matching available_demo_templates where they fit. Fill the youtube metadata completely. In reply, summarise the structure in at most six lines and list every statement that the owner should verify before recording.'
  },
  {
    id: 'skript-lektorat',
    name: 'Skript-Lektorat',
    summary: 'Strafft Einstieg, Tempo und Verständlichkeit, ohne bestätigte Demo-Schritte zu ändern.',
    mode: 'edit',
    starter: 'Prüfe und straffe mein vorhandenes Skript. Erhalte alle bestätigten Demo-Aktionen.',
    instructions:
      'Edit the existing script like a spoken-word editor. Remove filler, repeated explanations and written-language phrasing; shorten sentences that cannot be spoken in one breath; move the payoff earlier where the opening is slow. Keep facts, the order of confirmed demo actions, capture modes and demo templates unchanged. Return a complete revised draft. In reply, list the five most important changes with the scene number and state the estimated runtime before and after at about 150 words per minute.'
  },
  {
    id: 'szenenplan',
    name: 'Szenenplan',
    summary: 'Teilt ein Skript in Szenen mit Aufnahmeart und Bildanweisung auf.',
    mode: 'edit',
    starter: 'Teile mein Skript in sinnvolle Szenen auf und schlage je Szene Aufnahmeart und Bildanweisung vor.',
    instructions:
      'Turn the existing script into a scene plan without changing its wording more than necessary. Start a new scene whenever the visible subject changes. For every scene set a short headline, the narration, the capture_mode that the renderer can actually deliver and visual directions as planning notes. Prefer available_demo_templates for product steps and text scenes for explanations without visible UI. Keep scenes between roughly 8 and 40 seconds. Return a complete draft and note in reply which scenes still need a demo template or login.'
  },
  {
    id: 'qualitaetspruefung',
    name: 'Qualitätsprüfung',
    summary: 'Prüft Skript und Metadaten vor dem Rendern auf Fehler, Lücken und unbelegte Aussagen.',
    mode: 'edit',
    starter: 'Prüfe mein Skript und meine Metadaten vor dem Rendern. Liste Probleme nach Schweregrad.',
    instructions:
      'Review the current script, scenes and metadata as a critical pre-production check; do not rewrite them. Check: statements not covered by product knowledge or context, promises in title or hook that the video does not keep, unclear steps, scenes whose capture_mode cannot show what the narration describes, missing outro, runtime against the intended format, and violations of the production guidelines. Report findings in reply grouped as Blocker, Wichtig and Hinweis, each with scene number and a concrete fix. If nothing blocks rendering, say so plainly. Return draft=null.'
  },
  {
    id: 'seo-paket',
    name: 'SEO-Paket',
    summary: 'Drei ehrliche Titel, Beschreibung, Keywords, Hashtags und Kapitel zum fertigen Video.',
    mode: 'seo',
    starter:
      'Optimiere Titel, Beschreibung, Keywords, Hashtags und Kapitel für mein Video. Verändere den Sprechertext nicht.',
    instructions:
      'Prepare the publication package for the existing video without changing narration or scenes. Derive the main search phrase from what the video really shows. Offer three honest titles in reply (search-led, benefit-led, curiosity-led) and put the strongest one in the draft. Write a description whose first two lines work as the search snippet, then a short summary, chapters derived from the scenes (marked as estimates until final timing) and sources only when supplied. Add relevant keywords and at most three hashtags. Return a complete draft with unchanged scenes and updated youtube metadata.'
  },
  {
    id: 'titelbild-konzepte',
    name: 'Titelbild-Konzepte',
    summary: 'Drei deutlich verschiedene Titelbild-Ideen und ein fertiger Bildprompt.',
    mode: 'thumbnail',
    starter: 'Entwickle drei deutlich verschiedene Titelbild-Konzepte zu meinem Video und einen fertigen Bildprompt.',
    instructions:
      'Develop three clearly different thumbnail concepts: one centred on the result, one on the problem and one on a single bold object or symbol. For each give the visual idea, the overlay text (0-5 words that add to the title instead of repeating it), composition and colours. Recommend one concept and write thumbnail_prompt for it as a self-contained brief. No invented screenshots, features or people. Return draft=null unless the owner asks to update the thumbnail concept in the metadata.'
  },
  {
    id: 'short-ableiten',
    name: 'Short ableiten',
    summary: 'Macht aus dem stärksten Moment des Videos einen eigenständigen Kurzclip.',
    mode: 'social',
    starter: 'Leite aus meinem Skript einen eigenständigen Short mit starkem Einstieg ab.',
    instructions:
      'Derive one standalone short of 30 to 45 seconds (at most about 110 spoken words) from the existing script. Pick the single most useful moment; it must be understandable without the long video. Structure: hook in the first two seconds, one clear step or insight, a closing line that points to the full video without claiming a clickable link. Return it as a complete draft with 3 to 6 short scenes and adapted youtube metadata for the short. Explain in reply why this moment was chosen and which scenes of the original it is based on.'
  },
  {
    id: 'social-beitraege',
    name: 'Social-Beiträge',
    summary: 'LinkedIn-Beitrag, WhatsApp-Kanaltext und Community-Hinweis aus dem fertigen Video.',
    mode: 'social',
    starter: 'Leite aus meinem Video einen LinkedIn-Beitrag, einen WhatsApp-Kanalbeitrag und einen kurzen Hinweis ab.',
    instructions:
      'Write social_posts that announce the existing video: one LinkedIn post (problem, what the viewer learns, a question that invites replies; no hashtag wall), one short WhatsApp channel post of at most 350 characters, and one neutral community post. Each post must stand on its own and use only statements the video supports. Leave a clear placeholder where the video link belongs instead of inventing a URL. Return draft=null.'
  }
].map(skill => Object.freeze({ ...skill, source: 'builtin' }));
export const builtinVideoSkills = Object.freeze(builtin);
export const videoSkillInstructions = skill =>
  `The owner selected the skill "${skill.name}". Apply the following method to this request. It refines how you work; every rule above and the JSON output contract stay in force.\n${skill.instructions}`;

const fail = (statusCode, message) => {
  throw Object.assign(new Error(message), { statusCode });
};
export function createVideoSkills({ db, encrypt, decrypt }) {
  const custom = async () => {
    const [rows] = await db.query('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', [settingKey]);
    return rows.length ? parseVideoInput(storedSchema, decrypt(rows[0].setting_value)).skills : [];
  };
  const store = skills =>
    db.query(
      'INSERT INTO app_settings(setting_key,setting_value,encrypted) VALUES(?,?,1) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),encrypted=1,updated_at=NOW()',
      [settingKey, encrypt(parseVideoInput(storedSchema, { skills }))]
    );
  const merge = own => {
    const ids = new Set(builtin.map(skill => skill.id));
    const overrides = new Map(own.map(skill => [skill.id, skill]));
    return [
      ...builtin.map(skill => (overrides.has(skill.id) ? { ...overrides.get(skill.id), source: 'adjusted' } : skill)),
      ...own.filter(skill => !ids.has(skill.id)).map(skill => ({ ...skill, source: 'custom' }))
    ];
  };
  const list = async () => ({ modes: skillModeLabels, skills: merge(await custom()) });
  const resolve = async id => {
    const skill = merge(await custom()).find(item => item.id === id);
    return skill || fail(404, 'Dieser Skill ist nicht vorhanden.');
  };
  const save = async raw => {
    const skill = parseVideoInput(skillSchema, raw);
    const own = (await custom()).filter(item => item.id !== skill.id);
    if (own.length >= 60) fail(409, 'Es sind höchstens 60 eigene Skills möglich.');
    await store([...own, skill]);
    return { saved: true, skill: await resolve(skill.id) };
  };
  const remove = async raw => {
    const { id } = parseVideoInput(z.object({ id: skillId }).strict(), raw);
    const own = await custom();
    if (!own.some(item => item.id === id))
      fail(
        builtin.some(item => item.id === id) ? 409 : 404,
        builtin.some(item => item.id === id)
          ? 'Mitgelieferte Skills lassen sich anpassen, aber nicht löschen.'
          : 'Dieser Skill ist nicht vorhanden.'
      );
    await store(own.filter(item => item.id !== id));
    return { removed: true, restored: builtin.some(item => item.id === id) };
  };
  return { list, resolve, save, remove };
}
