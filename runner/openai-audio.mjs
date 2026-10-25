import { promises as fs } from 'node:fs';

const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const VOICES = new Set(['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar']);

export async function narrateWithOpenAI(text, outputPath, {
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.VIDEO_OPENAI_AUDIO_MODEL || 'gpt-audio-1.5',
  voice = process.env.VIDEO_OPENAI_AUDIO_VOICE || 'alloy',
  language = 'en',
  fetchImpl = fetch
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim())
    throw new Error('Set OPENAI_API_KEY on the private Browser Runner to use OpenAI narration.');
  if (!VOICES.has(voice)) throw new Error('Unsupported OpenAI audio voice.');
  if (model !== 'gpt-audio-1.5') throw new Error('Unsupported OpenAI narration model.');
  if (!['en','de'].includes(language)) throw new Error('Unsupported narration language.');
  if (typeof text !== 'string' || text.length < 5 || text.length > 1400)
    throw new Error('Narration must contain between 5 and 1400 characters.');

  const body = {
    model,
    modalities: ['text', 'audio'],
    audio: { voice, format: 'wav' },
    store: false,
    messages: [
      {
        role: 'user',
        content: (language === 'de' ? 'Read the following narration aloud in natural standard German. ' : 'Read the following narration aloud in natural English. ') + 'Do not add introductions or unrelated remarks. Preserve the original wording. Narration:\n\n' + text
      }
    ]
  };
  const response = await fetchImpl(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90000)
  });
  if (!response.ok) throw new Error('OpenAI narration request failed (HTTP ' + response.status + '). Check API access, quota and voice settings.');
  const data = await response.json();
  const encoded = data?.choices?.[0]?.message?.audio?.data;
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(encoded))
    throw new Error('OpenAI narration returned no WAV audio.');
  const output = Buffer.from(encoded, 'base64');
  if (output.length < 44 || output.length > 30 * 1024 * 1024 ||
    output.toString('ascii', 0, 4) !== 'RIFF' || output.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error('OpenAI narration returned an invalid or oversized WAV file.');
  await fs.writeFile(outputPath, output, { mode: 0o600 });
  return { provider: 'openai', model, voice };
}
