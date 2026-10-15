import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  allinklAccountSchema,
  createKasClient,
  parseKasSoap,
  kasRows,
  normalizeHost,
  splitSubdomain
} from '../lib/allinkl.mjs';

const map = entries =>
  '<item xsi:type="ns2:Map">' +
  Object.entries(entries)
    .map(
      ([key, value]) =>
        '<item><key xsi:type="xsd:string">' +
        key +
        '</key>' +
        '<value xsi:type="xsd:string">' +
        value +
        '</value></item>'
    )
    .join('') +
  '</item>';
const envelope = info =>
  '<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:ns2="http://xml.apache.org/xml-soap"><SOAP-ENV:Body><ns1:KasApiResponse xmlns:ns1="urn:xmethodsKasApi">' +
  '<return xsi:type="ns2:Map"><item><key>ReturnString</key><value>TRUE</value></item>' +
  '<item><key>ReturnInfo</key><value>' +
  info +
  '</value></item></return>' +
  '</ns1:KasApiResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>';

test('KAS SOAP Map and ReturnInfo list are parsed without leaking XML', () => {
  const xml = envelope(map({ domain_name: 'example.de' }) + map({ domain_name: 'example.com' }));
  assert.deepEqual(kasRows(parseKasSoap(xml)), [{ domain_name: 'example.de' }, { domain_name: 'example.com' }]);
});
test('KAS SOAP mutation success is accepted', () => {
  const xml = envelope('');
  assert.deepEqual(kasRows(parseKasSoap(xml)), []);
});
test('KAS SOAP faults do not include raw XML or auth payload', () => {
  const secret = 'top-secret-not-to-be-shown';
  const xml =
    '<SOAP-ENV:Envelope><SOAP-ENV:Body><SOAP-ENV:Fault>' +
    '<faultstring>zone_not_found</faultstring><detail>' +
    secret +
    '</detail>' +
    '</SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>';
  assert.throws(() => parseKasSoap(xml), /zone_not_found/);
  try {
    parseKasSoap(xml);
  } catch (error) {
    assert.ok(!error.message.includes(secret));
  }
});
test('KAS logins accept letters after the w prefix and reject invalid characters', () => {
  const account = {
    name: 'Test',
    password: 'not-a-live-password',
    profileId: '11111111-1111-4111-8111-111111111111'
  };
  for (const login of ['w0123456', 'w0137d60', 'W01ABC56']) {
    assert.equal(allinklAccountSchema.safeParse({ ...account, login }).success, true, login);
    assert.doesNotThrow(() => createKasClient({ login, password: account.password, request: async () => ({}) }));
  }
  for (const login of ['w1234', 'w12-456', 'w012 456', 'w01234/6', 'x0137d60', 'w12345678901']) {
    assert.equal(allinklAccountSchema.safeParse({ ...account, login }).success, false, login);
    assert.throws(() => createKasClient({ login, password: account.password, request: async () => ({}) }));
  }
});

test('alphanumeric KAS login reaches the API request without local rejection', async () => {
  let requestBody = '';
  const kas = createKasClient({
    login: 'w0137d60',
    password: 'test-password',
    delayMs: 0,
    request: async (_url, options) => {
      requestBody = options.body;
      return { ok: true, text: async () => envelope('') };
    }
  });
  await kas.call('get_domains');
  assert.match(requestBody, /w0137d60/);
});

test('host names are validated and only account subdomains are accepted', () => {
  assert.deepEqual(splitSubdomain('test.example.de', [{ domain_name: 'example.de' }]), {
    parent: 'example.de',
    label: 'test'
  });
  assert.equal(normalizeHost('example.de.'), 'example.de');
  assert.throws(() => normalizeHost('exampleXde'));
  assert.throws(() => splitSubdomain('example.de', [{ domain_name: 'example.de' }]));
  assert.throws(() => splitSubdomain('test.other.de', [{ domain_name: 'example.de' }]));
});
test('SOAP calls use the official endpoint with XML-escaped JSON, not interpolated XML', async () => {
  let captured;
  const req = async (url, options) => {
    captured = { url, options };
    return { ok: true, text: async () => envelope('') };
  };
  const kas = createKasClient({ login: 'w0123456', password: 'secret<&>', request: req, delayMs: 0 });
  await kas.call('add_subdomain', {
    subdomain_name: 'test',
    domain_name: 'example.de',
    subdomain_path: '/www/test/public/'
  });
  assert.equal(captured.url, 'https://kasapi.kasserver.com/soap/KasApi.php');
  assert.match(captured.options.body, /kas_action/);
  assert.match(captured.options.body, /add_subdomain/);
  assert.match(captured.options.body, /secret&lt;&amp;&gt;/);
  assert.equal(captured.options.headers.SOAPAction, 'urn:xmethodsKasApi#KasApi');
  await assert.rejects(() => kas.call('delete_database', {}), /Nicht freigegebene/);
});
