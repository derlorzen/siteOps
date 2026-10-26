import * as z from 'zod/v4';

export function parseVideoInput(schema, value) {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof z.ZodError) error.statusCode = 422;
    throw error;
  }
}

export const voices = {
  kokoro: ['am_adam', 'am_michael', 'af_heart', 'bf_emma', 'bm_george'],
  piper: ['de_DE-thorsten-medium'],
  openai: [
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
};
export const projectSchema = z.object({
  name: z.string().trim().min(2).max(120),
  channel: z.string().trim().min(2).max(120).default('Bagisto'),
  language: z.enum(['en', 'de']).default('en'),
  voice_provider: z.enum(['kokoro', 'piper', 'openai']).optional(),
  voice: z.string().max(30).optional()
});
export const projectChangesSchema = projectSchema
  .omit({ channel: true, language: true })
  .partial()
  .extend({
    channel: z.string().trim().min(2).max(120).optional(),
    language: z.enum(['en', 'de']).optional()
  })
  .strict();
export const demoStepSchema = z.object({
  action: z.enum(['click', 'hover', 'fill', 'press', 'scroll', 'wait', 'goto']),
  selector: z.string().max(240).optional(),
  url: z.string().url().optional(),
  value: z.string().max(160).optional(),
  key: z.enum(['Enter', 'Tab', 'Escape', 'ArrowDown', 'ArrowUp']).optional(),
  pixels: z.number().int().min(-1400).max(1400).optional(),
  ms: z.number().int().min(100).max(4000).optional()
});
export const sceneSchema = z.object({
  headline: z.string().trim().max(160).default(''),
  narration: z.string().trim().min(5).max(1400),
  visual_directions: z.string().max(1200).optional(),
  template_id: z.uuid().optional(),
  demoUrl: z.string().url().optional(),
  login_profile_id: z.uuid().optional(),
  demoSteps: z.array(demoStepSchema).max(16).optional(),
  test_data_only: z.literal(true).optional()
});
export const metadataSchema = z
  .object({
    title: z.string().trim().min(3).max(100),
    description: z.string().max(4500),
    keywords: z.array(z.string().min(1).max(80)).max(30),
    hashtags: z
      .array(
        z
          .string()
          .regex(/^#[\p{L}\p{N}_]+$/u)
          .max(60)
      )
      .max(10),
    chapters: z
      .array(z.object({ start_seconds: z.number().int().min(0).max(86400), title: z.string().min(1).max(120) }))
      .max(100),
    thumbnail_concept: z.string().min(5).max(1500),
    sources: z
      .array(z.object({ url: z.url(), note: z.string().max(600) }))
      .max(30)
      .default([])
  })
  .superRefine((value, ctx) => {
    if (
      value.chapters.some((c, i) =>
        i === 0 ? c.start_seconds !== 0 : c.start_seconds <= value.chapters[i - 1].start_seconds
      )
    )
      ctx.addIssue({
        code: 'custom',
        path: ['chapters'],
        message: 'Kapitel beginnen bei 0 und müssen aufsteigend sein.'
      });
  });
export const videoJobSchema = z.object({
  project_id: z.uuid(),
  title: z.string().trim().min(3).max(200),
  topic: z.string().trim().max(500).default(''),
  script: z.string().trim().min(30).max(18000),
  scenes: z.array(sceneSchema).min(1).max(24).optional(),
  format: z.enum(['landscape', 'portrait']).default('landscape'),
  youtube: metadataSchema.optional()
});
export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  language: z.enum(['en', 'de']),
  scene: sceneSchema.omit({ template_id: true }).extend({ demoUrl: z.url(), test_data_only: z.literal(true) })
});

export function projectSettings(data) {
  const x = parseVideoInput(projectSchema, data);
  const provider = x.voice_provider || (x.language === 'de' ? 'piper' : 'kokoro');
  const voice =
    x.voice || (provider === 'kokoro' ? 'am_adam' : provider === 'piper' ? 'de_DE-thorsten-medium' : 'alloy');
  if (
    (x.language === 'de' && provider === 'kokoro') ||
    (x.language === 'en' && provider === 'piper') ||
    !voices[provider].includes(voice)
  )
    throw Object.assign(
      new Error(
        'Sprache und Stimme müssen zum Anbieter passen: Kokoro Englisch, Piper Deutsch, OpenAI beide Sprachen.'
      ),
      { statusCode: 422 }
    );
  return { ...x, voice_provider: provider, voice };
}

export function defaultVideoMetadata(input, project, scenes) {
  const de = project.language === 'de';
  const keywords = [
    ...new Set([project.channel, ...(input.topic || input.title).split(/\s+/).filter(x => x.length > 3)])
  ]
    .slice(0, 12)
    .map(x => x.slice(0, 80));
  let seconds = 0;
  return metadataSchema.parse({
    title: input.title.slice(0, 100),
    description:
      (de ? 'In diesem Video: ' : 'In this video: ') +
      input.title +
      '\n\n' +
      scenes
        .map(s => s.headline)
        .filter(Boolean)
        .join('\n'),
    keywords,
    hashtags: ['#' + (project.channel.replace(/[^\p{L}\p{N}_]/gu, '').slice(0, 59) || 'Video')],
    chapters: scenes.map((s, i) => {
      const start = seconds;
      seconds += Math.max(10, Math.ceil(s.narration.split(/\s+/).length / 2.3));
      return { start_seconds: start, title: (s.headline || (de ? 'Szene ' : 'Scene ') + (i + 1)).slice(0, 120) };
    }),
    thumbnail_concept: de
      ? 'Klare Demo-Aufnahme mit dem Hauptnutzen als kurzer, gut lesbarer Überschrift: ' + input.title
      : 'Clear demo screenshot with a short, readable headline showing the main benefit: ' + input.title
  });
}

export function youtubeDescription(metadata) {
  const stamp = n => [Math.floor(n / 60), n % 60].map(x => String(x).padStart(2, '0')).join(':');
  return [
    metadata.description,
    metadata.chapters.map(c => stamp(c.start_seconds) + ' ' + c.title).join('\n'),
    metadata.hashtags.join(' ')
  ]
    .filter(Boolean)
    .join('\n\n');
}
