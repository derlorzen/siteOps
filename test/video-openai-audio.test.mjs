import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { narrateWithOpenAI } from '../runner/openai-audio.mjs';

const wav = Buffer.alloc(48);
wav.write('RIFF', 0);
wav.write('WAVE', 8);

test('OpenAI audio adapter requests approved model and persists returned WAV only', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'video-openai-test-'));
  try {
    const output = path.join(dir, 'voice.wav');
    let checked = false;
    const result = await narrateWithOpenAI('Welcome to the Bagisto tutorial.', output, {
      apiKey: 'dummy-ci-key',
      voice: 'alloy',
      fetchImpl: async (url, request) => {
        assert.equal(url, 'https://api.openai.com/v1/chat/completions');
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.Authorization, 'Bearer dummy-ci-key');
        const body = JSON.parse(request.body);
        assert.equal(body.model, 'gpt-audio-1.5');
        assert.equal(body.store, false);
        assert.equal(body.audio.format, 'wav');
        assert.equal(body.modalities.includes('audio'), true);
        assert.match(body.messages[0].content, /Welcome to the Bagisto tutorial/);
        checked = true;
        return { ok: true, json: async () => ({
          choices: [{ message: { audio: { data: wav.toString('base64') } } }]
        }) };
      }
    });
    assert.equal(checked, true);
    assert.equal(result.provider, 'openai');
    assert.deepEqual(await readFile(output), wav);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('OpenAI adapter rejects unsupported voices and bad audio, without storing secrets', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'video-openai-test-'));
  try {
    await assert.rejects(narrateWithOpenAI('A safe sentence for audio.', path.join(dir, 'a.wav'), {
      apiKey: '', fetchImpl: async () => { throw Error('not called'); }
    }), /OPENAI_API_KEY/);
    await assert.rejects(narrateWithOpenAI('A safe sentence for audio.', path.join(dir, 'a.wav'), {
      apiKey: 'dummy', voice: 'unlisted'
    }), /Unsupported OpenAI/);
    await assert.rejects(narrateWithOpenAI('A safe sentence for audio.', path.join(dir, 'a.wav'), {
      apiKey: 'dummy', fetchImpl: async () => ({ ok: true, json: async () => ({
        choices: [{ message: { audio: { data: 'not valid base64!' } } }]
      }) })
    }), /returned no WAV audio/);
    await assert.rejects(narrateWithOpenAI('A safe sentence for audio.', path.join(dir, 'a.wav'), {
      apiKey: 'dummy', fetchImpl: async () => ({ ok: false, status: 429 })
    }), /HTTP 429/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
