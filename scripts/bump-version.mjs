import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function nextPatchVersion(version) {
  const match = /^([0-9]+)[.]([0-9]+)[.]([0-9]+)$/.exec(version);
  if (!match) throw new Error('SiteOps erwartet eine reine Major.Minor.Patch-Version.');
  return match[1] + '.' + match[2] + '.' + (Number(match[3]) + 1);
}

export async function bumpVersion(root = process.cwd()) {
  const paths = ['package.json', 'package-lock.json'].map(name => resolve(root, name));
  const [pkg, lock] = await Promise.all(paths.map(async path => JSON.parse(await readFile(path, 'utf8'))));
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.['']?.version) {
    throw new Error('package.json und package-lock.json enthalten unterschiedliche Versionsnummern.');
  }
  const version = nextPatchVersion(pkg.version);
  pkg.version = version;
  lock.version = version;
  lock.packages[''].version = version;
  await Promise.all(
    [pkg, lock].map((data, index) => writeFile(paths[index], JSON.stringify(data, null, 2) + '\n'))
  );
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write('SiteOps v' + (await bumpVersion()) + '\n');
}
