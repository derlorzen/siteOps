import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAllInklSslService, sslDnsName, inspectCertificate, waitForDnsTxt, allinklSslRequestSchema } from '../lib/allinkl-ssl.mjs';
import { createKasClient } from '../lib/allinkl.mjs';

const cert = "-----BEGIN CERTIFICATE-----\nMIIBszCCAVqgAwIBAgIUPbkUWw/SdSOXkyMbutRmQDMqdNQwCgYIKoZIzj0EAwIw\nHzEdMBsGA1UEAwwUY29udGFpbmVyLmV4YW1wbGUuZGUwHhcNMjYxMDE2MTMzNDQ3\nWhcNMjcxMDE2MTMzNDQ3WjAfMR0wGwYDVQQDDBRjb250YWluZXIuZXhhbXBsZS5k\nZTBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABMAJo+cW8YjhjUFqbxmkqxqQNhA3\nKLKFhvSa8/CqaGdlFcMhB7wHbse/MtcXrfFGG7LEYv9rVDmVL/dviGkIVuGjdDBy\nMB0GA1UdDgQWBBSsWRbGE67ylyHJv3WXqauJ8yhygjAfBgNVHSMEGDAWgBSsWRbG\nE67ylyHJv3WXqauJ8yhygjAPBgNVHRMBAf8EBTADAQH/MB8GA1UdEQQYMBaCFGNv\nbnRhaW5lci5leGFtcGxlLmRlMAoGCCqGSM49BAMCA0cAMEQCIExTtCdwr4l8Ilir\n9nwhxm+xzWheUapTF1dgUyNNUbpkAiBPd/J5+UhlijJt1HeKG4s2JBFMt2OY0S9B\nGq5q6ygFVA==\n-----END CERTIFICATE-----";
const key = "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg0j8hLBTxVADcFox+\nZZ/tEW6YyZwgWPSlhW37HhMAvKmhRANCAATACaPnFvGI4Y1Bam8ZpKsakDYQNyiy\nhYb0mvPwqmhnZRXDIQe8B27HvzLXF63xRhuyxGL/a1Q5lS/3b4hpCFbh\n-----END PRIVATE KEY-----";
const accountId = '11111111-1111-4111-8111-111111111111';
const host = 'container.example.de';

test('ACME uses only the owned subdomain DNS-01 name', () => {
  assert.deepEqual(sslDnsName(host, ['example.de']), {
    zone: 'example.de', relative: '_acme-challenge.container', fqdn: '_acme-challenge.container.example.de'
  });
  assert.throws(() => sslDnsName('other.example.net', ['example.de']), /Subdomain gehört/);
  assert.equal(allinklSslRequestSchema.safeParse({ accountId, hostname: host, email: 'admin@example.de' }).success, true);
  assert.equal(allinklSslRequestSchema.safeParse({ accountId, hostname: 'other.test', email: 'bad' }).success, false);
});

test('only matching X.509 certificate and private key can be submitted', () => {
  const details = inspectCertificate({ hostname: host, certificate: cert, privateKey: key });
  assert.match(details.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(details.leaf.trim(), cert);
  assert.ok(details.expiresAt.getTime() > Date.now());
  assert.throws(() => inspectCertificate({ hostname: 'unfall.example.de', certificate: cert, privateKey: key }),
    /gilt nicht/);
  assert.throws(() => inspectCertificate({ hostname: host, certificate: cert,
    privateKey: '-----BEGIN PRIVATE KEY-----\\ninvalid\\n-----END PRIVATE KEY-----' }));
});

test('DNS-01 checks actual published TXT, not merely KAS success', async () => {
  let checks = 0;
  await waitForDnsTxt('_acme-challenge.container.example.de', 'answer', {
    resolveTxt: async () => {
      checks++;
      return checks === 1 ? [['other']] : [['ans', 'wer']];
    },
    sleep: async () => {},
    timeoutMs: 1000
  });
  assert.equal(checks, 2);
  await assert.rejects(
    () => waitForDnsTxt('_acme-challenge.container.example.de', 'answer', {
      resolveTxt: async () => [['wrong']], sleep: async () => {}, timeoutMs: 5
    }),
    /nicht öffentlich sichtbar/
  );
});

function memoryDb() {
  const records = new Map();
  const state = { records, resumed: [] };
  const connection = {
    query: async () => [[{ acquired: 1 }]], release() {}
  };
  const db = {
    async getConnection() { return connection; },
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.startsWith('select * from allinkl_ssl_certificates where hostname')) return [[records.get(params[0])].filter(Boolean)];
      if (text.startsWith('select hostname,account_id,state')) return [[...records.values()]];
      if (text.startsWith('insert into allinkl_ssl_certificates')) {
        const [,accountId,hostname,email,initialState,autoRenew] = params;
        const row = records.get(hostname) || { hostname,account_id:accountId,created_at:new Date() };
        row.email = email; row.state = initialState; row.auto_renew=autoRenew;
        records.set(hostname,row);return [{affectedRows:1}];
      }
      if (text.startsWith('update allinkl_ssl_certificates')) {
        const hostName = params[params.length-1], row = records.get(hostName);
        if (!row) throw new Error('missing row');
        if (text.includes("state='issuing'")) {row.state='issuing';row.last_attempt_at=new Date();}
        else if (text.includes("state='installing'")) {
          [row.account_key_encrypted,row.private_key_encrypted,row.certificate_pem,row.chain_pem,row.fingerprint_sha256,row.expires_at]=params;
          row.state='installing';
        } else if (text.includes("state='pending'")) row.state='pending';
        else if (text.includes("state='active'")) row.state='active';
        else if (text.includes("state='failed'")){row.state='failed';row.last_error=params[0];}
        return [{affectedRows:1}];
      }
      if (text.startsWith('select hostname,state from allinkl_ssl_certificates')) return [[...records.values()].filter(r=>r.state==='pending').map(r=>({hostname:r.hostname,state:r.state}))];
      if (text.startsWith('select j.id from cms_jobs'))return [[{id:'cms-job'}]];
      if (text.startsWith('update cms_jobs')) {state.resumed.push(params[0]);return [{affectedRows:1}];}
      throw new Error('Unexpected SQL: '+sql);
    }
  };
  return {db,state};
}

