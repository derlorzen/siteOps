// Generate a bounded API contract from Google's official Discovery document.
// Source: https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest
// Only machine-readable protocol fields are retained; see docs/YOUTUBE.md.
import fs from 'node:fs';
const input = process.argv[2];
if (!input) throw new Error('Provide the reviewed official YouTube discovery JSON file.');
const discovery = JSON.parse(fs.readFileSync(input, 'utf8'));
if (discovery.id !== 'youtube:v3' || discovery.rootUrl !== 'https://youtube.googleapis.com/')
  throw new Error('Unexpected API discovery source.');
const retain = value => {
  if (Array.isArray(value)) return value.map(retain);
  if (!value || typeof value !== 'object') return value;
  const allowed = [
    'type',
    'properties',
    'items',
    'additionalProperties',
    '$ref',
    'enum',
    'minimum',
    'maximum',
    'required',
    'format',
    'annotations'
  ];
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => allowed.includes(key))
      .map(([key, v]) => [
        key,
        key === 'properties'
          ? Object.fromEntries(Object.entries(v).map(([name, schema]) => [name, retain(schema)]))
          : retain(v)
      ])
  );
};
const methods = {};
for (const [resource, definition] of Object.entries(discovery.resources))
  for (const [method, x] of Object.entries(definition.methods || {})) {
    const name = resource + '.' + method;
    methods[name] = {
      method: x.httpMethod,
      path: x.path,
      description: name,
      parameters: Object.fromEntries(
        Object.entries(x.parameters || {}).map(([name, p]) => [
          name,
          { ...retain(p), required: p.required === true, location: p.location, repeated: p.repeated || false }
        ])
      ),
      request: x.request?.$ref || null,
      media: x.mediaUpload
        ? { path: x.mediaUpload.protocols.simple.path, maxSize: x.mediaUpload.maxSize, accept: x.mediaUpload.accept }
        : null,
      download: Boolean(x.supportsMediaDownload),
      scopes: x.scopes || []
    };
  }
const catalog = {
  source: 'https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest',
  revision: discovery.revision,
  methods,
  schemas: Object.fromEntries(Object.entries(discovery.schemas).map(([name, schema]) => [name, retain(schema)]))
};
fs.writeFileSync('lib/youtube-catalog.json', JSON.stringify(catalog, null, 2) + '\n');
console.log(Object.keys(methods).length + ' verified YouTube API operations.');
