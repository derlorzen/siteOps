import { posix as path } from "node:path";

const normalizePath = (value) =>
  path.normalize(String(value || "")).replace(/\/+$/, "") || "/";
const markerPath = (root) =>
  path.join(root, ".lorzcms/domain-move.request.json");
const validHost = (value) => /^(?!-)[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(value);

// A handoff is possible only between two recorded websites in the same hosting
// account: a backed-up static source and an already healthy, owned CMS target.
export async function inspectCmsDomainMove({
  db,
  remote,
  root,
  connection,
  hostname,
}) {
  const [targets] = await db.query(
    "SELECT s.*,c.id AS installation_id,c.base_url,c.version,c.agent_credentials FROM sites s JOIN cms_installations c ON c.site_id=s.id WHERE s.remote_root=? AND s.host=? AND s.username=? AND s.protocol=? AND c.state='ready'",
    [root, connection.host, connection.username, connection.protocol],
  );
  if (targets.length !== 1) return null;
  const target = targets[0];
  const [sources] = await db.query(
    "SELECT s.* FROM sites s LEFT JOIN cms_installations c ON c.site_id=s.id WHERE s.domain=? AND s.enabled=1 AND s.site_type='static' AND c.id IS NULL",
    [hostname],
  );
  if (
    sources.length !== 1 ||
    sources[0].id === target.id ||
    sources[0].host !== connection.host
  )
    return null;
  const source = sources[0];
  const [backups] = await db.query(
    "SELECT git_commit FROM backups WHERE site_id=? AND backup_type='full' AND created_at>=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 DAY) ORDER BY created_at DESC LIMIT 1",
    [source.id],
  );
  if (!backups.length || !/^[a-f0-9]{40}$/.test(backups[0].git_commit))
    return null;
  const owner = JSON.parse(
    (await remote.read(path.join(root, ".lorzcms/owner.json"))).toString(),
  );
  const active = JSON.parse(
    (await remote.read(path.join(root, ".lorzcms/active.json"))).toString(),
  );
  if (
    owner.instanceId !== target.installation_id ||
    active.version !== target.version
  )
    return null;
  const origin = new URL(target.base_url);
  if (
    origin.protocol !== "https:" ||
    !validHost(origin.hostname) ||
    origin.port ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/"
  )
    return null;
  return { source, target, backupCommit: backups[0].git_commit };
}

export async function moveCmsDomain({
  db,
  remote,
  root,
  hostname,
  kasPublicPath,
  currentPath,
  candidate,
  kas,
  decrypt,
  request = fetch,
}) {
  const { source, target, backupCommit } = candidate;
  const plan = {
    format: "siteops-cms-domain-move-v1",
    hostname,
    sourceSiteId: source.id,
    installationId: target.installation_id,
    expectedPreviousPath: normalizePath(currentPath),
    targetPublicPath: normalizePath(kasPublicPath),
  };
  const marker = markerPath(root);
  if (!(await remote.exists(marker)))
    return {
      ok: true,
      state: "planned",
      changed: false,
      requestFile: ".lorzcms/domain-move.request.json",
      request: plan,
      backupCommit,
      message:
        "Geprüfter Umzug einer gesicherten Website auf ihr vorbereitetes CMS. Den konkreten Auftrag als private Datei hinterlegen und provision erneut aufrufen.",
    };
  const intent = JSON.parse((await remote.read(marker)).toString());
  if (
    intent.format !== plan.format ||
    intent.hostname !== hostname ||
    intent.sourceSiteId !== source.id ||
    intent.installationId !== target.installation_id ||
    normalizePath(intent.targetPublicPath) !== plan.targetPublicPath ||
    typeof intent.expectedPreviousPath !== "string" ||
    intent.expectedPreviousPath === "/" ||
    !intent.expectedPreviousPath.startsWith("/") ||
    intent.expectedPreviousPath.includes("..") ||
    intent.expectedPreviousPath.includes("\\")
  ) {
    throw new Error(
      "CMS-Domainumzug: Auftrag passt nicht zu den verifizierten Websites. Keine Änderung.",
    );
  }
  const oldPath = normalizePath(intent.expectedPreviousPath);
  const current = normalizePath(currentPath);
  if (![oldPath, plan.targetPublicPath].includes(current))
    throw new Error(
      "CMS-Domainumzug: Domain-Ziel wurde inzwischen geändert. Keine Änderung.",
    );
  const key = decrypt(target.agent_credentials).key;
  if (!/^[a-f0-9]{64}$/.test(key || ""))
    throw new Error("CMS-Domainumzug: Anschluss nicht prüfbar.");
  async function agentAt(base) {
    try {
      const response = await request(base + "/siteops.php", {
        headers: { authorization: "Bearer " + key },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        return false;
      }
      const value = await response.json();
      return (
        value.instanceId === target.installation_id &&
        value.version === target.version &&
        value.installed === true &&
        !value.maintenance
      );
    } catch {
      return false;
    }
  }
  // Do not send the deployment credential to the old source website. The new
  // host is probed only after KAS itself reports the intended public directory.
  if (current === oldPath && current !== plan.targetPublicPath) {
    if (!(await agentAt(new URL(target.base_url).origin)))
      throw new Error(
        "CMS-Domainumzug: Vorbereitetes CMS ist nicht bereit. Keine Änderung.",
      );
    await remote.write(
      path.join(root, ".lorzcms/domain-move.before.json"),
      Buffer.from(
        JSON.stringify({
          format: "siteops-cms-domain-move-backup-v1",
          source,
          targetSiteId: target.id,
          previousBaseUrl: target.base_url,
          previousPath: oldPath,
          targetPath: plan.targetPublicPath,
          backupCommit,
        }),
      ),
    );
    await kas.call("update_subdomain", {
      subdomain_name: hostname,
      subdomain_path: plan.targetPublicPath + "/",
    });
    return {
      ok: true,
      state: "pending_activation",
      hostname,
      previousPath: oldPath,
      kasPublicPath: plan.targetPublicPath,
      installationId: target.installation_id,
      message:
        "Verzeichniswechsel beauftragt. Nach der KAS-Aktivierung provision erneut aufrufen; unveränderten Auftrag weiterverwenden.",
    };
  }
  if (!(await agentAt("https://" + hostname)))
    return {
      ok: true,
      state: "pending_activation",
      hostname,
      message:
        "KAS-Ziel ist gesetzt; der verifizierte CMS-Anschluss ist an der neuen Adresse noch nicht aktiv.",
    };

  const configPath = path.join(root, "config/local.php");
  const config = (await remote.read(configPath)).toString();
  const oldOrigin = new URL(target.base_url).origin;
  const newOrigin = "https://" + hostname;
  const expected = "'base_url'=>'" + oldOrigin + "'";
  const replacement = "'base_url'=>'" + newOrigin + "'";
  if (!config.includes(expected) && !config.includes(replacement))
    throw new Error(
      "CMS-Domainumzug: Website-Konfiguration unerwartet. Zuordnung noch nicht geändert.",
    );
  if (config.includes(expected))
    await remote.write(
      configPath,
      Buffer.from(config.replace(expected, replacement)),
    );
  const transaction = await db.getConnection();
  try {
    await transaction.beginTransaction();
    const [locked] = await transaction.query(
      "SELECT site_id,base_url FROM cms_installations WHERE id=? FOR UPDATE",
      [target.installation_id],
    );
    if (
      locked.length !== 1 ||
      locked[0].site_id !== target.id ||
      locked[0].base_url !== target.base_url
    )
      throw new Error("CMS-Domainumzug: Zuordnung wurde inzwischen geändert.");
    await transaction.query(
      "UPDATE sites SET protocol=?,host=?,port=?,username=?,encrypted_credentials=?,remote_root=?,site_type='php',deployment_mode='webspace',exclude_patterns=?,monitor_url=?,monitor_enabled=1,updated_at=NOW() WHERE id=?",
      [
        target.protocol,
        target.host,
        target.port,
        target.username,
        target.encrypted_credentials,
        root,
        JSON.stringify([".git", ".lorzcms", "config", "var", "node_modules"]),
        newOrigin,
        source.id,
      ],
    );
    await transaction.query(
      "UPDATE cms_installations SET site_id=?,base_url=?,last_checked_at=UTC_TIMESTAMP(3) WHERE id=?",
      [source.id, newOrigin, target.installation_id],
    );
    await transaction.query(
      "UPDATE sites SET enabled=0,monitor_enabled=0,backup_enabled=0,updated_at=NOW() WHERE id=?",
      [target.id],
    );
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  } finally {
    transaction.release();
  }
  await remote.write(
    path.join(root, ".lorzcms/domain-move.complete.json"),
    Buffer.from(
      JSON.stringify({
        hostname,
        siteId: source.id,
        installationId: target.installation_id,
        previousPath: oldPath,
        backupCommit,
        completedAt: new Date().toISOString(),
      }),
    ),
  );
  return {
    ok: true,
    state: "ready",
    hostname,
    siteId: source.id,
    installationId: target.installation_id,
    previousPath: oldPath,
    kasPublicPath: plan.targetPublicPath,
    loginUrl: newOrigin + "/admin/",
    message:
      "Website und CMS laufen auf einer Domain. Die ursprüngliche SiteOps-Projektzuordnung bleibt erhalten; die temporäre Zuordnung ist deaktiviert.",
  };
}
