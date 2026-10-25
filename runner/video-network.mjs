import http from 'node:http';
import net, { BlockList } from 'node:net';
import crypto from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { demoHostMatches, normalizeDemoHosts } from './video-policy.mjs';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3]
])
  blocked.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20]
])
  blocked.addSubnet(address, prefix, 'ipv6');

export function isPublicDemoAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export async function resolveDemoTarget(hostname, hosts, resolve = lookup) {
  if (!demoHostMatches(hostname, hosts)) throw new Error('Demo host is not approved.');
  let timer;
  try {
    const answers = await Promise.race([
      resolve(hostname, { all: true, verbatim: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Demo DNS timeout.')), 5000);
      })
    ]);
    if (!answers.length || answers.some(answer => !isPublicDemoAddress(answer.address)))
      throw new Error('Demo DNS must resolve exclusively to public IP addresses.');
    return { address: answers[0].address, family: net.isIP(answers[0].address) };
  } finally {
    clearTimeout(timer);
  }
}

// Each HTTPS tunnel resolves once and connects to that literal, validated IP.
// Chromium still performs end-to-end certificate and hostname verification.
export async function createDemoProxy(hosts, { resolve = lookup, connect = net.connect } = {}) {
  const rules = normalizeDemoHosts(hosts);
  const username = crypto.randomBytes(18).toString('hex');
  const password = crypto.randomBytes(24).toString('hex');
  const authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
  const sockets = new Set();
  let closed = false;
  const server = http.createServer({ maxHeaderSize: 8192 }, (_req, res) => {
    res.writeHead(403, { Connection: 'close' });
    res.end();
  });
  server.maxConnections = 64;
  server.headersTimeout = 10000;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(60000, () => socket.destroy());
    socket.on('error', () => socket.destroy());
  });
  server.on('upgrade', (_req, socket) => socket.destroy());
  server.on('connect', async (req, client, head) => {
    let upstream;
    try {
      if (!req.headers['proxy-authorization']) {
        client.end(
          'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="SiteOps demo"\r\nConnection: close\r\n\r\n'
        );
        return;
      }
      if (req.headers['proxy-authorization'] !== authorization || !/^[a-z0-9.-]+:443$/i.test(req.url))
        throw new Error('Invalid proxy request.');
      const hostname = req.url.slice(0, -4).toLowerCase();
      const target = await resolveDemoTarget(hostname, rules, resolve);
      if (closed || client.destroyed) return;
      upstream = connect({ host: target.address, family: target.family, port: 443 });
      sockets.add(upstream);
      upstream.on('close', () => {
        sockets.delete(upstream);
        client.destroy();
      });
      client.on('close', () => upstream.destroy());
      upstream.on('error', () => client.destroy());
      upstream.setTimeout(15000, () => upstream.destroy());
      upstream.once('connect', () => {
        upstream.setTimeout(60000, () => upstream.destroy());
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length) upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
    } catch {
      upstream?.destroy();
      if (!client.destroyed) client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    }
  });
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return {
    proxy: { server: 'http://127.0.0.1:' + server.address().port, username, password, bypass: '<-loopback>' },
    close: async () => {
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise(resolveClose => server.close(resolveClose));
    }
  };
}
