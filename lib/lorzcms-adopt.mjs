import crypto from 'node:crypto';
import { joinRemote } from './crypto.mjs';

const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const ownerPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const same = (a, b) => a === null ? b === null : b !== null && a.equals(b);

export function cmsAdoptError(message, code = 'CMS_ADOPT_REPAIR') {
  return Object.assign(new Error(message), { cmsCode: code });
}

export function connectorOwners(config, marker) {
  const owners = new Set();
  let unknown = false;
  const add = id => {
    if (typeof id === 'string' && ownerPattern.test(id)) owners.add(id.toLowerCase());
    else unknown = true;
  };
  if (config !== null) {
    const matches = [...config.toString().matchAll(/['"]instance_id['"]\s*=>\s*['"]([^'"]+)['"]/g)];
    if (matches.length !== 1) unknown = true;
    for (const match of matches) add(match[1]);
  }
  if (marker !== null) {
    try {
      add(JSON.parse(marker.toString()).instanceId);
    } catch {
      unknown = true;
    }
  }
  return { owners: [...owners].sort(), unknown };
}

export function cmsAgentHttpError(status) {
  const tips = {
    401: 'Schlüssel stimmt nicht. Bestehenden Anschluss mit cms_job_retry reparieren; bei abweichendem Eigentümer Übernahme bestätigen.',
    404: 'Agent oder config/siteops.php fehlt. FTP-Projektwurzel und Zuordnung der Domain prüfen; Anschluss mit cms_job_retry reparieren.',
    422: 'Document-Root muss auf public/ zeigen. Im Hosting-Panel korrigieren, dann cms_job_retry ausführen.',
    403: 'HTTPS und Weitergabe des Authorization-Headers prüfen.'
  };
  const error = cmsAdoptError('CMS-Anschluss meldet HTTP ' + status + '. ' + (tips[status] || 'Domain-Ziel, PHP und CMS-Anschluss prüfen.'), 'CMS_AGENT_HTTP_' + status);
  error.agentStatus = status;
  return error;
}

async function readOptional(remote, path) {
  return await remote.exists(path) ? await remote.read(path) : null;
}

// No destination is removed before rename. Temporary filenames are unguessable and
// PHP files keep a PHP suffix. The caller must supply a real FTP/SFTP rename adapter.
async function replace(remote, path, before, after) {
  if (!same(await readOptional(remote, path), before)) {
    throw cmsAdoptError('CMS-Anschlussdatei wurde parallel verändert; erneut prüfen.');
  }
  if (after === null) {
    await remote.remove(path);
    if (await remote.exists(path)) throw cmsAdoptError('CMS-Anschlussdatei konnte nicht entfernt werden.');
    return;
  }
  const temp = path + '.siteops-' + crypto.randomUUID() + (path.endsWith('.php') ? '.php' : '.tmp');
  try {
    await remote.write(temp, after);
    if (!same(await remote.read(temp), after)) throw cmsAdoptError('CMS-Anschlussdatei wurde nicht unverändert übertragen.');
    if (!same(await readOptional(remote, path), before)) throw cmsAdoptError('CMS-Anschlussdatei wurde parallel verändert; erneut prüfen.');
    await remote.rename(temp, path);
    if (!same(await remote.read(path), after)) throw cmsAdoptError('CMS-Anschlussdatei konnte nicht verifiziert werden.');
  } finally {
    if (await remote.exists(temp)) await remote.remove(temp);
  }
}

// Verify that FTP really reaches this particular HTTPS origin. A copied file hash
// is not sufficient. The random non-secret marker is removed before key rotation.
export async function proveAdoptTarget({ remote, root, origin, otherOrigins = [], request }) {
  const nonce = crypto.randomUUID();
  const relative = '.well-known/acme-challenge/siteops-adopt-' + nonce;
  const target = joinRemote(root, 'public/' + relative);
  const marker = Buffer.from('siteops-adopt:' + nonce);
  const matches = async url => {
    const response = await request(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers: { 'cache-control': 'no-store' } });
    if (response.status !== 200) {
      await response.body?.cancel();
      return false;
    }
    // Compare a bounded body (a wrong mapping may serve a large HTML document).
    const reader = response.body?.getReader();
    if (!reader) return false;
    let length = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > marker.length) return false;
        chunks.push(Buffer.from(value));
      }
      return Buffer.concat(chunks).equals(marker);
    } finally {
      await reader.cancel();
    }
  };
  if (await remote.exists(target)) throw cmsAdoptError('Prüfdatei existiert bereits; erneut versuchen.');
  try {
    await remote.write(target, marker);
    if (!same(await remote.read(target), marker)) throw cmsAdoptError('FTP-Prüfdatei konnte nicht verifiziert werden.');
    if (!(await matches(origin + '/' + relative))) {
      if (await matches(origin + '/public/' + relative)) throw cmsAgentHttpError(422);
      throw cmsAdoptError('FTP-Ziel und HTTPS-Domain stimmen nicht nachweisbar überein. FTP-Zugang, Projektwurzel, public/-Document-Root und ACME-Dateiauslieferung prüfen.', 'CMS_TARGET_MISMATCH');
    }
    for (const other of new Set(otherOrigins.filter(value => value !== origin))) {
      if (await matches(other + '/' + relative)) {
        throw cmsAdoptError('FTP-Ziel wird auch von einer anderen verwalteten CMS-Website ausgeliefert. Website-Zuordnung trennen, bevor der Schlüssel ersetzt wird.', 'CMS_SHARED_TARGET');
      }
    }
  } finally {
    if (await remote.exists(target)) {
      if (!same(await remote.read(target), marker)) throw cmsAdoptError('FTP-Prüfdatei wurde parallel verändert.');
      await remote.remove(target);
      if (await remote.exists(target)) throw cmsAdoptError('FTP-Prüfdatei konnte nicht entfernt werden.');
    }
  }
}

