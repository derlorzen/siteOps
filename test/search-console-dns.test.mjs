import test from 'node:test';
import assert from 'node:assert/strict';
import { dnsAuthority, createSearchConsoleDns, googleTxt } from '../lib/search-console-dns.mjs';
import { txt, accountId } from './search-console-fixture.mjs';
import { createAllInklService } from '../lib/allinkl.mjs';

test('DNS authority follows nearest delegation and refuses mixed/unknown nameservers', async () => {
  const ns = async domain => {
    if (domain === 'sub.example.com') throw Object.assign(new Error(), { code: 'ENODATA' });
    return ['ns1.kasserver.com.', 'ns2.kasserver.com.'];
  };
  assert.equal((await dnsAuthority('sub.example.com', ns)).zone, 'example.com');
  const child = await dnsAuthority('sub.example.com', async () => ['ns1.dns-parking.com', 'ns2.dns-parking.com']);
  assert.equal(child.zone, 'sub.example.com');
  assert.equal(child.provider, 'hostinger');
  for (const servers of [
    ['ns1.kasserver.com', 'ns.external.net'],
    ['ns1.kasserver.com.evil.net'],
    ['dns.external.net']
  ])
    await assert.rejects(
      dnsAuthority('example.com', async () => servers),
      { statusCode: 409 }
    );
  await assert.rejects(
    dnsAuthority('example.com', async () => {
      throw Object.assign(new Error(), { code: 'ETIMEOUT' });
    })
  );
  assert.equal(googleTxt('v=spf1'), false);
});

test('ALL-INKL apex TXT is additive, idempotent, conflict checked and authority rechecked', async () => {
  let records = [{ name: '@', type: 'TXT', value: 'v=spf1 include:mail.example.net ~all' }],
    provider = 'allinkl';
  const writes = [];
  const dns = createSearchConsoleDns({
    allInklService: { records: async () => records, addGoogleVerificationTxt: async (...args) => writes.push(args) },
    authority: async () => ({ zone: 'example.com', provider, servers: ['ns1.kasserver.com'] })
  });
  const p = await dns.inspect('example.com', txt, accountId);
  assert.equal(p.name, '@');
  assert.equal(p.action, 'append');
  assert.equal(writes.length, 0);
  await dns.apply(p);
  assert.deepEqual(writes, [[accountId, 'example.com', txt]]);
  records.push({ name: 'example.com.', type: 'TXT', value: '"' + txt + '"' });
  await dns.apply(p);
  assert.equal(writes.length, 1);
  records = [{ name: '@', type: 'CNAME', value: 'other.example.net' }];
  await assert.rejects(dns.apply(p), /CNAME/);
  assert.equal(writes.length, 1);
  records = [];
  provider = 'hostinger';
  await assert.rejects(dns.apply(p));
  assert.equal(writes.length, 1);
});

test('Hostinger checks credentials and zone access, appends only Google TXT and preserves TXT TTL', async () => {
  const calls = [];
  const dns = createSearchConsoleDns({
    authority: async () => ({ zone: 'example.com', provider: 'hostinger', servers: ['ns1.dns-parking.com'] }),
    hostingerToken: async () => 'test-token',
    fetcher: async (url, init) => {
      calls.push({ url, init });
      return init.method === 'GET'
        ? Response.json([
            { name: '@', type: 'TXT', ttl: 14400, records: [{ content: 'v=spf1 ~all', is_disabled: false }] }
          ])
        : Response.json({ message: 'Request accepted' });
    }
  });
  const p = await dns.inspect('example.com', txt);
  await dns.apply(p);
  const write = calls.at(-1);
  assert.equal(write.init.method, 'PUT');
  assert.equal(write.url, 'https://developers.hostinger.com/api/dns/v1/zones/example.com');
  assert.deepEqual(JSON.parse(write.init.body), {
    overwrite: false,
    zone: [{ name: '@', type: 'TXT', ttl: 14400, records: [{ content: txt }] }]
  });
  const denied = createSearchConsoleDns({
    authority: async () => ({ provider: 'hostinger', zone: 'example.com' }),
    hostingerToken: async () => 'test-token',
    fetcher: async () => Response.json({}, { status: 403 })
  });
  await assert.rejects(denied.inspect('example.com', txt), /403/);
});

