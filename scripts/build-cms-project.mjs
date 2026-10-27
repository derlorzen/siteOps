import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { bundledRelease } from '../lib/lorzcms.mjs';
import { validateProjectManifest, projectSeedSummary } from '../lib/cms-projects.mjs';

export async function buildCmsProject(source, project, name = project) {
  const files = [];
  const core = await bundledRelease();
  const coreAssets = new Set(
    core.files.filter(file => file.path.startsWith('assets/')).map(file => 'public/' + file.path)
  );
  async function add(path) {
    if (coreAssets.has(path)) return;
    const bytes = await readFile(resolve(source, path));
    files.push({
      path,
      bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      content: bytes.toString('base64')
    });
  }
  async function walk(path) {
    let entries;
    try {
      entries = await readdir(resolve(source, path), { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const child = path + '/' + entry.name;
      if (entry.isSymbolicLink()) throw new Error('Symlinks werden nicht verpackt.');
      if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) await add(child);
    }
  }
  await walk('projects/' + project);
  await walk('public/assets');
  await walk('public/wp-content/uploads');
  const seedPath = 'migration/' + project + '-content.json';
  await add(seedPath);
  try {
    await add('audit/asset-verification.json');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const { manifest, digest, bytes } = validateProjectManifest({
    project,
    name,
    seedPath,
    files: files.map(({ content: _content, ...file }) => file)
  });
  const summary = projectSeedSummary(
    Buffer.from(files.find(file => file.path === seedPath).content, 'base64'),
    project
  );
  return {
    format: 'lorzcms-project-v1',
    manifest,
    digest,
    bytes,
    summary,
    files: files.map(({ path, content }) => ({ path, content }))
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [source, project, output, name] = process.argv.slice(2);
  if (!source || !project || !output)
    throw new Error('Usage: node scripts/build-cms-project.mjs SOURCE PROJECT OUTPUT [NAME]');
  const bundle = await buildCmsProject(source, project, name);
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(output, JSON.stringify(bundle));
  console.log(
    JSON.stringify({
      output,
      project,
      files: bundle.files.length,
      bytes: bundle.bytes,
      digest: bundle.digest,
      ...bundle.summary
    })
  );
}