// Only connector files are touched. The active pointer, application, database,
// local config and editorial files remain unchanged. A failure restores exact
// bytes (or the absence of a previously missing file).
export async function repairAdoptConnector({ remote, root, instanceId, key, files, confirmedOwners = [], proveTarget, verify }) {
  const configPath = 'config/siteops.php';
  const ownerPath = '.lorzcms/owner.json';
  const hash = sha(key);
  const expected = new Map([
    ...files,
    [configPath, Buffer.from("<?php\nreturn ['instance_id'=>'" + instanceId + "','key_hash'=>'" + hash + "'];\n")],
    [ownerPath, Buffer.from(JSON.stringify({ instanceId }))]
  ]);
  const previous = new Map();
  for (const path of expected.keys()) previous.set(path, await readOptional(remote, joinRemote(root, path)));
  const detected = connectorOwners(previous.get(configPath), previous.get(ownerPath));
  const foreign = detected.owners.filter(id => id !== instanceId.toLowerCase());
  if (detected.unknown) foreign.push('unbekannt');
  if (foreign.length && (foreign.length !== confirmedOwners.length || foreign.some(id => !confirmedOwners.includes(id)))) {
    const error = cmsAdoptError('Dateien stammen von Installation ' + foreign.join(', ') + '. Schlüssel wird ersetzt, wenn du diesen Auftrag erneut startest. Vorher FTP-Ziel prüfen.', 'CMS_FOREIGN_OWNER');
    error.foreignOwners = foreign;
    throw error;
  }
  // An already valid connector needs no writes. Preserve its exact configuration.
  const config = previous.get(configPath)?.toString() || '';
  const keyMatches = [...config.matchAll(/['"]key_hash['"]\s*=>\s*['"]([a-f0-9]{64})['"]/g)];
  const configMatches = detected.owners.includes(instanceId.toLowerCase()) &&
    connectorOwners(previous.get(configPath), null).owners.includes(instanceId.toLowerCase()) &&
    keyMatches.length === 1 && keyMatches[0][1] === hash && !detected.unknown;
  const ownerMatches = connectorOwners(null, previous.get(ownerPath)).owners.includes(instanceId.toLowerCase());
  if (!foreign.length && configMatches && ownerMatches && [...files.keys()].every(path => previous.get(path) !== null)) {
    return verify();
  }
  await proveTarget();
  if (typeof remote.rename !== 'function') throw cmsAdoptError('FTP/SFTP-Verbindung unterstützt keine sichere Dateiumbenennung.');
  const changed = [];
  try {
    for (const [path, bytes] of expected) {
      const old = previous.get(path);
      if (same(old, bytes)) continue;
      changed.push(path);
      await replace(remote, joinRemote(root, path), old, bytes);
    }
    return await verify();
  } catch (error) {
    let rollbackFailed = false;
    for (const path of changed.reverse()) {
      try {
        const target = joinRemote(root, path);
        const old = previous.get(path);
        const current = await readOptional(remote, target);
        if (same(current, old)) continue;
        if (!same(current, expected.get(path))) throw cmsAdoptError('Parallele Änderung erkannt.');
        await replace(remote, target, current, old);
      } catch {
        rollbackFailed = true;
      }
    }
    if (rollbackFailed) throw cmsAdoptError('Anschlussreparatur fehlgeschlagen; Rücksicherung nicht vollständig verifiziert. CMS-Anschlussdateien vor erneutem Start prüfen.', 'CMS_ADOPT_ROLLBACK_FAILED');
    throw error;
  }
}
