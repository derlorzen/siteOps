import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const php = process.env.SITEOPS_PHP || 'php';
const args = process.env.SITEOPS_PHP_INI ? ['-c', process.env.SITEOPS_PHP_INI] : [];
const directories = [
  new URL('../packages/lorzcms-core/', import.meta.url),
  new URL('../lib/lorzcms/', import.meta.url)
];
let files = 0;
async function walk(url) {
  for (const entry of await readdir(url, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
    if (entry.isDirectory()) await walk(child);
    else if (entry.name.endsWith('.php')) {
      const result = spawnSync(php, [...args, '-l', fileURLToPath(child)], { encoding: 'utf8', windowsHide: true });
      if (result.status !== 0)
        throw new Error(result.stderr || result.stdout || 'PHP 8.3+ is required for CMS checks.');
      files++;
    }
  }
}
for (const dir of directories) await walk(dir);
console.log(files + ' CMS PHP files passed syntax checks.');
