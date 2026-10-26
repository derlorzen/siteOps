// Keep the provider schema in the portable strict-JSON subset. Zod remains the authoritative validator.
export function strictJsonSchema(schema) {
  if (schema.const !== undefined) return { type: schema.type, enum: [schema.const] };
  if (schema.anyOf) return { anyOf: schema.anyOf.map(strictJsonSchema) };
  if (schema.type === 'object') {
    const required = new Set(schema.required || []);
    const properties = Object.fromEntries(
      Object.entries(schema.properties || {}).map(([key, value]) => {
        const shape = strictJsonSchema(value);
        return [key, required.has(key) ? shape : { anyOf: [shape, { type: 'null' }] }];
      })
    );
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  }
  if (schema.type === 'array') return { type: 'array', items: strictJsonSchema(schema.items) };
  return { ...(schema.type ? { type: schema.type } : {}), ...(schema.enum ? { enum: schema.enum } : {}) };
}
export function restoreOptionalFields(value, schema) {
  if (value === null) return value;
  if (schema.anyOf) {
    const branch = schema.anyOf.find(x => x.type === (Array.isArray(value) ? 'array' : typeof value));
    return branch ? restoreOptionalFields(value, branch) : value;
  }
  if (Array.isArray(value) && schema.items) return value.map(item => restoreOptionalFields(item, schema.items));
  if (value && typeof value === 'object' && schema.properties) {
    const required = new Set(schema.required || []);
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key, v]) => v !== null || required.has(key))
        .map(([key, v]) => [key, schema.properties[key] ? restoreOptionalFields(v, schema.properties[key]) : v])
    );
  }
  return value;
}
export function openAIDiagnostic(status, payload, { model, endpoint, requestId, secret = '' }) {
  const redact = value =>
    String(value || '')
      .replaceAll(secret || '\0', '[REDACTED]')
      .replace(/sk-[a-zA-Z0-9_-]{5,}/g, '[REDACTED]')
      .replace(/Bearer\s+[^\s"',]+/gi, 'Bearer [REDACTED]')
      .slice(0, 800);
  const error = payload?.error || {};
  const identifier = value => (/^[a-zA-Z0-9_.\[\]-]{1,120}$/.test(String(value || '')) ? String(value) : null);
  const code = identifier(error.code) || identifier(error.type);
  const parameter = identifier(error.param);
  let hint =
    status === 401
      ? 'API-Schlüssel oder dessen Projektzuordnung prüfen.'
      : status === 403
        ? 'Das OpenAI-Projekt erlaubt diese Aktion nicht. Schlüsselberechtigungen und gegebenenfalls Organisationsverifizierung prüfen.'
        : status === 429
          ? 'Anfragelimit erreicht. Später erneut versuchen.'
          : status >= 500
            ? 'OpenAI meldet einen Dienstfehler. Später erneut versuchen.'
            : 'Anfrageparameter und Modellkompatibilität prüfen.';
  if (code === 'model_not_found' || status === 404)
    hint =
      'Diese Modell-ID ist für diesen API-Schlüssel nicht verfügbar. Verfügbare Modelle laden und Zugriff im OpenAI-Projekt prüfen.';
  if (['insufficient_quota', 'billing_hard_limit_reached'].includes(code))
    hint = 'OpenAI-API-Guthaben oder Projektbudget ist erschöpft. Ein ChatGPT-Abonnement enthält kein API-Guthaben.';
  if (code === 'unsupported_parameter' || parameter?.startsWith('text.format'))
    hint =
      'OpenAI lehnt das Anfrageformat oder einen Parameter ab. Das ist kein Nachweis für einen falschen API-Schlüssel.';
  return {
    http_status: status,
    error_code: code,
    parameter,
    model,
    endpoint,
    request_id: identifier(requestId),
    message: redact(error.message) || 'OpenAI lieferte keine lesbare Fehlerbeschreibung.',
    hint,
    occurred_at: new Date().toISOString()
  };
}
export function openAIErrorMessage(diagnostic) {
  return [
    'OpenAI HTTP ' + diagnostic.http_status + ' · Modell ' + diagnostic.model,
    diagnostic.error_code,
    diagnostic.parameter ? 'Parameter: ' + diagnostic.parameter : null,
    diagnostic.message,
    diagnostic.hint,
    diagnostic.request_id ? 'Request-ID: ' + diagnostic.request_id : null
  ]
    .filter(Boolean)
    .join(' · ');
}
