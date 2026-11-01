// Use the same website-relative identity for FTP, Git snapshots and restores.
export function siteFilePath(value) {
  if (typeof value !== 'string' || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw new Error('Invalid website file path');
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.includes('..')) throw new Error('Path traversal rejected');
  const path = parts.filter(part => part && part !== '.').join('/');
  if (!path) throw new Error('Website file path must not be empty');
  return path;
}

export function normalizeChangeFiles(files) {
  const seen = new Set();
  return files.map(file => {
    const path = siteFilePath(file.path);
    if (seen.has(path)) throw new Error('Duplicate website file path: ' + path);
    seen.add(path);
    return { ...file, path };
  });
}