test('SSL workflow stores keys encrypted, updates KAS, cleans only its TXT, and resumes pending CMS after TLS appears', async () => {
  const {db,state} = memoryDb();
  let txtCreated = false, txtDeleted = false, installed = false, tlsReady = false;
  let checkedFqdn;
  let managedKey;
  const encrypted = value => 'encrypted:' + Buffer.from(value).toString('base64');
  const decrypt = value => Buffer.from(value.slice(10), 'base64').toString();
  const expectedFingerprint = inspectCertificate({hostname:host,certificate:cert,privateKey:key}).fingerprint;
  const service = createAllInklSslService({
    db, encrypt: encrypted, decrypt,
    allInklService: {
      domains: async () => [{domain_name:'example.de'}],
      subdomains: async () => [{subdomain_name:host}],
      addRecord: async (_id, r) => {assert.equal(r.name,'_acme-challenge.container');assert.equal(r.value,'test-txt');txtCreated=true;},
      records: async () => txtCreated&&!txtDeleted ? [{id:'challenge-123',name:'_acme-challenge.container',type:'TXT',value:'test-txt'}, {id:'do-not-remove',name:'www',type:'TXT',value:'other'}] : [],
      removeRecord: async (_id,_zone,recordId) => { assert.equal(recordId,'challenge-123');txtDeleted=true;},
      installCertificate: async (_id,hostname,pems) => {assert.equal(hostname,host); assert.equal(pems.privateKey,key);installed=true;}
    },
    issuer: async ({accountKey,addTxt,removeTxt,checkTxt}) => {
      assert.equal(accountKey,null);
      await addTxt('test-txt');
      await checkTxt('test-txt');
      await removeTxt('test-txt');
      managedKey='account-only-test';
      return {accountKey:managedKey,privateKey:key,certificate:cert};
    },
    tlsCheck: async () => tlsReady ? {ok:true,fingerprint:expectedFingerprint} : {ok:false},
    dnsCheck: async (fqdn,value) => { checkedFqdn=fqdn; assert.equal(value,'test-txt');}
  });
  const queued = await service.enqueue({accountId,hostname:host,email:'admin@example.de'});
  assert.equal(queued.state,'queued');
  const issued = await service.issue(host);
  assert.equal(issued.state,'pending');
  assert.equal(installed,true);
  assert.equal(txtDeleted,true);
  assert.equal(checkedFqdn,'_acme-challenge.container.example.de');
  const stored=state.records.get(host);
  assert.ok(stored.private_key_encrypted.startsWith('encrypted:'));
  assert.ok(!JSON.stringify(await service.list()).includes(key));
  assert.ok(!JSON.stringify(issued).includes(managedKey));
  tlsReady=true;
  await service.tick();
  assert.equal((await service.status(host)).state,'active');
  assert.deepEqual(state.resumed,['cms-job']);
});

test('the KAS client explicitly permits update_ssl but refuses unapproved actions', async () => {
  let reqBody;
  const client = createKasClient({login:'w0123456',password:'not-real',delayMs:0,
    request: async (_url,options) => {reqBody=options.body;return {ok:true,text:async()=>'<return><item><key>ReturnString</key><value>TRUE</value></item></return>'};}
  });
  await client.call('update_ssl',{hostname:host,ssl_certificate_sni_crt:cert,ssl_certificate_sni_key:key});
  assert.match(reqBody,/update_ssl/);
  await assert.rejects(() => client.call('create_ftp_account'),/Nicht freigegebene/);
});
