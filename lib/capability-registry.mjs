import { validateApprovalMode } from './approval-mode.mjs';
import * as z from 'zod/v4';

const reads = new Set(
  `sites_list server_profiles_list site_get site_overview site_status site_connection_test deployment_info monitor_history incidents_list incident_get files_list files_find text_search file_read history_list history_diff backup_status backups_list seo_run_status seo_latest seo_page seo_graph seo_issues seo_compare quality_overview synthetics_list synthetic_run_get fix_prompt settings_get allinkl_accounts allinkl_domains allinkl_diagnostics allinkl_dns_list allinkl_ssl_list allinkl_ssl_diagnostics allinkl_ssl_status coolify_connections coolify_connection_info coolify_services_list coolify_service_info coolify_projects_list coolify_sources_list coolify_apps_list coolify_app_info coolify_command_list coolify_app_logs coolify_supabase_list coolify_supabase_status website_create_status cms_overview cms_project_status cms_inspect`.split(
    ' '
  )
);
const localWrites = new Set(
  `site_update synthetic_create synthetic_update change_preview rollback_preview cms_project_begin cms_project_file cms_project_finish cms_job_cancel video_studio_import_final video_studio_create_project video_studio_update_project video_studio_create_job video_studio_save_demo_template video_studio_update_metadata search_console_link search_console_sync search_console_unlink`.split(
    ' '
  )
);
const preparation = new Set(
  `site_delete_preview website_create_plan coolify_app_plan youtube_change_preview youtube_upload_preview youtube_studio_asset_preview search_console_change_preview backup_restore_preview`.split(
    ' '
  )
);
for (const name of `coolify_app_analyze coolify_app_status coolify_installations_list coolify_install_logs coolify_deployment_status coolify_app_verify coolify_targets coolify_environments_list video_studio_projects video_studio_runner_status video_studio_list_jobs video_studio_job_status video_studio_downloads video_studio_demo_templates youtube_status youtube_analytics youtube_api_catalog youtube_read youtube_change_status youtube_uploads search_console_status search_console_properties search_console_change_status search_console_performance search_console_inspect_url`.split(
  ' '
))
  reads.add(name);

export const errorSchema = z
  .object({
    code: z.string(),
    message: z.string(),
    operation: z.string().nullable().optional(),
    object: z.unknown().nullable(),
    retryable: z.boolean(),
    next_action: z.string(),
    fields: z.array(z.object({ path: z.string(), message: z.string() })).optional()
  })
  .passthrough();
