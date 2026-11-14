import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Test files for upload steps in demo recordings. SiteOps sends them with the request; the runner
// keeps them by SHA-256 so a job can be recorded again without resending. Only the exact bytes
// that match the hash are ever handed to a browser.
export const MAX_DEMO_FILE_BYTES = 8 * 1024 * 1024;
export const MAX_DEMO_FILES_BYTES = 10 * 1024 * 1024;
const ROOT = process.env.VIDEO_DEMO_FILES_DIR || path.join(os.tmpdir(), 'siteops-demo-files');
const SHA = /^[a-f0-9]{64}$/;

export function safeDemoFileName(value) {
  const name = String(value || '').trim();
  if (!name || name.length > 120 || /[\\/\0]/.test(name) || name.startsWith('.') || !/^[\w .()+-]+$/.test(name))
    throw new Error('Ungültiger Dateiname für eine Testdatei.');
  return name;
}

export async function storeDemoFiles(files = []) {
  if (!Array.isArray(files) || files.length > 6) throw new Error('Höchstens sechs Testdateien je Auftrag.');
  let total = 0;
  for (const file of files) {
    const name = safeDemoFileName(file?.name);
    if (!SHA.test(file?.sha256 || '') || typeof file?.data !== 'string') throw new Error('Ungültige Testdatei.');
    const data = Buffer.from(file.data, 'base64');
    total += data.length;
    if (!data.length || data.length > MAX_DEMO_FILE_BYTES || total > MAX_DEMO_FILES_BYTES)
      throw new Error('Testdateien sind zu groß (höchstens 8 MiB je Datei, 10 MiB je Auftrag).');
    if (crypto.createHash('sha256').update(data).digest('hex') !== file.sha256)
      throw new Error('Testdatei stimmt nicht mit ihrer Prüfsumme überein.');
    const dir = path.join(ROOT, file.sha256);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await fs.writeFile(path.join(dir, name), data, { mode: 0o600 });
  }
}

export async function demoFilePath(sha256, name) {
  if (!SHA.test(sha256 || '')) throw new Error('Ungültige Testdatei.');
  const target = path.join(ROOT, sha256, safeDemoFileName(name));
  const data = await fs.readFile(target).catch(() => null);
  if (!data) throw new Error('Testdatei fehlt auf dem Runner. Bitte erneut starten.');
  if (crypto.createHash('sha256').update(data).digest('hex') !== sha256)
    throw new Error('Testdatei auf dem Runner ist beschädigt.');
  return target;
}
