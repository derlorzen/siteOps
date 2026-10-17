import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAllInklService } from '../lib/allinkl.mjs';

const entry = (key, value) => '<item><key>' + key + '</key><value>' + value + '</value></item>';
const row = fields =>
  '<item xsi:type="ns2:Map">' +
  Object.entries(fields)
    .map(([key, value]) => entry(key, String(value)))
    .join('') +
  '</item>';
const envelope = info =>
  '<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" ' +
  'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:ns2="http://xml.apache.org/xml-soap">' +
  '<SOAP-ENV:Body><ns1:KasApiResponse xmlns:ns1="urn:xmethodsKasApi"><return xsi:type="ns2:Map">' +
  entry('Response', entry('ReturnString', 'TRUE') + entry('ReturnInfo', info)) +
  '</return></ns1:KasApiResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>';

test('ALL-INKL corrects a legacy KAS path only for a verified SiteOps installation in a domain-jailed FTP account', async () => {
  const accountId = '11111111-1111-4111-8111-111111111111';
  const root = '/siteops-websites/container-lorzen-de';
  const actual = '/lorzen.de/siteops-websites/container-lorzen-de/public';
  let mapping = root + '/public';
  let updates = 0;
  const service = createAllInklService({
    db: {
      async query(sql, args) {
        if (sql.includes('FROM hosting_accounts'))
          return [
            [{ id: accountId, login: 'w0137d60', encrypted_credentials: 'encrypted', server_profile_id: accountId }]
          ];
        if (sql.includes('FROM sites') && args[0] === 'lorzen.de') return [[{ id: 'parent' }]];
        if (sql.includes('FROM sites') && args[0] === 'container.lorzen.de') return [[{ id: 'child' }]];
        throw new Error('Unexpected SQL: ' + sql);
      }
    },
    encrypt: value => value,
    decrypt: () => ({ password: 'test-password' }),
    profiles: {
      resolve: async () => ({
        protocol: 'ftp',
        host: 'example.kasserver.com',
        port: 21,
        username: 'ftp-user',
        password: 'not-a-real-password'
      })
    },
    connectSite: async () => ({
      async list(folder) {
        if (folder === root) return [{ name: 'public' }, { name: 'config' }, { name: '.lorzcms' }];
        if (folder === root + '/public') return [{ name: 'siteops.php' }, { name: 'index.php' }];
        if (folder === root + '/.lorzcms') return [{ name: 'owner.json' }];
        throw new Error('Unexpected folder: ' + folder);
      },
      async ensureDirectory() {},
      async close() {}
    }),
    kasDelayMs: 0,
    request: async (_url, options) => {
      const payload = JSON.parse(options.body.match(/<Params[^>]*>(.*?)<\/Params>/s)[1].replaceAll('&quot;', '"'));
      const params = payload.KasRequestParams || {};
      switch (payload.kas_action) {
        case 'get_domains':
          return {
            ok: true,
            text: async () => envelope(row({ domain_name: 'lorzen.de', domain_path: '/lorzen.de/' }))
          };
        case 'get_subdomains':
          return {
            ok: true,
            text: async () => envelope(row({ subdomain_name: 'container.lorzen.de', subdomain_path: mapping }))
          };
        case 'update_subdomain':
          assert.equal(params.subdomain_name, 'container.lorzen.de');
          assert.equal(params.subdomain_path, actual + '/');
          mapping = params.subdomain_path;
          updates += 1;
          return { ok: true, text: async () => envelope('') };
        default:
          throw new Error('Unexpected KAS action: ' + payload.kas_action);
      }
    }
  });
  const args = { accountId, baseUrl: 'https://container.lorzen.de', remoteRoot: root };
  const first = await service.provision(args);
  assert.equal(first.repaired, true);
  assert.equal(first.kasPublicPath, actual);
  const second = await service.provision(args);
  assert.equal(second.created, false);
  assert.equal(updates, 1);
});