export const resultSchema = z.object({
  data: z
    .unknown()
    .optional()
    .describe('Fachliches Ergebnis. Jobzustände und Anbieterergebnisse werden unverändert ausgewiesen.'),
  error: errorSchema.optional()
});
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key,
        /^(password|(?:temporary|admin)[_]?password|encrypted_credentials|git_credentials|private_?key|passphrase|api_?key|access_token|refresh_token|client_?secret|authorization|git_?token)$/i.test(
          key
        )
          ? '[Geschützt]'
          : redact(val)
      ])
    );
  return value;
}
export function toolResult(data) {
  const safe = redact(data);
  return {
    content: [{ type: 'text', text: typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2) }],
    structuredContent: { data: safe }
  };
}
export function publicError(error, object = null) {
  const status = error instanceof z.ZodError ? 422 : Number(error.statusCode || error.status || 500);
  const kinds = {
    400: ['INVALID_INPUT', 'Die Eingaben sind ungültig.', 'Prüfe die Felder und versuche es erneut.'],
    401: ['AUTHENTICATION_REQUIRED', 'Die Anmeldung ist abgelaufen.', 'Verbinde SiteOps erneut.'],
    403: [
      'PERMISSION_DENIED',
      'Für diese Aktion fehlt die Berechtigung.',
      'Prüfe die freigegebenen Rechte in SiteOps.'
    ],
    404: [
      'NOT_FOUND',
      'Das angefragte Objekt wurde nicht gefunden.',
      'Suche das Objekt erneut und verwende seine aktuelle Kennung.'
    ],
    409: [
      'CONFLICT',
      'Der vorbereitete Zustand hat sich geändert.',
      'Lade den aktuellen Stand und erstelle eine neue Vorschau.'
    ],
    413: [
      'CONTENT_TOO_LARGE',
      'Die Datei ist für diesen Aufruf zu groß.',
      'Öffne die Datei im Dashboard oder verwende eine kleinere Datei.'
    ],
    415: [
      'UNSUPPORTED_CONTENT',
      'Dieser Datei- oder Inhaltstyp wird hier nicht unterstützt.',
      'Öffne eine Textdatei oder verwende den passenden Upload-Bereich.'
    ],
    422: ['INVALID_INPUT', 'Die Eingaben konnten nicht verarbeitet werden.', 'Prüfe die markierten Felder.'],
    429: ['RATE_LIMITED', 'Zu viele Anfragen in kurzer Zeit.', 'Warte kurz und versuche es erneut.'],
    502: [
      'PROVIDER_UNAVAILABLE',
      'Der verbundene Dienst ist nicht erreichbar.',
      'Prüfe die Verbindung und wiederhole die Anfrage.'
    ],
    503: [
      'SERVICE_UNAVAILABLE',
      'Der Dienst ist gerade nicht verfügbar.',
      'Prüfe die Verbindung und den Serverstatus und versuche es erneut.'
    ],
    504: [
      'TIMEOUT',
      'Die Anfrage hat zu lange gedauert.',
      'Prüfe zuerst den tatsächlichen Auftragsstatus, bevor du die Aktion wiederholst.'
    ]
  };
  const [code, message, next_action] = kinds[status] || [
    'INTERNAL_ERROR',
    'Die Aktion konnte nicht abgeschlossen werden.',
    'Prüfe den Verlauf in SiteOps und versuche es danach erneut.'
  ];
  const approvalRequired = String(error.publicCode || '').startsWith('APPROVAL');
  if (error.publicCode === 'AI_LIMIT_REACHED')
    return {
      code: error.publicCode,
      message: error.message,
      object,
      retryable: false,
      next_action: 'Prüfe Nutzung, Reservierungen und konfigurierte Limits unter KI & Kosten.'
    };
  return {
    code: error.publicCode || code,
    operation: object?.capability || null,
    message: approvalRequired ? 'Die Aktion benötigt eine gültige Freigabe für den aktuellen Zustand.' : message,
    object,
    retryable: [429, 502, 503, 504].includes(status),
    next_action: approvalRequired
      ? 'Erstelle mit action_prepare eine Vorschau und lasse sie im SiteOps-Dashboard ausdrücklich freigeben. Führe anschließend genau diese Aktion aus.'
      : next_action,
    ...(error instanceof z.ZodError
      ? { fields: error.issues.map(issue => ({ path: issue.path.join('.'), message: 'Wert prüfen.' })) }
      : {}),
    ...(error.approval ? { approval: error.approval } : {})
  };
}
const moduleName = name =>
  name.startsWith('video_')
    ? 'video'
    : name.startsWith('search_console')
      ? 'search-console'
      : name.startsWith('allinkl') || name.startsWith('domain_') || name.startsWith('server_profiles')
        ? 'hosting'
        : name.startsWith('coolify')
          ? 'coolify'
          : /^(site|sites|deployment|files|file|text|change|history|rollback|backup|backups|synthetic|synthetics|monitor|incident|incidents|quality)_/.test(
                name
              )
            ? 'websites'
            : name.split('_')[0];
const moduleUi = {
  video: '/video-suite',
  youtube: '/youtube',
  hosting: '/hosting',
  coolify: '/coolify',
  cms: '/lorzcms',
  websites: '/websites',
  seo: '/websites',
  settings: '/settings'
};

export function capabilityPolicy(name, config = {}) {
  const explicit = config._siteops;
  const readOnly = explicit?.access === 'read' || reads.has(name);
  const approval = explicit?.approval ?? (!readOnly && !localWrites.has(name) && !preparation.has(name));
  return {
    module: explicit?.module || moduleName(name),
    access: readOnly ? 'read' : 'write',
    approval,
    ui: explicit?.ui || moduleUi[moduleName(name)] || '/mcp-info',
    service: explicit?.service || name,
    state: preparation.has(name) ? 'preparation' : readOnly ? 'query' : 'action'
  };
}