test('TXT visibility requires consensus of public authoritative servers and joins split TXT chunks', async () => {
  let visible = true,
    privateCalls = 0;
  const servers = [];
  const dns = createSearchConsoleDns({
    authority: async () => ({ zone: 'example.com', servers: ['ns1.kasserver.com', 'ns2.kasserver.com'] }),
    addresses: async () => [{ address: '8.8.8.8' }],
    resolver: () => ({
      setServers: ips => servers.push(ips),
      resolveTxt: async () => (visible ? [[txt.slice(0, 20), txt.slice(20)]] : [['other']])
    })
  });
  assert.equal(await dns.present('example.com', txt), true);
  assert.equal(servers.length, 2);
  visible = false;
  assert.equal(await dns.present('example.com', txt), false);
  const privateDns = createSearchConsoleDns({
    authority: async () => ({ servers: ['private.invalid'] }),
    addresses: async () => {
      throw new Error('private IP');
    },
    resolver: () => {
      privateCalls++;
    }
  });
  await assert.rejects(privateDns.present('example.com', txt), /private IP/);
  assert.equal(privateCalls, 0);
});

test('real KAS adapter permits only the narrow Google TXT exception at the protected apex', async () => {
  const entry = (key, value) => '<item><key>' + key + '</key><value>' + value + '</value></item>';
  const row = fields =>
    '<item xsi:type="ns2:Map">' +
    Object.entries(fields)
      .map(([k, v]) => entry(k, v))
      .join('') +
    '</item>';
  const soap = info =>
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns2="http://xml.apache.org/xml-soap"><SOAP-ENV:Body><KasApiResponse><return xsi:type="ns2:Map">' +
    entry('ReturnString', 'TRUE') +
    entry('ReturnInfo', info) +
    '</return></KasApiResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>';
  const actions = [];
  let records = [],
    servers = ['ns1.kasserver.com'];
  const service = createAllInklService({
    db: { query: async () => [[{ id: accountId, login: 'w0123456', encrypted_credentials: 'encrypted' }]] },
    decrypt: () => ({ password: 'test' }),
    encrypt: x => x,
    kasDelayMs: 0,
    nameservers: async () => servers,
    request: async (_url, options) => {
      const action = JSON.parse(options.body.match(/<Params[^>]*>(.*?)<\/Params>/s)[1].replaceAll('&quot;', '"'));
      actions.push(action);
      const info =
        action.kas_action === 'get_domains'
          ? row({ domain_name: 'example.com' })
          : action.kas_action === 'get_dns_settings'
            ? records.map(row).join('')
            : '';
      return { ok: true, text: async () => soap(info) };
    }
  });
  await assert.rejects(
    service.addRecord(accountId, { zone: 'example.com', name: '@', type: 'TXT', value: txt }),
    /geschützt/
  );
  await assert.rejects(service.addGoogleVerificationTxt(accountId, 'example.com', 'v=spf1'), /Ungültiger/);
  await service.addGoogleVerificationTxt(accountId, 'example.com', txt);
  const mutation = actions.find(a => a.kas_action === 'add_dns_settings');
  assert.deepEqual(mutation.KasRequestParams, {
    zone_host: 'example.com.',
    record_type: 'TXT',
    record_name: '',
    record_data: txt,
    record_aux: 0
  });
  records = [{ record_type: 'TXT', record_name: '', record_data: txt }];
  await service.addGoogleVerificationTxt(accountId, 'example.com', txt);
  assert.equal(actions.filter(a => a.kas_action === 'add_dns_settings').length, 1);
  records = [{ record_type: 'CNAME', record_name: '', record_data: 'other.example.net' }];
  await assert.rejects(service.addGoogleVerificationTxt(accountId, 'example.com', txt), /CNAME/);
  servers = ['ns.external.net'];
  await assert.rejects(service.addGoogleVerificationTxt(accountId, 'example.com', txt), /autoritative/);
});
