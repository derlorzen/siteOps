import { mkdir, writeFile } from 'node:fs/promises';
import { bundledRelease } from '../lib/lorzcms.mjs';
const release = await bundledRelease();
const output = new URL('../dist/', import.meta.url);
await mkdir(output, { recursive: true });
await writeFile(new URL('lorzcms-' + release.version + '.json', output), JSON.stringify(release));
console.log('LorzCMS ' + release.version + ' built; digest ' + release.digest);
