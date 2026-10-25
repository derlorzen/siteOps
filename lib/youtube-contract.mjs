import fs from 'node:fs';
import * as z from 'zod/v4';
import { parseVideoInput } from './video-production.mjs';

export const youtubeCatalog = JSON.parse(fs.readFileSync(new URL('./youtube-catalog.json', import.meta.url), 'utf8'));
export const youtubeActions = Object.keys(youtubeCatalog.methods).sort();
export const youtubeRequestSchema = z
  .object({
    account_id: z.uuid(),
    action: z.enum(youtubeActions),
    parameters: z
      .record(
        z.string(),
        z.union([z.string().max(8000), z.number().finite(), z.boolean(), z.array(z.string().max(1000)).max(100)])
      )
      .default({}),
    body: z.record(z.string(), z.unknown()).optional(),
    etag: z.string().min(1).max(500).optional(),
    media: z.object({ mime_type: z.string().max(100), data_base64: z.string().max(12 * 1024 * 1024) }).optional()
  })
  .strict();
export const youtubeUploadSchema = z
  .object({
    account_id: z.uuid(),
    job_id: z.uuid(),
    kind: z.enum(['video', 'short']).default('video'),
    title: z.string().min(3).max(100).optional(),
    description: z.string().max(5000).optional(),
    tags: z.array(z.string().min(1).max(100)).max(30).optional(),
    category_id: z.string().regex(/^\d+$/).default('28'),
    made_for_kids: z.boolean(),
    contains_synthetic_media: z.boolean(),
    default_language: z.enum(['en', 'de']).optional()
  })
  .strict();
const bad = message => {
  throw Object.assign(new Error(message), { statusCode: 422 });
};

function check(value, schema, path, action, depth = 0) {
  if (depth > 30) bad('YouTube-Eingabe zu tief verschachtelt.');
  if (schema.$ref) schema = youtubeCatalog.schemas[schema.$ref];
  if (!schema) bad('Unbekanntes YouTube-Schema.');
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) bad(path + ': Objekt erforderlich.');
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) bad('Unzulässiger Feldname.');
      const child = schema.properties?.[key] || schema.additionalProperties;
      if (!child) bad(path + '.' + key + ': unbekanntes YouTube-Feld.');
      check(item, child, path + '.' + key, action, depth + 1);
    }
    for (const [key, child] of Object.entries(schema.properties || {}))
      if (child.annotations?.required?.includes('youtube.' + action) && value[key] === undefined)
        bad(path + '.' + key + ': erforderlich.');
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length > 1000) bad(path + ': begrenzte Liste erforderlich.');
    for (const x of value) check(x, schema.items, path + '[]', action, depth + 1);
  } else {
    const expected = schema.type === 'integer' ? 'number' : schema.type;
    if (expected && typeof value !== expected) bad(path + ': ' + expected + ' erforderlich.');
    if (schema.type === 'integer' && !Number.isSafeInteger(value)) bad(path + ': ganze Zahl erforderlich.');
    if (schema.enum && !schema.enum.includes(value)) bad(path + ': ungültiger Wert.');
    if (schema.minimum !== undefined && Number(value) < Number(schema.minimum)) bad(path + ': zu klein.');
    if (schema.maximum !== undefined && Number(value) > Number(schema.maximum)) bad(path + ': zu groß.');
    if (schema.format === 'date-time' && (!Number.isFinite(Date.parse(value)) || !value.includes('T')))
      bad(path + ': ISO-Datum erforderlich.');
  }
}

