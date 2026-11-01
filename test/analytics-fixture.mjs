import { searchConsoleSetup } from '../lib/search-console-setup.mjs';
export const analyticsAccount = '11111111-1111-4111-8111-111111111111';
export const analyticsSite = {
  id: analyticsAccount,
  slug: 'nordlicht',
  name: 'Nordlicht Studio',
  domain: 'nordlicht.example.test'
};
export const analyticsVideos = [
  {
    id: 'nordlicht01',
    snippet: {
      title: 'Ein Onlineshop, der mit deinem Geschäft wächst',
      publishedAt: '2026-10-16T09:00:00Z',
      thumbnails: {},
      description: 'Ein Praxisleitfaden für den eigenen Shop.'
    }
  },
  {
    id: 'nordlicht02',
    snippet: {
      title: 'Was eine gute Produktseite wirklich braucht',
      publishedAt: '2026-10-12T09:00:00Z',
      thumbnails: {},
      description: 'Produktseiten im Detail.'
    }
  },
  {
    id: 'nordlicht03',
    snippet: {
      title: 'Vom ersten Entwurf zum fertigen Webauftritt',
      publishedAt: '2026-10-05T09:00:00Z',
      thumbnails: {},
      description: 'Unser Arbeitsablauf.'
    }
  }
];
const iso = offset => new Date(Date.UTC(2026, 8, 29 + offset)).toISOString().slice(0, 10);
export const analyticsDaily = Array.from({ length: 28 }, (_, i) => ({
  keys: [iso(i)],
  clicks: Math.round(83 + i * 2.8 + Math.sin(i * 0.8) * 25),
  impressions: Math.round(1840 + i * 56 + Math.cos(i * 0.6) * 280),
  position: 15.8 - i * 0.17
})).map(row => ({ ...row, ctr: row.clicks / row.impressions }));
export const analyticsQueries = Array.from({ length: 135 }, (_, i) => ({
  keys: [
    [
      'webdesign hamburg',
      'onlineshop erstellen lassen',
      'shopware agentur',
      'website für handwerksbetrieb',
      'produktseite optimieren',
      'webdesign preise'
    ][i % 6] + (i > 5 ? ' ' + i : '')
  ],
  clicks: Math.max(1, 40 - Math.round(i * 0.28)),
  impressions: Math.max(10, 650 - i * 4),
  position: 6.8 + i * 0.07
})).map(row => ({ ...row, ctr: row.clicks / row.impressions }));
const totalClicks = analyticsDaily.reduce((s, r) => s + r.clicks, 0),
  totalImpressions = analyticsDaily.reduce((s, r) => s + r.impressions, 0);
export const analyticsReport = {
  available: true,
  range: { startDate: iso(0), endDate: iso(27) },
  previous_range: { startDate: '2026-09-01', endDate: '2026-09-28' },
  totals: {
    clicks: totalClicks,
    impressions: totalImpressions,
    ctr: totalClicks / totalImpressions,
    position: analyticsDaily.reduce((s, r) => s + r.position * r.impressions, 0) / totalImpressions
  },
  previous_totals: { clicks: 2874, impressions: 66912, ctr: 2874 / 66912, position: 14.3 },
  synced_at: '2026-10-30T08:42:00Z',
  last_complete_date: iso(27),
  source: 'Google Search Console',
  time_zone: 'America/Los_Angeles',
  data_state: 'final',
  truncated: false,
  opportunities: [
    {
      value: 'onlineshop erstellen lassen',
      suggestion: 'Viele Impressionen, aber wenige Klicks. Titel und Beschreibung prüfen.'
    },
    {
      value: 'https://nordlicht.example.test/leistungen',
      suggestion: 'Position nahe Seite eins. Inhalt und interne Verlinkung verbessern.'
    }
  ]
};

