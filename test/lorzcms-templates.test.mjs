import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const php = process.env.SITEOPS_PHP || 'php';
const args = [
  ...(process.env.SITEOPS_PHP_INI ? ['-c', process.env.SITEOPS_PHP_INI] : []),
  '-d',
  'display_errors=stderr'
];
const available =
  spawnSync(
    php,
    [
      ...args,
      '-r',
      "exit(PHP_VERSION_ID>=80300 && extension_loaded('pdo_sqlite') && extension_loaded('dom') && extension_loaded('mbstring') ? 0 : 1);"
    ],
    { windowsHide: true }
  ).status === 0;
if (process.env.CI && !available) throw new Error('Template tests require PHP 8.3, SQLite, DOM and mbstring.');

test(
  'CMS page templates: inheritance, project hooks, HTML safety, CSS, permissions and history',
  { skip: !available },
  () => {
    const run = spawnSync(php, [...args, fileURLToPath(new URL('./fixtures/page-templates.php', import.meta.url))], {
      encoding: 'utf8',
      windowsHide: true
    });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    assert.deepEqual(JSON.parse(run.stdout), {
      presets: ['studio', 'editorial', 'split', 'landing'],
      status: 'passed'
    });
  }
);