export function validateYouTubeRequest(input) {
  const x = parseVideoInput(youtubeRequestSchema, input),
    method = youtubeCatalog.methods[x.action];
  for (const [name, value] of Object.entries(x.parameters)) {
    const parameter = Object.hasOwn(method.parameters, name) ? method.parameters[name] : null;
    if (!parameter) bad('Unbekannter YouTube-Parameter: ' + name);
    if (Array.isArray(value)) {
      if (!parameter.repeated) bad(name + ': Liste nicht erlaubt.');
      for (const item of value) check(item, parameter, name, x.action);
    } else check(value, parameter, name, x.action);
  }
  for (const [name, parameter] of Object.entries(method.parameters))
    if (parameter.required && x.parameters[name] === undefined) bad('YouTube-Parameter erforderlich: ' + name);
  if (x.body) {
    if (!method.request) bad('Diese Aktion akzeptiert keinen JSON-Inhalt.');
    check(x.body, { $ref: method.request }, 'body', x.action);
  }
  if (method.request && !x.body && !x.media) bad('YouTube-JSON-Inhalt erforderlich.');
  if (x.media) {
    if (!/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(x.media.mime_type))
      bad('Ungültiger Datei-MIME-Typ.');
    if (!method.media) bad('Diese Aktion akzeptiert keine Datei.');
    if (x.action === 'videos.insert') bad('Videos aus Video Studio über den dauerhaften Upload-Auftrag übertragen.');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(x.media.data_base64) || x.media.data_base64.length % 4 !== 0)
      bad('Datei muss gültiges Base64 enthalten.');
    const size = Buffer.byteLength(x.media.data_base64, 'base64');
    if (!size || size > Math.min(Number(method.media.maxSize) || 8 * 1024 * 1024, 8 * 1024 * 1024))
      bad('Datei zu groß oder leer (maximal 8 MiB, API-Limit kann niedriger sein).');
    if (
      !method.media.accept.some(
        type =>
          type === '*/*' ||
          type === x.media.mime_type ||
          (type.endsWith('/*') && x.media.mime_type.startsWith(type.slice(0, -1)))
      )
    )
      bad('Dateityp wird von YouTube nicht akzeptiert.');
  }
  if (x.action === 'videos.insert') bad('Bitte den Video-Studio-Upload verwenden; er lädt zunächst privat hoch.');
  const status = x.body?.status;
  if (status?.publishAt && (status.privacyStatus !== 'private' || Date.parse(status.publishAt) <= Date.now()))
    bad('Geplante Veröffentlichung benötigt ein zukünftiges Datum und Sichtbarkeit privat.');
  return x;
}

export function youtubeUrl(request) {
  const method = youtubeCatalog.methods[request.action];
  let route = method.path;
  for (const [name, p] of Object.entries(method.parameters))
    if (p.location === 'path') route = route.replace('{' + name + '}', encodeURIComponent(request.parameters[name]));
  const url = new URL(request.media ? method.media.path : route, 'https://www.googleapis.com/');
  for (const [name, value] of Object.entries(request.parameters))
    if (method.parameters[name].location !== 'path')
      url.searchParams.set(name, Array.isArray(value) ? value.join(',') : String(value));
  if (request.media) url.searchParams.set('uploadType', request.body ? 'multipart' : 'media');
  return url;
}

export function publicYouTubeCatalog({ resource, action } = {}) {
  const methods = youtubeActions.filter(
    name => (!resource || name.startsWith(resource + '.')) && (!action || name === action)
  );
  const schemas = {};
  const visit = schema => {
    if (schema?.$ref && !schemas[schema.$ref]) {
      schemas[schema.$ref] = youtubeCatalog.schemas[schema.$ref];
      visit(schemas[schema.$ref]);
    }
    for (const child of Object.values(schema?.properties || {})) visit(child);
    if (schema?.items) visit(schema.items);
    if (schema?.additionalProperties) visit(schema.additionalProperties);
  };
  if (action && youtubeCatalog.methods[action]?.request) visit({ $ref: youtubeCatalog.methods[action].request });
  return {
    source: youtubeCatalog.source,
    revision: youtubeCatalog.revision,
    operations: methods.map(action => ({ action, ...youtubeCatalog.methods[action] })),
    ...(action ? { schemas } : {})
  };
}
