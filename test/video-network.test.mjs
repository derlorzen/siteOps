import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { PassThrough } from 'node:stream';
import { isPublicDemoAddress, resolveDemoTarget, createDemoProxy } from '../runner/video-network.mjs';

test('demo DNS rejects private/reserved/mapped IPs and mixed answers, allows public IPv4 and IPv6', async () => {
  for (const address of [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '100.100.100.200',
    '169.254.169.254',
    '172.16.1.1',
    '192.168.0.1',
    '192.0.0.1',
    '192.0.2.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:0808:0808::1',
    '64:ff9b::0808:0808',
    'invalid'
  ])
    assert.equal(isPublicDemoAddress(address), false, address);
  for (const address of ['8.8.8.8', '93.184.215.14', '2606:4700:4700::1111', '2001:4860:4860::8888'])
    assert.equal(isPublicDemoAddress(address), true, address);
  const host = 'demo.lorzen.de',
    rules = ['*.lorzen.de'];
  for (const answers of [[], [{ address: '127.0.0.1' }], [{ address: '8.8.8.8' }, { address: '::1' }]])
    await assert.rejects(resolveDemoTarget(host, rules, async () => answers));
  await assert.rejects(
    resolveDemoTarget(host, rules, async () => {
      throw new Error('DNS failure');
    }),
    /DNS failure/
  );
  let calls = 0;
  await assert.rejects(
    resolveDemoTarget('evil.test', rules, async () => {
      calls++;
      return [];
    })
  );
  assert.equal(calls, 0);
});

const tunnel = async (proxy, authority, auth = true) => {
  const url = new URL(proxy.server);
  const socket = net.connect({ host: url.hostname, port: Number(url.port) });
  const result = await new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.once('data', chunk => resolve(chunk.toString()));
    socket.on('connect', () =>
      socket.write(
        'CONNECT ' +
          authority +
          ' HTTP/1.1\r\nHost: ' +
          authority +
          '\r\n' +
          (auth
            ? 'Proxy-Authorization: Basic ' +
              Buffer.from(proxy.username + ':' + proxy.password).toString('base64') +
              '\r\n'
            : '') +
          '\r\n'
      )
    );
  });
  socket.destroy();
  return result;
};

test('authenticated CONNECT pins the checked literal IP and revalidates DNS on later tunnels', async t => {
  let calls = 0;
  const connections = [];
  const guarded = await createDemoProxy(['*.lorzen.de'], {
    resolve: async () => [{ address: ++calls === 1 ? '8.8.8.8' : '127.0.0.1' }],
    connect: options => {
      connections.push(options);
      const stream = new PassThrough();
      stream.setTimeout = () => stream;
      process.nextTick(() => stream.emit('connect'));
      return stream;
    }
  });
  t.after(() => guarded.close());
  assert.match(await tunnel(guarded.proxy, 'demo.lorzen.de:443', false), /407/);
  assert.match(await tunnel(guarded.proxy, 'evil.test:443'), /403/);
  assert.match(await tunnel(guarded.proxy, 'demo.lorzen.de:8443'), /403/);
  assert.match(await tunnel(guarded.proxy, 'demo.lorzen.de:443'), /200/);
  assert.deepEqual(connections, [{ host: '8.8.8.8', family: 4, port: 443 }]);
  assert.match(await tunnel(guarded.proxy, 'demo.lorzen.de:443'), /403/);
  assert.equal(connections.length, 1, 'rebinding must never open the private connection');
});
