import * as z from 'zod/v4';

export const portfolioQuery = z.object({
  query: z.string().trim().max(90).default(''),
  status: z.enum(['all', 'attention', 'online', 'unknown', 'paused']).default('all'),
  customer_id: z.uuid().optional(),
  project_id: z.uuid().optional(),
  sort: z.enum(['name', 'status', 'checked']).default('name'),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

export function monitoringState(site, now = Date.now()) {
  if (!site.monitor_enabled) return { code: 'paused', label: 'Überwachung aus', tone: 'neutral' };
  const checked = site.last_checked_at ? new Date(site.last_checked_at).getTime() : NaN;
  if (!Number.isFinite(checked) || site.last_check_ok == null)
    return { code: 'unknown', label: 'Noch nicht geprüft', tone: 'neutral' };
  if (now - checked > Math.max(Number(site.monitor_interval_seconds || 300) * 3000, 900000))
    return { code: 'unknown', label: 'Prüfung veraltet', tone: 'warning' };
  return Number(site.last_check_ok) === 1
    ? { code: 'online', label: 'Erreichbar', tone: 'positive' }
    : { code: 'attention', label: 'Prüfung fehlgeschlagen', tone: 'danger' };
}

// Explicit columns: this service never reads or serializes connection credentials.
export function createWorkspaceOverview({ db, activity, dueTasks, now = () => Date.now() }) {
  async function snapshot() {
    const [rows] = await db.query(
      'SELECT s.id,s.slug,s.name,s.domain,s.site_type,s.monitor_enabled,s.monitor_interval_seconds,s.backup_enabled,' +
        'mc.ok last_check_ok,mc.created_at last_checked_at,mc.response_ms,mc.ssl_days,' +
        'b.created_at last_backup_at,ps.project_id,p.name project_name,p.customer_id,c.name customer_name ' +
        'FROM sites s LEFT JOIN monitor_checks mc ON mc.id=(SELECT m.id FROM monitor_checks m WHERE m.site_id=s.id ORDER BY m.created_at DESC,m.id DESC LIMIT 1) ' +
        'LEFT JOIN backups b ON b.id=(SELECT b2.id FROM backups b2 WHERE b2.site_id=s.id ORDER BY b2.created_at DESC LIMIT 1) ' +
        'LEFT JOIN project_sites ps ON ps.site_id=s.id LEFT JOIN customer_projects p ON p.id=ps.project_id ' +
        'LEFT JOIN customers c ON c.id=p.customer_id ORDER BY s.name,s.id'
    );
    return rows.map(site => ({
      ...site,
      monitor_enabled: Boolean(site.monitor_enabled),
      status: monitoringState(site, now())
    }));
  }
  async function portfolio(input = {}) {
    const filters = portfolioQuery.parse(input);
    const all = await snapshot();
    const counts = Object.fromEntries(
      ['attention', 'online', 'unknown', 'paused'].map(key => [key, all.filter(s => s.status.code === key).length])
    );
    const term = filters.query.toLocaleLowerCase('de-DE');
    const items = all.filter(
      site =>
        (filters.status === 'all' || site.status.code === filters.status) &&
        (!filters.customer_id || site.customer_id === filters.customer_id) &&
        (!filters.project_id || site.project_id === filters.project_id) &&
        (!term ||
          [site.name, site.domain, site.customer_name, site.project_name].some(value =>
            String(value || '')
              .toLocaleLowerCase('de-DE')
              .includes(term)
          ))
    );
    const rank = { attention: 0, unknown: 1, online: 2, paused: 3 };
    items.sort((a, b) => {
      const value =
        filters.sort === 'status'
          ? rank[a.status.code] - rank[b.status.code]
          : filters.sort === 'checked'
            ? new Date(b.last_checked_at || 0) - new Date(a.last_checked_at || 0)
            : 0;
      return value || a.name.localeCompare(b.name, 'de') || a.id.localeCompare(b.id);
    });
    return {
      items: items.slice(filters.offset, filters.offset + filters.limit),
      total: items.length,
      total_sites: all.length,
      counts,
      filters,
      next_offset: filters.offset + filters.limit < items.length ? filters.offset + filters.limit : null,
      observed_at: new Date(now()).toISOString()
    };
  }
  async function overview() {
    const results = await Promise.allSettled([
      portfolio({ sort: 'status', limit: 8 }),
      dueTasks(),
      activity.list({ limit: 10 })
    ]);
    const [websites, tasks, events] = results.map(result => (result.status === 'fulfilled' ? result.value : null));
    return {
      websites,
      tasks,
      activity: events,
      sources: Object.fromEntries(
        ['websites', 'tasks', 'activity'].map((key, i) => [
          key,
          {
            status: results[i].status === 'fulfilled' ? 'available' : 'unavailable',
            ...(results[i].status === 'rejected'
              ? { message: 'Daten konnten nicht geladen werden. Verbindung prüfen und erneut laden.' }
              : {})
          }
        ])
      ),
      observed_at: new Date(now()).toISOString()
    };
  }
  return { portfolio, overview };
}
