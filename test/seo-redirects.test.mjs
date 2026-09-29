import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
const { seoFetchDocument } = await import('../app.mjs');

test('follows a canonical trailing-slash redirect without looping', async t => {
  const server = createServer((req, res) => {
    if (req.url === '/training') {
      res.writeHead(301, { location: '/training/' }).end();
      return;
    }
    if (req.url === '/training/') {
      res.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><title>Training</title>');
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/training`;
  const result = await seoFetchDocument(url);

  assert.equal(result.res.status, 200);
  assert.equal(result.finalUrl, `${url}/`);
  assert.equal(result.redirects.length, 1);
});