// Every tool, including tools registered by specialist modules, crosses this boundary.
// New writes default to approval-required; annotations never authorize an operation.
export function createCapabilityRegistry({
  principal,
  approvals,
  approvalMode = 'required',
  audit = async () => {},
  state = async () => ({}),
  metadataUrl
}) {
  validateApprovalMode(approvalMode);
  const entries = new Map();
  function authorize(policy) {
    const actor = principal();
    if (!actor) throw Object.assign(new Error('Authentication required'), { statusCode: 401 });
    const scopes = new Set(String(actor.scope || '').split(/\s+/));
    const trusted = actor.type === 'dashboard_session' || actor.type === 'legacy_bearer';
    if (!trusted && policy.access === 'write' && !scopes.has('siteops:write'))
      throw Object.assign(new Error('Write scope required'), { statusCode: 403 });
    return actor;
  }
  function instrument(server) {
    const register = server.registerTool.bind(server);
    server.registerTool = (name, config, run) => {
      const declared = capabilityPolicy(name, config);
      const policy = { ...declared, approval: approvalMode === 'required' && declared.approval };
      const baseSchema = config.inputSchema || z.object({});
      const schema = policy.approval
        ? baseSchema.extend({
            approval_id: z
              .uuid()
              .optional()
              .describe(
                'Serverseitige Freigabe für genau diese Aktion. In SiteOps bestätigen; Agenten dürfen nicht selbst freigeben.'
              )
          })
        : baseSchema;
      const description =
        (config.description || '') +
        (approvalMode === 'direct' && declared.approval
          ? ' Aktiver SiteOps-Direktmodus: keine zusätzliche Dashboard-Freigabe; vorhandener Benutzerauftrag und fachliche Prüfungen bleiben erforderlich.'
          : '');
      const entry = { name, description, ...policy, schema: baseSchema, run };
      entries.set(name, entry);
      const { _siteops: _ignored, ...definition } = config;
      return register(
        name,
        {
          ...definition,
          description,
          inputSchema: schema,
          outputSchema: config.outputSchema || resultSchema,
          annotations: {
            ...config.annotations,
            readOnlyHint: policy.access === 'read',
            destructiveHint: declared.approval,
            openWorldHint:
              config.annotations?.openWorldHint ?? !['billing', 'tools', 'workspace', 'mcp'].includes(policy.module)
          },
          _meta: {
            ...config._meta,
            securitySchemes: [
              {
                type: 'oauth2',
                scopes: policy.access === 'read' ? ['siteops:access'] : ['siteops:access', 'siteops:write']
              }
            ],
            'siteops/module': policy.module,
            'siteops/approvalRequired': policy.approval,
            'siteops/approvalMode': approvalMode
          }
        },
        async (input, context) => {
          let outcome = 'failed';
          try {
            const actor = authorize(policy);
            const { approval_id: approvalId, ...args } = input;
            if (policy.approval)
              await approvals.consume({
                id: approvalId,
                tool: name,
                args: baseSchema.parse(args),
                actor,
                state: await state(name, args)
              });
            let result = await run(baseSchema.parse(args), context);
            const value = result.structuredContent?.data;
            if (policy.access === 'write' && (value?.ok === false || value?.success === false))
              result = {
                ...result,
                isError: true,
                structuredContent: {
                  ...result.structuredContent,
                  error: publicError({ statusCode: 502 }, { capability: name })
                }
              };
            outcome = result.isError ? 'failed' : 'completed';
            return result.structuredContent
              ? result
              : {
                  ...result,
                  structuredContent: result.isError
                    ? { error: publicError({ statusCode: 502 }) }
                    : { data: result.content }
                };
          } catch (error) {
            const detail = publicError(error, { capability: name });
            return {
              isError: true,
              content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
              structuredContent: { error: detail },
              ...(detail.code === 'PERMISSION_DENIED'
                ? {
                    _meta: {
                      'mcp/www_authenticate': [
                        `Bearer error="insufficient_scope", scope="siteops:write"${metadataUrl ? ', resource_metadata="' + metadataUrl + '"' : ''}`
                      ]
                    }
                  }
                : {})
            };
          } finally {
            const actor = principal();
            await audit({
              actorType: actor?.type || 'unknown',
              actor: actor?.subject,
              clientId: actor?.clientId,
              method: 'TOOL',
              path: '/mcp',
              mcpTool: name,
              statusCode: outcome === 'completed' ? 200 : 422
            });
          }
        }
      );
    };
    return server;
  }
  function catalog() {
    return [...entries.values()].map(({ schema: _schema, run: _run, ...entry }) => entry);
  }
  async function prepare({ tool, arguments: args }) {
    const entry = entries.get(tool);
    if (!entry || !entry.approval) throw Object.assign(new Error('No approval workflow'), { statusCode: 400 });
    const actor = authorize(entry);
    const parsed = entry.schema.parse(args);
    return approvals.prepare({ tool, args: parsed, actor, state: await state(tool, parsed) });
  }
  return { instrument, catalog, prepare };
}
