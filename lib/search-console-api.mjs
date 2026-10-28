import * as z from 'zod/v4';
import { searchConsolePreviewSchema, searchConsoleApprovalSchema } from './search-console.mjs';

export function registerSearchConsoleTools(server, service, text) {
  const site = z.object({ site: z.string().min(1).max(200) }).strict();
  const register = (name, description, schema, run, readOnly = false) =>
    server.registerTool(
      name,
      {
        description,
        inputSchema: schema,
        annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true }
      },
      async input => {
        try {
          return text(await run(schema.parse(input)));
        } catch (error) {
          return {
            ...text({
              error:
                error.statusCode && error.statusCode < 500
                  ? error.message
                  : 'Search-Console-Anfrage fehlgeschlagen. Verbindung und Status prüfen.',
              status: error.statusCode || 422
            }),
            isError: true
          };
        }
      }
    );
  register(
    'search_console_status',
    'Read project linkage, live approval, verification, sitemap and sync states. No secrets. Configure OAuth in the authenticated dashboard.',
    site,
    x => service.status(x.site),
    true
  );
  register(
    'search_console_properties',
    'List existing Google properties matching this project. Does not register properties.',
    site.extend({ account_id: z.uuid() }),
    x => service.properties(x.account_id, x.site),
    true
  );
  register(
    'search_console_link',
    'Locally link one project to an authorized Google account and matching property. Resets live approval. Does not create external properties or change DNS.',
    site.extend({ account_id: z.uuid(), property: z.string().max(500) }),
    x => service.link(x)
  );
  register(
    'search_console_change_preview',
    'Prepare a ten-minute immutable preview for ONE project: live approval, Google property registration, DNS TXT append, Google verification, or sitemap submission. Show exact project/domain/property/record and confirmation to the human. No DNS/property/sitemap write. External steps require prior project-specific live approval.',
    searchConsolePreviewSchema,
    x => service.preview(x)
  );
  register(
    'search_console_change_execute',
    'Execute this exact preview ONLY after explicit human approval. approved=true must reflect approval of this project-specific action and exact record. Never infer live approval for all managed websites. Pass the preview confirmation unchanged. Check status before retrying any uncertain result.',
    searchConsoleApprovalSchema,
    x => service.execute(x)
  );
  register(
    'search_console_change_status',
    'Read the durable result of an approved preview. A running or failed mutation is never automatically replayed.',
    z.object({ preview_token: z.string().length(43) }).strict(),
    x => service.changeStatus(x.preview_token),
    true
  );
  register(
    'search_console_performance',
    'Read cached Google clicks, impressions, CTR, weighted position, previous period, query/page/date rows and opportunities. Paginate with next_offset. Separate from crawler SEO scores; Google supplies top rows, not every query.',
    site.extend({
      dimension: z.enum(['query', 'page', 'date']).default('query'),
      offset: z.number().int().min(0).max(50000).default(0),
      limit: z.number().int().min(1).max(500).default(100)
    }),
    x => service.performance(x.site, x),
    true
  );
  register(
    'search_console_sync',
    'Refresh the approved live project from Google. Reads external APIs and updates local analytics only; never creates properties, verifies ownership, writes DNS or submits sitemaps.',
    site,
    x => service.sync(x.site)
  );
  register(
    'search_console_inspect_url',
    'Read Google URL Inspection for one HTTPS URL within the linked property. Requires live approval; bounded to 100 local inspections/property/day. Does not request indexing and does not provide a site-wide index coverage report.',
    site.extend({ url: z.url().max(2000) }),
    x => service.inspect(x.site, x.url),
    true
  );
  register(
    'search_console_unlink',
    'Remove the local project linkage and cached report. Does not remove Google properties or DNS records.',
    site,
    x => service.unlink(x.site)
  );
}

export function registerSearchConsoleRoutes(app, service, { origin, page, render, getSite }) {
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/search-console/')) return;
    if (!req.siteopsSession?.tokenHash) return reply.code(401).send({ error: 'SiteOps-Anmeldung erforderlich.' });
    if (
      !['GET', 'HEAD'].includes(req.method) &&
      (req.headers.origin !== origin() || !String(req.headers['content-type'] || '').startsWith('application/json'))
    )
      return reply.code(403).send({ error: 'Änderungen benötigen eine angemeldete JSON-Anfrage aus SiteOps.' });
  });
  app.get('/sites/:site/search-console', async (req, reply) =>
    reply.type('text/html').send(page('Google Search Console', render(await getSite(req.params.site))))
  );
  app.get('/api/search-console/status', req => service.status(req.query.site));
  app.post('/api/search-console/configure', req => service.configure(req.body));
  app.post('/api/search-console/oauth/start', req => service.beginOAuth(req.siteopsSession));
  app.get('/api/search-console/oauth/callback', { logLevel: 'silent' }, async (req, reply) => {
    await service.completeOAuth(req.query, req.siteopsSession);
    return reply.redirect('/?search_console_connected=1');
  });
  app.get('/api/search-console/properties', req => service.properties(req.query.account_id, req.query.site));
  app.post('/api/search-console/link', req => service.link(req.body));
  app.post('/api/search-console/previews', req => service.preview(req.body));
  app.post('/api/search-console/execute', req => service.execute(req.body));
  app.post('/api/search-console/change-status', req => service.changeStatus(req.body?.preview_token));
  app.get('/api/search-console/sites/:site/performance', req => service.performance(req.params.site, req.query));
  app.post('/api/search-console/sites/:site/sync', req => service.sync(req.params.site));
  app.post('/api/search-console/sites/:site/inspect', req => service.inspect(req.params.site, req.body?.url));
  app.post('/api/search-console/sites/:site/unlink', req => service.unlink(req.params.site));
  app.post('/api/search-console/accounts/:id/disconnect', req => service.disconnect(req.params.id));
}
