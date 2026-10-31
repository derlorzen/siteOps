// Business effects that need a server-bound approval regardless of entry point.
// Payload contracts stay intact; the dashboard carries the approval in a header.
export function needsHttpApproval(method, path) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return false;
  if (method === 'DELETE' && /^\/api\/billing\/entries\/[^/]+$/.test(path)) return true;
  return [
    /^\/api\/ai\/limits$/,
    /^\/api\/settings\/(pagespeed-test|alert-test)$/,
    /^\/api\/sites$/,
    /^\/api\/sites\/[^/]+\/(connection|check)$/,
    /^\/api\/billing\/settings$/,
    /^\/api\/billing\/tasks\/[^/]+\/files\/[^/]+$/,
    /^\/api\/coolify\/(adopt|projects)$/,
    /^\/api\/previews\/[^/]+\/apply$/,
    /^\/api\/site-deletions\/confirm$/,
    /^\/api\/sites\/[^/]+\/(backup|backup-jobs|seo-runs)$/,
    /^\/api\/synthetic-tests\/[^/]+\/run$/,
    /^\/api\/billing\/invoices\/[^/]+\/(issue|pay|cancel|send)$/,
    /^\/api\/billing\/invoices\/[^/]+$/,
    /^\/api\/hosting\/allinkl\/(provision|ssl)$/,
    /^\/api\/hosting\/allinkl\/accounts\/[^/]+\/dns(?:\/[^/]+)?$/,
    /^\/api\/coolify\/(?:applications(?:\/.*)?|supabase(?:\/.*)?|commands\/run|deployments(?:\/.*)?)$/,
    /^\/api\/coolify\/installations\/[^/]+\/(execute|redeploy)$/,
    /^\/api\/lorzcms\/(?:updates|releases(?:\/bundled)?|installations(?:\/attach)?|installations\/[^/]+\/(theme|admin-recovery|resume)|jobs\/[^/]+\/(retry|rollback))$/,
    /^\/api\/website-factory\/(create|execute)$/,
    /^\/api\/video-studio\/(?:jobs\/[^/]+\/render|capture-test|openai-audio-test|demo-logins\/[^/]+\/test)$/,
    /^\/api\/video-suite\/(chat|thumbnails|test-connection)$/,
    /^\/api\/(youtube|search-console)\/execute$/
  ].some(pattern => pattern.test(path));
}

export function registerHttpActionGuard(app, { approvals, state }) {
  app.addHook('preHandler', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (!needsHttpApproval(req.method, path)) return;
    const actor = req.siteopsAuth;
    if (actor?.type !== 'dashboard_session')
      return reply.code(403).send({
        error: 'PERMISSION_DENIED',
        message: 'Melde dich im SiteOps-Dashboard an, um diese Änderung freizugeben.'
      });
    const tool = req.method + ' ' + (req.routeOptions?.url || path);
    const args = { path, params: req.params || {}, query: req.query || {}, body: req.body ?? null };
    const snapshot = await state(tool, { ...req.body, ...req.query, ...req.params });
    const id = req.headers['x-siteops-approval'];
    if (id) {
      await approvals.consume({ id, tool, args, actor, state: snapshot });
      return;
    }
    const approval = await approvals.prepare({ tool, args, actor, state: snapshot });
    return reply.code(428).send({
      error: 'APPROVAL_REQUIRED',
      message: 'Prüfe die konkrete Änderung und gib sie vor der Ausführung frei.',
      approval
    });
  });
}
