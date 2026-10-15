import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAllInklService, kasDomainNames, kasRows, parseKasSoap } from '../lib/allinkl.mjs';
import { renderAllInklWorkspace } from '../lib/allinkl-ui.mjs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const entry = (key, value) => '<item><key>' + key + '</key><value>' + value + '</value></item>';
const row = fields =>
  '<item xsi:type="ns2:Map">' +
  Object.entries(fields)
    .map(([key, value]) => entry(key, String(value)))
    .join('') +
  '</item>';
const envelope = (response, info = '') =>
  '<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns2="http://xml.apache.org/xml-soap">' +
  '<SOAP-ENV:Body><ns1:KasApiResponse xmlns:ns1="urn:xmethodsKasApi"><return xsi:type="ns2:Map">' +
  entry('Response', entry('ReturnString', response) + entry('ReturnInfo', info)) +
  entry('KasFloodDelay', '5') +
  '</return></ns1:KasApiResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>';

const domains = row({ domain_name: 'example.de' }) + row({ domain_name: 'second.example' });
const dns = row({
  record_id: '123',
  record_name: '',
  record_type: 'A',
  record_data: '192.0.2.1',
  record_aux: 0,
  record_changeable: 'N'
});

test('KAS SOAP response nested in Response returns domain rows, not KasFloodDelay', () => {
  let floodDelay = null;
  assert.deepEqual(
    kasRows(
      parseKasSoap(envelope('TRUE', domains), {
        onFloodDelay: ms => {
          floodDelay = ms;
        }
      })
    ),
    [{ domain_name: 'example.de' }, { domain_name: 'second.example' }]
  );
  assert.equal(floodDelay, 5000);
  assert.deepEqual(kasRows(parseKasSoap(envelope('TRUE'))), []);
  assert.throws(() => parseKasSoap(envelope('FALSE', 'invalid_credentials')), /abgelehnt/);
});

test('account domain names are normalized and invalid SOAP values are ignored', () => {
  assert.deepEqual(
    kasDomainNames([
      { domain_name: 'Example.DE.' },
      { domain_name: 'example.de' },
      { domain: 'second.example' },
      { domain_name: 'not a valid domain' }
    ]),
    ['example.de', 'second.example']
  );
});

test('stored KAS account supports read-only domain and DNS discovery without modifications', async () => {
  const called = [];
  const id = '11111111-1111-4111-8111-111111111111';
  const db = {
    async query(sql) {
      if (!sql.includes('SELECT * FROM hosting_accounts')) throw new Error('Unexpected SQL operation');
      return [[{ id, provider: 'allinkl', login: 'w0137d60', encrypted_credentials: 'encrypted' }]];
    }
  };
  const service = createAllInklService({
    db,
    encrypt: value => value,
    decrypt: () => ({ password: 'test-password' }),
    profiles: {},
    connectSite: () => {},
    kasDelayMs: 0,
    request: async (_url, options) => {
      const action = JSON.parse(options.body.match(/<Params[^>]*>(.*?)<\/Params>/s)[1].replaceAll('&quot;', '"'));
      called.push(action.kas_action);
      let body;
      switch (action.kas_action) {
        case 'get_domains':
          body = domains;
          break;
        case 'get_dns_settings':
          assert.equal(action.KasRequestParams.zone_host, 'example.de.');
          body = dns;
          break;
        case 'get_subdomains':
          body = row({ subdomain_name: 'www.example.de' });
          break;
        default:
          throw new Error('Unexpected mutating KAS action: ' + action.kas_action);
      }
      return { ok: true, text: async () => envelope('TRUE', body) };
    }
  });
  assert.deepEqual(kasDomainNames(await service.domains(id)), ['example.de', 'second.example']);
  assert.deepEqual(await service.records(id, 'example.de'), [
    {
      id: '123',
      name: '',
      type: 'A',
      value: '192.0.2.1',
      priority: '0',
      changeable: false,
      deleteable: true
    }
  ]);
  await assert.rejects(() => service.records(id, 'foreign.example'), /nicht vorhanden/);
  const check = await service.diagnostics(id, 'example.de');
  assert.equal(check.domainCount, 2);
  assert.equal(check.subdomainsOk, true);
  assert.equal(check.dnsOk, true);
  assert.equal(check.dnsRecordCount, 1);
  assert.ok(called.every(action => action.startsWith('get_')));
});

test('hosting UI shows KAS domain select and no manual DNS zone input', async () => {
  const html = renderAllInklWorkspace(
    [{ id: '11111111-1111-4111-8111-111111111111', name: 'Test', login: 'w0137d60', profileId: 'p' }],
    [],
    value => String(value)
  );
  assert.match(html, /id="allinklDomainSelect"/);
  assert.match(html, /id="allinklConnectionCheck"/);
  assert.doesNotMatch(html, /name="zone"[^>]*type="text"|placeholder="meine-domain.de"/);
  const script = await readFile(new URL('../public/allinkl.js', import.meta.url), 'utf8');
  assert.match(script, /\/domains'/);
  assert.match(script, /\/diagnostics'/);
  assert.match(script, /load\.requestSubmit\(\)/);
  execFileSync(process.execPath, ['--check', new URL('../public/allinkl.js', import.meta.url).pathname]);
});