export function createAnalyticsFixture() {
  const failures = {
    gsc: false,
    youtube: false,
    day: false,
    permission: false,
    empty: false,
    unlinked: false,
    noAccount: false
  };
  const requests = [],
    searchStatus = {};
  function respond(url, request) {
    const path = url.pathname;
    let body = request.postDataJSON?.();
    requests.push({ path, query: Object.fromEntries(url.searchParams), body });
    if (path === '/api/ui-theme') return { accent: '#2465E8' };
    if (path === '/api/build-info') return { version: '1.9.0', build: 'analytics-fixture' };
    if (path === '/api/search-console/status') {
      const status = {
        site_enabled: true,
        configured: true,
        client_id: 'fixture',
        redirect_uri: 'https://siteops.test/api/search-console/oauth/callback',
        accounts: failures.noAccount ? [] : [{ id: analyticsAccount, email: 'studio@nordlicht.example.test' }],
        linkage: failures.unlinked
          ? null
          : {
              property: 'sc-domain:nordlicht.example.test',
              permission_level: 'siteOwner',
              live_approved_at: '2026-09-10T10:00:00Z',
              verified_at: '2026-09-10T11:00:00Z',
              sitemap_status: 'submitted',
              last_sync_at: analyticsReport.synced_at,
              last_complete_date: iso(27)
            }
      };
      Object.assign(status, searchStatus);
      status.setup = searchConsoleSetup(status);
      return status;
    }
    if (path.includes('/performance')) {
      if (failures.gsc) return { http: 503, message: 'Google-Daten vorübergehend nicht verfügbar.' };
      const dimension = url.searchParams.get('dimension') || 'query',
        offset = Number(url.searchParams.get('offset') || 0),
        limit = Number(url.searchParams.get('limit') || 100),
        query = (url.searchParams.get('query') || '').toLowerCase();
      const source =
        dimension === 'date'
          ? analyticsDaily
          : dimension === 'page'
            ? analyticsQueries.map((r, i) => ({
                ...r,
                keys: [
                  'https://nordlicht.example.test/' +
                    ['leistungen', 'onlineshops', 'webdesign', 'kontakt'][i % 4] +
                    (i > 3 ? '/' + i : '')
                ]
              }))
            : analyticsQueries;
      const rows = source.filter(r => r.keys.join(' ').toLowerCase().includes(query));
      const sort = url.searchParams.get('sort'),
        order = url.searchParams.get('order') === 'asc' ? 1 : -1;
      if (sort)
        rows.sort(
          (a, b) => order * (sort === 'name' ? a.keys[0].localeCompare(b.keys[0]) : Number(a[sort]) - Number(b[sort]))
        );
      return {
        ...analyticsReport,
        dimension,
        rows: rows.slice(offset, offset + limit),
        total_rows: rows.length,
        source_total_rows: source.length,
        next_offset: offset + limit < rows.length ? offset + limit : null
      };
    }
    if (path === '/api/search-console/properties')
      return [{ siteUrl: 'sc-domain:nordlicht.example.test', permissionLevel: 'siteOwner' }];
    if (path.endsWith('/inspect'))
      return {
        inspectionResult: {
          inspectionResultLink: 'https://search.google.com/search-console/inspect',
          indexStatusResult: {
            verdict: 'PASS',
            coverageState: 'Submitted and indexed',
            indexingState: 'INDEXING_ALLOWED',
            lastCrawlTime: '2026-10-27T10:04:00Z'
          }
        }
      };
    if (path === '/api/youtube/status')
      return {
        configured: true,
        client_id: 'fixture',
        redirect_uri: 'https://siteops.test/api/youtube/oauth/callback',
        accounts: failures.noAccount
          ? []
          : [{ id: analyticsAccount, channel_id: 'UCnordlicht', title: 'Nordlicht Studio' }]
      };
    if (path === '/api/youtube/read') {
      if (body.action === 'channels.list')
        return {
          items: [
            {
              id: 'UCnordlicht',
              snippet: { title: 'Nordlicht Studio', description: 'Digitale Produkte, verständlich erklärt.' },
              statistics: { subscriberCount: '2830', videoCount: '18', viewCount: '184932' },
              brandingSettings: { channel: { title: 'Nordlicht Studio' } },
              contentDetails: { relatedPlaylists: { uploads: 'UUnordlicht' } }
            }
          ]
        };
      if (body.action === 'playlistItems.list')
        return {
          items: analyticsVideos.map(video => ({
            contentDetails: { videoId: video.id },
            snippet: { ...video.snippet, resourceId: { videoId: video.id } }
          }))
        };
      if (body.action === 'videos.list')
        return {
          items: analyticsVideos
            .filter(video => !body.parameters?.id || body.parameters.id.split(',').includes(video.id))
            .map(video => ({
              ...video,
              status: { privacyStatus: 'public' },
              statistics: { viewCount: '8901' },
              contentDetails: { duration: 'PT8M32S' }
            }))
        };
      return { items: [] };
    }
    if (path === '/api/youtube/analytics') {
      if (failures.youtube) return { http: 503, message: 'YouTube konnte gerade nicht geladen werden.' };
      if (failures.permission) return { http: 403, message: 'YouTube-Analytics-Berechtigung fehlt.' };
      if (failures.day && body.dimension === 'day') return { http: 503, message: 'Tagesdaten nicht verfügbar.' };
      const days = body.days || 28,
        dayAt = i => new Date(Date.UTC(2026, 9, 27 - days + i)).toISOString().slice(0, 10);
      const daily = Array.from({ length: days }, (_, i) => ({
        day: dayAt(i),
        views: Math.round(410 + i * 19 + Math.sin(i * 0.8) * 125),
        estimatedMinutesWatched: Math.round(1100 + i * 54 + Math.sin(i * 0.8) * 300)
      })).map(row => ({ ...row, averageViewDuration: (row.estimatedMinutesWatched * 60) / row.views }));
      const views = daily.reduce((s, r) => s + r.views, 0),
        minutes = daily.reduce((s, r) => s + r.estimatedMinutesWatched, 0);
      const rows = failures.empty
        ? []
        : body.dimension === 'summary'
          ? [{ views, estimatedMinutesWatched: minutes, averageViewDuration: (minutes * 60) / views }]
          : body.dimension === 'video'
            ? analyticsVideos.map((v, i) => ({
                video: v.id,
                views: Math.round(views * [0.48, 0.29, 0.15][i]),
                estimatedMinutesWatched: Math.round(minutes * [0.44, 0.31, 0.17][i]),
                averageViewDuration:
                  (Math.round(minutes * [0.44, 0.31, 0.17][i]) * 60) / Math.round(views * [0.48, 0.29, 0.15][i])
              }))
            : daily;
      return { start_date: dayAt(0), end_date: dayAt(days - 1), rows, dimension: body.dimension };
    }
    return [];
  }
  return { respond, failures, requests, searchStatus };
}
