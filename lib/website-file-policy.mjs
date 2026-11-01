export function websitePathAllowed(path) {
  if ([...String(path)].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return false;
  const parts = String(path).replaceAll('\\', '/').split('/');
  return !parts.some(
    part =>
      part === '..' ||
      /^(\.env(?:\..*)?|\.git|\.ssh|\.aws|\.htpasswd|id_(rsa|ed25519)(\.pub)?|credentials(?:\.json)?|secrets?(?:\.\w+)?|wp-config\.php|configuration\.php|.*\.(?:pem|key|p12|pfx|sqlite|sqlite3|sql))$/i.test(
        part
      )
  );
}

// Inspect each path segment before following it. Provider credentials may allow
// more than the configured website root; links must not expand that boundary.
export async function assertNoRemoteLinks(remote, root, path) {
  const parts = String(path).replaceAll('\\', '/').split('/').filter(Boolean);
  let parent = String(root).replace(/\/+$/, '');
  for (const part of parts) {
    const entries = await remote.list(parent || '/');
    const entry = entries.find(item => item.name === part);
    if (entry?.type === 'link')
      throw Object.assign(new Error('Verknüpfungen außerhalb des Website-Kontexts sind hier gesperrt.'), {
        statusCode: 403
      });
    if (!entry) break;
    parent += '/' + part;
  }
}
export function assertWebsitePath(path) {
  if (!websitePathAllowed(path))
    throw Object.assign(
      new Error('Geschützte Zugangsdaten und interne Verzeichnisse können hier nicht gelesen werden.'),
      { statusCode: 403 }
    );
}
