import { spawn } from 'node:child_process';

const FRAME_W = 96;
const FRAME_H = 54;
const SAMPLE_BYTES = FRAME_W * FRAME_H;
const AUDIO_SAMPLES_MAX = 8000 * 12;
const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

function subprocess(command, args, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let size = 0;
    let errors = '';
    const chunks = [];
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill('SIGKILL');
        reject(error);
      } else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error(command + ' audio/video check timed out.')), 30000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) return finish(new Error('Audio/video probe exceeded output limit.'));
      chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      errors += String(chunk).slice(0, 1000);
      if (errors.length > 4000) errors = errors.slice(-4000);
    });
    child.on('error', error => finish(error));
    child.on('close', code =>
      finish(code === 0 ? null : new Error(command + ' could not decode media: ' + errors.slice(-500)), Buffer.concat(chunks))
    );
  });
}

export async function probeAvFile(filename) {
  const raw = await subprocess('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', filename
  ]);
  const data = JSON.parse(String(raw));
  const seconds = Number(data.format?.duration);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Media duration could not be verified.');
  return {
    duration_seconds: seconds,
    streams: (data.streams || []).map(s => s.codec_type),
    width: data.streams?.find(s => s.codec_type === 'video')?.width || null,
    height: data.streams?.find(s => s.codec_type === 'video')?.height || null
  };
}

async function decodedFrame(filename, time) {
  const raw = await subprocess('ffmpeg', [
    '-v', 'error', '-ss', time.toFixed(3), '-i', filename, '-frames:v', '1',
    '-vf', `scale=${FRAME_W}:${FRAME_H},format=gray`, '-f', 'rawvideo', 'pipe:1'
  ], SAMPLE_BYTES + 64);
  if (raw.length !== SAMPLE_BYTES) throw new Error('Actual video frame could not be decoded.');
  return raw;
}

async function voiceLevel(filename) {
  const pcm = await subprocess('ffmpeg', [
    '-v', 'error', '-i', filename, '-map', '0:a:0',
    '-t', '12', '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'
  ], AUDIO_SAMPLES_MAX * 2 + 4096);
  if (pcm.length < 400 || pcm.length % 2 !== 0) throw new Error('Narration PCM is missing or invalid.');
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const v = pcm.readInt16LE(i) / 32768;
    sum += v * v;
  }
  return Math.round(20 * Math.log10(Math.max(1e-10, Math.sqrt(sum / (pcm.length / 2)))) * 10) / 10;
}

// Decode real PCM from both the original narration and the muxed scene video.
// Compare 50ms energy envelopes, so AAC encoder delay and minor compression
// do not look like a different narration.
async function audioEnvelope(filename) {
  const pcm = await subprocess('ffmpeg', [
    '-v', 'error', '-i', filename, '-map', '0:a:0', '-t', '12',
    '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1'
  ], AUDIO_SAMPLES_MAX * 2 + 4096);
  if (pcm.length < 800 || pcm.length % 2 !== 0) throw Error('Invalid PCM audio alignment sample.');
  const envelope = [];
  for (let pos = 0; pos + 800 <= pcm.length; pos += 800) {
    let sum = 0;
    for (let i = pos; i < pos + 800; i += 2) {
      const sample = pcm.readInt16LE(i) / 32768;
      sum += sample * sample;
    }
    envelope.push(Math.sqrt(sum / 400));
  }
  return envelope;
}

export function estimateAudioAlignment(source, rendered) {
  if (!Array.isArray(source) || !Array.isArray(rendered))
    throw TypeError('Audio envelopes must be arrays.');
  if (Math.min(source.length, rendered.length) < 30)
    return { status: 'uncertain', offset_ms: null, correlation: null, reason: 'Sprachprobe zu kurz für sicheren Abgleich.' };
  let best = { shift: 0, score: -2, correlation: -1 };
  const limit = Math.min(40, Math.floor(Math.min(source.length, rendered.length) / 3));
  for (let shift = -limit; shift <= limit; shift++) {
    const start = Math.max(0, -shift), end = Math.min(source.length, rendered.length - shift);
    const n = end - start;
    if (n < 30) continue;
    let sumX = 0, sumY = 0, xx = 0, yy = 0, xy = 0;
    for (let i = start; i < end; i++) {
      const x = source[i], y = rendered[i + shift];
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw TypeError('Invalid audio sample.');
      sumX += x; sumY += y; xx += x * x; yy += y * y; xy += x * y;
    }
    const vx = n * xx - sumX * sumX, vy = n * yy - sumY * sumY;
    if (vx < 1e-8 || vy < 1e-8) continue;
    const correlation = (n * xy - sumX * sumY) / Math.sqrt(vx * vy);
    const score = correlation * (0.9 + 0.1 * n / Math.max(source.length, rendered.length));
    if (score > best.score) best = { shift, score, correlation };
  }
  if (best.correlation < 0.72)
    return { status: 'uncertain', offset_ms: null,
      correlation: Math.max(0, Math.round(best.correlation * 1000) / 1000),
      reason: 'Tonspur und Sprecherquelle lassen sich anhand der Signale nicht sicher abgleichen.' };
  const offset = best.shift * 50;
  const status = Math.abs(offset) > 700 ? 'misaligned' : Math.abs(offset) > 250 ? 'needs_review' : 'verified';
  return {
    status, offset_ms: offset, correlation: Math.round(best.correlation * 1000) / 1000,
    reason: status === 'misaligned'
      ? 'Die fertige Tonspur ist gegenüber der Sprecheraufnahme deutlich zeitversetzt.'
      : status === 'needs_review'
        ? 'Möglicher hörbarer Versatz: Anfang und Ende manuell kontrollieren.'
        : 'Die geprüfte Anfangspassage der Sprecheraufnahme ist zeitlich passend eingebettet.'
  };
}

