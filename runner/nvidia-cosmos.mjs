import { writeFile } from 'node:fs/promises';

export const NVIDIA_COSMOS_URL = 'https://ai.api.nvidia.com/v1/cosmos/nvidia/cosmos3-nano';
const MAX_BASE64_CHARS = 150_000_000;

export function cosmosVideoRequest({ prompt, format = 'landscape', numFrames = 121, seed = 42 }) {
  if (typeof prompt !== 'string' || prompt.trim().length < 12 || prompt.length > 1200)
    throw new Error('NVIDIA Cosmos requires a prompt between 12 and 1200 characters.');
  if (!['landscape', 'portrait'].includes(format)) throw new Error('Invalid video format.');
  if (!Number.isInteger(numFrames) || numFrames < 25 || numFrames > 197)
    throw new Error('NVIDIA Cosmos frames must be between 25 and 197.');
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw new Error('Invalid NVIDIA Cosmos seed.');
  return {
    model_mode: 'text2video',
    prompt: prompt.trim(),
    resolution: format === 'portrait' ? '480_9_16' : '480_16_9',
    num_frames: numFrames,
    num_inference_steps: 35,
    fps: 24,
    seed
  };
}

export async function generateCosmosVideo({
  prompt, format, numFrames, seed, outputPath,
  apiKey = process.env.NVIDIA_API_KEY,
  fetchImpl = fetch
}) {
  if (!apiKey || typeof apiKey !== 'string') throw new Error('NVIDIA_API_KEY is not configured on the runner.');
  if (!outputPath) throw new Error('NVIDIA video output path is required.');
  const payload = cosmosVideoRequest({ prompt, format, numFrames, seed });
  let response;
  try {
    response = await fetchImpl(NVIDIA_COSMOS_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(600_000),
      redirect: 'error'
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
      throw new Error('NVIDIA Cosmos request timed out. Outcome is unknown; do not automatically retry this scene.');
    throw new Error('NVIDIA Cosmos connection failed. Check the API service and network.');
  }
  if (response.status === 404)
    throw new Error('NVIDIA Cosmos public API returned HTTP 404. The Playground may work while bearer-key API access is unavailable; generation was not confirmed.');
  if (response.status === 401 || response.status === 403)
    throw new Error('NVIDIA Cosmos API key is not authorized for this endpoint.');
  if (response.status === 429)
    throw new Error('NVIDIA Cosmos trial rate limit reached. No automatic retry.');
  if (!response.ok)
    throw new Error('NVIDIA Cosmos video generation failed (HTTP ' + response.status + ').');
  const size = Number(response.headers.get('content-length') || 0);
  if (size > MAX_BASE64_CHARS * 2) throw new Error('NVIDIA Cosmos response exceeds size limit.');
  const result = await response.json().catch(() => null);
  const encoded = result?.b64_video;
  if (typeof encoded !== 'string' || encoded.length < 100 || encoded.length > MAX_BASE64_CHARS ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw new Error('NVIDIA Cosmos response did not contain a valid base64 MP4.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length < 32 || bytes.subarray(4, 8).toString('ascii') !== 'ftyp')
    throw new Error('NVIDIA Cosmos returned a file that is not MP4.');
  await writeFile(outputPath, bytes, { mode: 0o600 });
  return { outputPath, bytes: bytes.length, model: 'nvidia/cosmos3-nano', frames: payload.num_frames, fps: payload.fps };
}
