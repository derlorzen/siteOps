import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { cosmosVideoRequest, generateCosmosVideo, NVIDIA_COSMOS_URL } from '../runner/nvidia-cosmos.mjs';
import { requireCapturePlan } from '../runner/video-capture.mjs';
import { sceneSchema } from '../lib/video-production.mjs';

const sample = {
  headline: 'Warehouse robot',
  narration: 'Watch the robotic arm pick up the object and move it safely.',
  capture_mode: 'ai_video',
  ai_video: { provider: 'nvidia', prompt: 'A robotic arm moving a blue box across a warehouse workbench.' }
};
test('NVIDIA scene is schema-valid and cannot silently become a browser or text scene', () => {
  const parsed = sceneSchema.parse(sample);
  assert.equal(parsed.ai_video.num_frames, 121);
  assert.equal(parsed.ai_video.seed, 42);
  assert.equal(requireCapturePlan([parsed])[0].mode, 'ai_video');
  assert.throws(() => requireCapturePlan([{ ...parsed, capture_mode: 'text' }]), /KI-Videoeinstellungen/);
  assert.throws(() => requireCapturePlan([{ ...parsed, demoUrl: 'https://demo.example.com' }]), /Browser-Demo/);
  assert.throws(() => requireCapturePlan([{ ...parsed, ai_video: { provider: 'nvidia', prompt: '' } }]), /Prompt/);
});
test('NVIDIA request uses verified fixed URL, correct aspect ratio, and limited frames', () => {
  assert.equal(NVIDIA_COSMOS_URL, 'https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano');
  const a = cosmosVideoRequest({ prompt: sample.ai_video.prompt, format: 'landscape' });
  assert.equal(a.model_mode, 'text2video');
  assert.equal(a.resolution, '480_16_9');
  assert.equal(cosmosVideoRequest({ prompt: sample.ai_video.prompt, format: 'portrait' }).resolution, '480_9_16');
  assert.throws(() => cosmosVideoRequest({ prompt: sample.ai_video.prompt, numFrames: 400 }), /frames/);
});
test('NVIDIA adapter writes original MP4 and never logs or persists the API key', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cosmos-video-test-'));
  const outputPath = path.join(dir, 'scene.mp4');
  const video = Buffer.alloc(128);
  video.write('ftyp', 4, 'ascii');
  const apiKey = 'nvidia-private-test-key';
  try {
    let captured;
    const result = await generateCosmosVideo({
      prompt: sample.ai_video.prompt,
      format: 'landscape',
      outputPath,
      apiKey,
      fetchImpl: async (url, request) => {
        captured = { url, request };
        return new Response(JSON.stringify({ b64_video: video.toString('base64') }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });
    assert.equal(captured.url, NVIDIA_COSMOS_URL);
    assert.equal(JSON.parse(captured.request.body).num_frames, 121);
    assert.deepEqual(await readFile(outputPath), video);
    assert.equal(result.model, 'nvidia/cosmos3-nano');
    assert.ok(!JSON.stringify(result).includes(apiKey));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('NVIDIA HTTP 404 fails explicitly; no fake video or silent fallback', async () => {
  await assert.rejects(
    generateCosmosVideo({
      prompt: sample.ai_video.prompt,
      outputPath: '/tmp/should-not-create.mp4',
      apiKey: 'test',
      fetchImpl: async () => new Response('404 page not found', { status: 404 })
    }),
    /Playground may work/
  );
});