export function assessAvSamples({ mode, frames, narration_dbfs, rendered_dbfs = narration_dbfs, rendered_seconds, narration_seconds, silent_fixture = false, audio_alignment = null }) {
  const blockers = [];
  const warnings = [];
  if (!frames.length) blockers.push('Keine echten Videoframes für die Prüfung vorhanden.');
  if (frames.some(f => !Buffer.isBuffer(f) || f.length !== SAMPLE_BYTES))
    blockers.push('Mindestens ein Videoframe ist unvollständig.');
  let darkness = null;
  let motion = null;
  if (!blockers.length) {
    const black = frames.map(frame => {
      let dark = 0;
      for (const value of frame) if (value < 12) dark++;
      return dark / frame.length;
    });
    darkness = Math.round(Math.max(...black) * 1000) / 1000;
    if (black.every(ratio => ratio >= 0.995))
      blockers.push('Alle geprüften Videoframes sind nahezu schwarz.');
    if (frames.length > 1) {
      const changes = [];
      for (let i = 1; i < frames.length; i++) {
        let changed = 0;
        for (let j = 0; j < SAMPLE_BYTES; j++) if (Math.abs(frames[i][j] - frames[i - 1][j]) > 18) changed++;
        changes.push(changed / SAMPLE_BYTES);
      }
      motion = Math.round(Math.max(...changes) * 10000) / 10000;
      if (mode === 'recording' && motion < 0.002)
        warnings.push('Bildschirmaufnahme zeigt in den Stichproben kaum Bildänderungen; Ablauf visuell kontrollieren.');
    }
  }
  if (rendered_seconds + 0.6 < narration_seconds)
    blockers.push('Gerenderter Szenenclip ist kürzer als die gesprochene Tonspur.');
  if (!silent_fixture && audio_alignment?.status === 'misaligned')
    blockers.push('Audio-Synchronisation: ' + audio_alignment.reason);
  else if (!silent_fixture && ['uncertain', 'needs_review'].includes(audio_alignment?.status))
    warnings.push('Audio-Synchronisation: ' + audio_alignment.reason);
  if (silent_fixture) {
    warnings.push('Stille Test-Tonspur: Sprachausgabe konnte nicht geprüft werden.');
  } else {
    if (narration_dbfs < -48)
      blockers.push('Quell-Sprecheraufnahme ist stumm oder ungewöhnlich leise.');
    if (rendered_dbfs < -48)
      blockers.push('Gerenderte Video-Tonspur ist stumm oder ungewöhnlich leise.');
  }
  return {
    status: blockers.length ? 'blocked' : warnings.length ? 'needs_review' : 'passed',
    verified_from_media: true,
    frame_black_max_ratio: darkness,
    motion_ratio: motion,
    narration_dbfs,
    rendered_dbfs,
    audio_alignment,
    blockers,
    warnings
  };
}

export async function inspectRenderedScene({ video, narration, mode, silentFixture = false }) {
  const [movie, voice] = await Promise.all([probeAvFile(video), probeAvFile(narration)]);
  if (!movie.streams.includes('video') || !movie.streams.includes('audio'))
    throw new Error('Rendered scene needs real video and audio streams.');
  if (!voice.streams.includes('audio')) throw new Error('Narration does not contain audio.');
  const sampleTimes = [0.12, 0.5, 0.88].map(ratio =>
    clamp(movie.duration_seconds * ratio, 0, Math.max(0, movie.duration_seconds - 0.08))
  );
  const frames = await Promise.all(sampleTimes.map(time => decodedFrame(video, time)));
  const [level, encodedLevel, audioAlignment] = await Promise.all([
    voiceLevel(narration),
    voiceLevel(video),
    silentFixture
      ? Promise.resolve({ status: 'not_checked', offset_ms: null, correlation: null })
      : Promise.all([audioEnvelope(narration), audioEnvelope(video)])
          .then(([source, encoded]) => estimateAudioAlignment(source, encoded))
  ]);
  const result = assessAvSamples({
    mode,
    frames,
    narration_dbfs: level,
    rendered_dbfs: encodedLevel,
    audio_alignment: audioAlignment,
    rendered_seconds: movie.duration_seconds,
    narration_seconds: voice.duration_seconds,
    silent_fixture: silentFixture
  });
  return {
    ...result,
    scene_duration_seconds: Math.round(movie.duration_seconds * 100) / 100,
    narration_duration_seconds: Math.round(voice.duration_seconds * 100) / 100,
    frame_samples: sampleTimes.map(value => Math.round(value * 100) / 100),
    resolution: { width: movie.width, height: movie.height }
  };
}

// Only called on the authenticated runner. No local filename is user-controlled.
export async function extractSceneFrame(filename, moment = 'middle') {
  const media = await probeAvFile(filename);
  if (!media.streams.includes('video')) throw new Error('No video track for frame review.');
  const ratio = { beginning: 0.15, middle: 0.5, end: 0.85 }[moment];
  if (ratio === undefined) throw new Error('Unsupported frame sample position.');
  const time = clamp(media.duration_seconds * ratio, 0, Math.max(0, media.duration_seconds - 0.08));
  const jpeg = await subprocess('ffmpeg', [
    '-v', 'error', '-ss', time.toFixed(3), '-i', filename, '-frames:v', '1',
    '-vf', 'scale=640:-2', '-q:v', '5', '-f', 'image2pipe', '-vcodec', 'mjpeg', 'pipe:1'
  ], 400000);
  if (jpeg.length < 100 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('JPEG frame extraction failed.');
  return jpeg;
}
