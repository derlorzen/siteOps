(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  let state,
    channel,
    video,
    playlist,
    pending,
    catalog,
    videoPage,
    commentPage,
    library = [],
    playlists = [],
    comments = [],
    captions = [],
    videoRequest = 0,
    libraryRequest = 0,
    thumbnailUrl,
    categories,
    selectedTab = 'overview',
    overviewRequest = 0,
    analyticsRequest = 0,
    analyticsCache = null,
    analyticsContext = '',
    analyticsMetric = 'views',
    analyticsSort = 'views',
    analyticsOrder = 'desc',
    analyticsVisible = 10,
    analyticsVideoRows = [],
    analyticsMetadata = new Map();
  const A = window.SiteOpsAnalytics,
    analyticsDefinitions = A.definitions($('yt-analytics-metrics'));
  const account = () => {
    const id = $('yt-account').value;
    if (!id) throw Error('Bitte zuerst einen YouTube-Kanal verbinden und auswählen.');
    return id;
  };
  const notify = (message, bad = false) => {
    $('yt-message').textContent = message;
    $('yt-message').classList.toggle('yt-error', bad);
  };
  const api = async (path, data) => {
    const r = await fetch('/api/youtube/' + path, {
      method: data ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: data ? { 'content-type': 'application/json' } : {},
      body: data ? JSON.stringify(data) : undefined
    });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(Error(x.message || x.error || 'HTTP ' + r.status), { status: r.status });
    return x;
  };
  const read = (action, parameters = {}) => api('read', { account_id: account(), action, parameters });
  const preview = (action, parameters = {}, body, media, etag) =>
    review(api('previews', { account_id: account(), action, parameters, body, media, etag }));
  const run = async (button, fn) => {
    button.disabled = true;
    try {
      await fn();
    } catch (e) {
      notify(e.message, true);
    } finally {
      button.disabled = false;
    }
  };
  const click = (id, fn) => $(id).addEventListener('click', () => run($(id), fn));
  const submit = (id, fn) =>
    $(id).addEventListener('submit', e => {
      e.preventDefault();
      run(e.submitter || $(id).querySelector('button'), fn);
    });
  const choices = (id, items, label) => {
    const old = $(id).value;
    $(id).replaceChildren();
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = label(item);
      $(id).append(option);
    }
    if (items.some(x => x.id === old)) $(id).value = old;
  };
  const videoId = value => /^[A-Za-z0-9_-]{11}$/.test(String(value || ''));
  const imageUrl = value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      return ['ytimg.com', 'googleusercontent.com', 'ggpht.com'].some(
        host => url.hostname === host || url.hostname.endsWith('.' + host)
      )
        ? url.href
        : '';
    } catch {
      return '';
    }
  };
  const thumbnail = (container, images, title) => {
    const placeholder = document.createElement('span');
    placeholder.className = 'yt-image-placeholder';
    placeholder.textContent = 'Kein Vorschaubild';
    const url = ['maxres', 'standard', 'high', 'medium', 'default']
      .map(key => imageUrl(images?.[key]?.url))
      .find(Boolean);
    if (!url) {
      container.append(placeholder);
      return;
    }
    const img = document.createElement('img');
    img.alt = 'Thumbnail: ' + title;
    img.src = url;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.replaceWith(placeholder), { once: true });
    container.append(img);
  };
  const privacy = value => ({ private: 'Privat', public: 'Öffentlich', unlisted: 'Nicht gelistet' })[value] || '';
  const clearThumbnailPreview = () => {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    thumbnailUrl = undefined;
    $('yt-thumbnail').value = '';
    $('yt-new-thumbnail').removeAttribute('src');
    $('yt-new-thumbnail-box').hidden = true;
  };
  const number = value =>
    value === undefined || value === null || value === '' || !Number.isFinite(Number(value))
      ? '–'
      : new Intl.NumberFormat('de-DE').format(Number(value));
  const shortDate = value => {
    const date = value && new Date(value);
    return date && Number.isFinite(date.getTime()) ? date.toLocaleDateString('de-DE') : '';
  };
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const stat = (label, value, hint) => {
    const box = element('div', 'yt-stat');
    // The hint lives inside the <dd>: a definition list may only contain term/description pairs.
    const description = element('dd');
    description.append(element('b', '', value));
    if (hint) description.append(element('small', '', hint));
    box.append(element('dt', '', label), description);
    return box;
  };
  const badge = (text, tone = '') => {
    const node = element('span', 'yt-badge', text);
    if (tone) node.dataset.tone = tone;
    return node;
  };
  const emptyRow = (container, text) => container.replaceChildren(element('p', 'yt-note yt-empty-row', text));
  // A selectable row: one button with a title line and a quieter meta line.
  const rowButton = (title, meta, pressed, choose) => {
    const b = element('button', 'yt-row');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(Boolean(pressed)));
    const text = element('span', 'yt-row-text');
    text.append(element('strong', '', title));
    if (meta) text.append(element('small', '', meta));
    b.append(text);
    b.addEventListener('click', () => run(b, choose));
    return b;
  };
  function renderOverviewVideos() {
    const box = $('yt-ov-videos');
    box.replaceChildren();
    $('yt-ov-videos-status').textContent = library.length
      ? ''
      : 'Noch keine Videos vorhanden. Lade eine fertige Produktion hoch, um zu starten.';
    for (const item of library.slice(0, 4)) {
      const b = element('button', 'yt-ov-video');
      b.type = 'button';
      const cover = element('span', 'yt-video-cover');
      thumbnail(cover, item.snippet.thumbnails, item.snippet.title);
      const text = element('span', 'yt-row-text');
      text.append(
        element('strong', '', item.snippet.title),
        element(
          'small',
          '',
          [privacy(item.status?.privacyStatus), shortDate(item.snippet.publishedAt)].filter(Boolean).join(' · ')
        )
      );
      b.append(cover, text);
      b.addEventListener('click', () =>
        run(b, async () => {
          await loadVideo(item.id);
          await selectTab('videos');
        })
      );
      box.append(b);
    }
  }
  function renderChannel() {
    const statistics = channel?.statistics || {},
      title = channel?.snippet?.title || '';
    const tiles = () => [
      stat('Abonnenten', statistics.hiddenSubscriberCount ? 'verborgen' : number(statistics.subscriberCount)),
      stat('Videos', number(statistics.videoCount)),
      stat('Aufrufe gesamt', number(statistics.viewCount))
    ];
    const summary = element('dl', 'yt-stats');
    summary.append(...tiles());
    $('yt-channel-summary').replaceChildren(element('p', 'yt-summary-title', title), summary);
    $('yt-ov-title').textContent = title;
    $('yt-ov-handle').textContent = channel?.snippet?.customUrl || '';
    const avatar = $('yt-ov-avatar'),
      url = imageUrl(channel?.snippet?.thumbnails?.default?.url || '');
    avatar.replaceChildren();
    if (url) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = url;
      img.referrerPolicy = 'no-referrer';
      img.addEventListener('error', () => avatar.replaceChildren(title.slice(0, 1).toUpperCase()), { once: true });
      avatar.append(img);
    } else avatar.textContent = title.slice(0, 1).toUpperCase();
    $('yt-ov-open').hidden = !channel;
    if (channel) $('yt-ov-open').href = 'https://www.youtube.com/channel/' + encodeURIComponent(channel.id);
    $('yt-ov-stats').replaceChildren(
      ...tiles(),
      stat('Aufrufe', '…', 'letzte 28 Tage'),
      stat('Wiedergabezeit', '…', 'letzte 28 Tage')
    );
  }
  // The two 28-day tiles are optional: without the analytics permission they explain how to get it.
  async function loadOverviewAnalytics() {
    const request = ++overviewRequest,
      tiles = [...$('yt-ov-stats').children].slice(3);
    if (tiles.length < 2) return;
    let row = null,
      denied = false;
    try {
      row = (await api('analytics', { account_id: account(), days: 28, dimension: 'summary' }))?.rows?.[0] || null;
    } catch (error) {
      denied = error.status === 403;
    }
    if (request !== overviewRequest) return;
    tiles[0].querySelector('dd b').textContent = row ? A.format(row.views, 'count') : '–';
    tiles[1].querySelector('dd b').textContent = row ? A.format(row.estimatedMinutesWatched, 'hours') : '–';
    if (!row)
      for (const tile of tiles)
        tile.querySelector('small').textContent = denied ? 'Analyse-Zugriff fehlt' : 'letzte 28 Tage · keine Daten';
  }
  function showConnected(connected) {
    $('yt-onboarding').hidden = connected;
    $('yt-dashboard').hidden = !connected;
  }
  function resetVideos() {
    overviewRequest++;
    $('yt-ov-videos').replaceChildren();
    $('yt-ov-stats').replaceChildren();
    $('yt-ov-title').textContent = 'Kanal wird geladen …';
    selectComment(null);
    selectPlaylist(null);
    $('yt-comments-status').textContent = '';
    $('yt-playlists-status').textContent = '';
    analyticsRequest++;
    analyticsCache = null;
    analyticsContext = '';
    analyticsVideoRows = [];
    analyticsMetadata.clear();
    $('yt-analytics-report').hidden = true;
    $('yt-analytics-empty').hidden = true;
    video = null;
    channel = null;
    playlists = [];
    comments = [];
    videoRequest++;
    libraryRequest++;
    library = [];
    videoPage = null;
    $('yt-player').replaceChildren();
    $('yt-video-editor').hidden = true;
    $('yt-video-empty').hidden = false;
    $('yt-current-thumbnail').hidden = true;
    $('yt-asset-context').textContent = 'Wähle zuerst unter Videos ein Video oder gib seine ID ein.';
    $('yt-caption-video').value = '';
    $('yt-caption-id').value = '';
    $('yt-caption-text').value = '';
    $('yt-video-search').value = '';
    clearThumbnailPreview();
    for (const id of ['yt-videos', 'yt-playlists', 'yt-comments', 'yt-captions']) $(id).replaceChildren();
    $('yt-video-list-status').textContent = 'Verbinde deinen Kanal, um deine Videos zu sehen.';
  }
  function renderPlayer() {
    const container = $('yt-player');
    container.replaceChildren();
    if (!video || !videoId(video.id)) return;
    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'yt-play';
    play.setAttribute('aria-label', 'Video abspielen: ' + video.snippet.title);
    thumbnail(play, video.snippet.thumbnails, video.snippet.title);
    const label = document.createElement('span');
    label.className = 'yt-play-label';
    label.textContent = '▶ Video abspielen';
    play.append(label);
    play.addEventListener('click', () => {
      const iframe = document.createElement('iframe');
      iframe.src = 'https://www.youtube-nocookie.com/embed/' + video.id + '?autoplay=1&playsinline=1&rel=0';
      iframe.title = 'YouTube-Player: ' + video.snippet.title;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      container.replaceChildren(iframe);
    });
    container.append(play);
    $('yt-player-note').textContent =
      video.status.embeddable === false
        ? 'Die Einbettung ist für dieses Video deaktiviert. Öffne es auf YouTube.'
        : video.status.privacyStatus === 'private'
          ? 'Privates Video: Der YouTube-Player kann die Wiedergabe hier einschränken. Öffne es bei Bedarf auf YouTube mit deinem berechtigten Google-Konto.'
          : 'Der YouTube-Player wird erst beim Abspielen geladen. Falls YouTube die Einbettung einschränkt, öffne das Video direkt auf YouTube.';
    play.disabled = video.status.embeddable === false;
  }
  function renderVideoList() {
    const container = $('yt-videos'),
      query = $('yt-video-search').value.trim().toLocaleLowerCase();
    container.replaceChildren();
    const matches = library.filter(x => x.snippet.title.toLocaleLowerCase().includes(query));
    $('yt-video-list-status').textContent = library.length
      ? matches.length + ' von ' + library.length + ' geladenen Videos' + (videoPage ? ' · weitere verfügbar' : '')
      : 'Noch keine Videos vorhanden. Eine fertige Produktion kannst du unter „Hochladen“ übernehmen.';
    if (!matches.length && library.length)
      $('yt-video-list-status').textContent = 'Kein geladenes Video passt zu deiner Suche.';
    for (const item of matches) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'yt-video-card';
      b.dataset.videoId = item.id;
      b.setAttribute('aria-pressed', String(video?.id === item.id));
      const cover = document.createElement('span');
      cover.className = 'yt-video-cover';
      thumbnail(cover, item.snippet.thumbnails, item.snippet.title);
      const text = document.createElement('span'),
        title = document.createElement('strong'),
        meta = document.createElement('small');
      title.textContent = item.snippet.title;
      const published = item.snippet.publishedAt && new Date(item.snippet.publishedAt);
      meta.textContent = [
        privacy(item.status?.privacyStatus),
        published && Number.isFinite(published.getTime()) ? published.toLocaleDateString('de-DE') : ''
      ]
        .filter(Boolean)
        .join(' · ');
      text.append(title, meta);
      b.append(cover, text);
      b.setAttribute('aria-label', item.snippet.title);
      b.addEventListener('click', () => run(b, () => loadVideo(item.id)));
      container.append(b);
    }
  }
  function drawAnalyticsTrend() {
    const metric = analyticsDefinitions.find(item => item.key === analyticsMetric) || analyticsDefinitions[0];
    $('yt-analytics-chart-title').textContent = metric.label + ' im Zeitverlauf';
    if (analyticsCache?.daily) {
      A.chart($('yt-analytics-chart'), analyticsCache.daily.rows, metric, {
        dateKey: 'day',
        title: $('yt-analytics-chart-title'),
        context: $('yt-analytics-chart-context'),
        insight: $('yt-analytics-chart-insight')
      });
    } else {
      A.chartState(
        $('yt-analytics-chart'),
        'Der Tagesverlauf konnte nicht geladen werden. Die übrige Auswertung bleibt verfügbar.'
      );
      $('yt-analytics-chart-insight').textContent = 'Keine fehlenden Tageswerte ergänzt.';
    }
  }
  function renderAnalyticsVideos() {
    const tbody = $('yt-analytics-rows'),
      term = $('yt-analytics-search').value.toLocaleLowerCase('de-DE');
    tbody.replaceChildren();
    const rows = analyticsVideoRows
      .filter(row =>
        [analyticsMetadata.get(row.video)?.snippet?.title, row.video].some(value =>
          String(value || '')
            .toLocaleLowerCase('de-DE')
            .includes(term)
        )
      )
      .sort((a, b) => (analyticsOrder === 'asc' ? 1 : -1) * (Number(a[analyticsSort]) - Number(b[analyticsSort])));
    const maximum = Math.max(1, ...rows.map(row => Number(row.views) || 0));
    rows.slice(0, analyticsVisible).forEach(row => {
      const meta = analyticsMetadata.get(row.video),
        tr = document.createElement('tr'),
        identity = document.createElement('td'),
        button = document.createElement('button');
      button.type = 'button';
      button.className = 'yt-analytics-video';
      const cover = document.createElement('span');
      cover.className = 'yt-analytics-cover';
      const thumbnail = imageUrl(
        meta?.snippet?.thumbnails?.medium?.url || meta?.snippet?.thumbnails?.default?.url || ''
      );
      if (thumbnail) {
        const img = document.createElement('img');
        img.src = thumbnail;
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener(
          'error',
          () => {
            cover.textContent = '▶';
          },
          { once: true }
        );
        cover.append(img);
      } else cover.textContent = '▶';
      const text = document.createElement('span'),
        title = document.createElement('strong'),
        detail = document.createElement('small');
      title.textContent = meta?.snippet?.title || 'Video ' + row.video;
      detail.textContent = meta?.snippet?.publishedAt
        ? 'Veröffentlicht am ' + A.date(meta.snippet.publishedAt, true)
        : row.video;
      text.append(title, detail);
      button.append(cover, text);
      button.onclick = () =>
        run(button, async () => {
          await loadVideo(row.video);
          await selectTab('videos');
        });
      identity.append(button);
      tr.append(identity);
      for (const [key, kind] of [
        ['views', 'count'],
        ['estimatedMinutesWatched', 'hours'],
        ['averageViewDuration', 'duration']
      ]) {
        const td = document.createElement('td'),
          value = document.createElement('span');
        value.textContent = A.format(row[key], kind);
        td.append(value);
        if (key === 'views') {
          const bar = document.createElement('span');
          bar.className = 'yt-analytics-bar';
          bar.setAttribute('aria-hidden', 'true');
          const fill = document.createElement('span');
          fill.style.width = Math.max(0, Math.min(100, (Number(row.views) / maximum) * 100)) + '%';
          bar.append(fill);
          td.append(bar);
        }
        tr.append(td);
      }
      tbody.append(tr);
    });
    if (!rows.length) {
      const tr = document.createElement('tr'),
        td = document.createElement('td');
      td.colSpan = 4;
      td.textContent = analyticsCache?.videos
        ? term
          ? 'Keine Videos für diesen Suchbegriff.'
          : 'Für diesen Zeitraum wurden keine Videowerte gemeldet.'
        : 'Videowerte konnten nicht geladen werden. Versuche es erneut.';
      tr.append(td);
      tbody.append(tr);
    }
    $('yt-analytics-video-count').textContent =
      Math.min(analyticsVisible, rows.length) + ' von ' + rows.length + ' Videos';
    $('yt-analytics-more').hidden = analyticsVisible >= rows.length;
  }
  function analyticsGate(title, copy, connect) {
    $('yt-analytics-empty').hidden = false;
    $('yt-analytics-report').hidden = true;
    $('yt-analytics-empty').querySelector('h3').textContent = title;
    $('yt-analytics-empty').querySelector('p').textContent = copy;
    $('yt-analytics-connect').hidden = !connect;
  }
  async function loadAnalytics() {
    const request = ++analyticsRequest,
      status = $('yt-analytics-status');
    let accountId;
    try {
      accountId = account();
    } catch {
      analyticsCache = null;
      analyticsGate(
        'Verbinde deinen YouTube-Kanal',
        'Wähle eine Kanalverbindung aus. Danach kannst du seine Aufrufe und Wiedergabezeit auswerten.',
        true
      );
      status.textContent = 'Noch kein Kanal ausgewählt.';
      return;
    }
    const days = Number($('yt-analytics-days').value),
      context = accountId + '|' + days;
    if (context !== analyticsContext) {
      analyticsCache = null;
      analyticsVideoRows = [];
      $('yt-analytics-report').hidden = false;
      $('yt-analytics-empty').hidden = true;
      A.metrics($('yt-analytics-metrics'), analyticsDefinitions, {}, {});
      A.chartState($('yt-analytics-chart'), 'Videoanalyse wird geladen …');
      $('yt-analytics-rows').replaceChildren();
    }
    analyticsContext = context;
    $('yt-analytics-error').hidden = true;
    $('yt-analytics-report').setAttribute('aria-busy', 'true');
    status.textContent = 'Videoanalyse wird geladen …';
    const report = dimension => api('analytics', { account_id: accountId, days, dimension });
    const results = await Promise.allSettled([report('summary'), report('video'), report('day')]);
    if (request !== analyticsRequest) return;
    $('yt-analytics-report').removeAttribute('aria-busy');
    const [summary, videos, daily] = results.map(result => (result.status === 'fulfilled' ? result.value : null)),
      failed = results.filter(result => result.status === 'rejected');
    if (!summary && !videos && !daily) {
      const permission = failed.some(result => result.reason.status === 403);
      status.textContent = 'Videoanalyse nicht verfügbar.';
      if (analyticsCache && !permission) {
        $('yt-analytics-error').hidden = false;
        $('yt-analytics-error-text').textContent =
          'Die zuletzt geladene Auswertung bleibt sichtbar. Prüfe die Verbindung und versuche es erneut.';
        return;
      }
      analyticsCache = null;
      analyticsVideoRows = [];
      analyticsGate(
        permission ? 'Lesezugriff auf Videoanalyse fehlt' : 'Keine Auswertung verfügbar',
        permission
          ? 'Erteile bei Google den zusätzlichen Lesezugriff für diesen Kanal. Deine Videos werden dabei nicht verändert.'
          : 'YouTube konnte die Auswertung gerade nicht bereitstellen. Prüfe die Verbindung und versuche es erneut.',
        permission
      );
      if (!permission) {
        $('yt-analytics-error').hidden = false;
        $('yt-analytics-error-text').textContent = 'Die Anfrage wurde nicht abgeschlossen.';
      }
      return;
    }
    analyticsCache = { summary, videos, daily };
    analyticsVisible = 10;
    analyticsVideoRows = videos?.rows || [];
    $('yt-analytics-empty').hidden = true;
    $('yt-analytics-report').hidden = false;
    const range = summary || daily || videos;
    $('yt-analytics-period').textContent = A.date(range.start_date, true) + ' – ' + A.date(range.end_date, true);
    $('yt-analytics-freshness').textContent =
      'YouTube Analytics · Abgerufen um ' +
      new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date()) +
      ' · Die jüngsten Tage können noch fehlen.';
    A.metrics($('yt-analytics-metrics'), analyticsDefinitions, summary?.rows?.[0] || {}, {}, metric => {
      analyticsMetric = metric.key;
      drawAnalyticsTrend();
    });
    drawAnalyticsTrend();
    $('yt-analytics-days-rows').replaceChildren();
    for (const row of daily?.rows || []) {
      const tr = document.createElement('tr');
      for (const valueofRow of [
        A.date(row.day, true),
        A.format(row.views, 'count'),
        A.format(row.estimatedMinutesWatched, 'hours')
      ]) {
        const td = document.createElement('td');
        td.textContent = valueofRow;
        tr.append(td);
      }
      $('yt-analytics-days-rows').append(tr);
    }
    if (!daily?.rows?.length) {
      const tr = document.createElement('tr'),
        td = document.createElement('td');
      td.colSpan = 3;
      td.textContent = daily
        ? 'Für diesen Zeitraum wurden keine Tageswerte gemeldet.'
        : 'Tageswerte konnten nicht geladen werden. Aktualisiere die Auswertung.';
      tr.append(td);
      $('yt-analytics-days-rows').append(tr);
    }
    if (failed.length) {
      $('yt-analytics-error').hidden = false;
      $('yt-analytics-error-text').textContent =
        'Ein Teil der Auswertung fehlt. Erfolgreich geladene Kennzahlen bleiben verfügbar. Aktualisiere die Ansicht, um den fehlenden Teil erneut zu laden.';
    }
    analyticsMetadata = new Map(library.map(item => [item.id, item]));
    renderAnalyticsVideos();
    status.textContent = failed.length ? 'Videoanalyse teilweise geladen.' : 'Videoanalyse geladen.';
    $('yt-analytics-video-notice').textContent = '';
    const missing = analyticsVideoRows.map(row => row.video).filter(id => videoId(id) && !analyticsMetadata.has(id));
    if (missing.length) {
      try {
        const details = await read('videos.list', { part: 'snippet', id: missing.join(',') });
        if (request !== analyticsRequest) return;
        for (const item of details.items || []) analyticsMetadata.set(item.id, item);
        renderAnalyticsVideos();
      } catch {
        if (request === analyticsRequest)
          $('yt-analytics-video-notice').textContent =
            'Einige Videotitel konnten nicht geladen werden. Die Kennzahlen bleiben verfügbar.';
      }
    }
  }
  $('yt-analytics-search').addEventListener('input', () => {
    analyticsVisible = 10;
    renderAnalyticsVideos();
  });
  $('yt-analytics-more').onclick = () => {
    analyticsVisible += 10;
    renderAnalyticsVideos();
  };
  document.querySelectorAll('[data-video-sort]').forEach(
    button =>
      (button.onclick = () => {
        analyticsOrder =
          analyticsSort === button.dataset.videoSort ? (analyticsOrder === 'desc' ? 'asc' : 'desc') : 'desc';
        analyticsSort = button.dataset.videoSort;
        analyticsVisible = 10;
        document.querySelectorAll('[data-video-sort]').forEach(item => item.closest('th').removeAttribute('aria-sort'));
        button.closest('th').setAttribute('aria-sort', analyticsOrder === 'asc' ? 'ascending' : 'descending');
        renderAnalyticsVideos();
      })
  );
  $('yt-analytics-days').onchange = () => loadAnalytics();
  click('yt-analytics-retry', loadAnalytics);
  click('yt-analytics-load', loadAnalytics);
  click('yt-analytics-connect', async () => {
    if (!$('yt-account').value) {
      await openConnection();
      return;
    }
    const result = await api('oauth/start', { memberships: false, analytics: true });
    window.location.assign(result.url);
  });
  const selectTab = async (tab, load = true) => {
    selectedTab = tab;
    for (const el of document.querySelectorAll('[data-panel]')) el.hidden = el.dataset.panel !== tab;
    for (const el of document.querySelectorAll('[data-tab]')) {
      // Thumbnail & Untertitel is a sub-view of the selected video.
      const selected = el.dataset.tab === (tab === 'captions' ? 'videos' : tab);
      el.setAttribute('aria-current', selected ? 'page' : 'false');
      el.setAttribute('aria-selected', String(selected));
      el.tabIndex = selected ? 0 : -1;
    }
    if (location.hash.slice(1).split('?')[0] !== tab) history.replaceState(null, '', '#' + tab);
    if (!load) return;
    $('yt-player').replaceChildren();
    if (tab === 'videos') {
      if (video) renderPlayer();
      if (channel && !library.length) await loadVideos();
    }
    if (tab === 'overview' && channel) {
      if (!library.length) await loadVideos();
      await loadOverviewAnalytics();
    }
    if (tab === 'analytics') await loadAnalytics();
    if (tab === 'comments' && channel && !comments.length) await loadComments();
    if (tab === 'playlists' && channel) {
      if (!playlists.length) await loadPlaylists();
      if (!library.length) await loadVideos().catch(() => {});
      renderPlaylistPicker();
    }
    if (tab === 'captions') {
      await importSuiteThumbnail();
      if (video && !captions.length) await loadCaptions().catch(() => {});
    }
    if (tab === 'upload') {
      await loadJobs();
      if ($('yt-account').value) await loadUploads();
    }
    if (tab === 'advanced' && !catalog) await loadCatalog();
  };
  for (const b of document.querySelectorAll('[data-tab]'))
    b.addEventListener('click', () => run(b, () => selectTab(b.dataset.tab)));
  for (const b of document.querySelectorAll('[data-go]'))
    b.addEventListener('click', () => run(b, () => selectTab(b.dataset.go)));
  async function openConnection() {
    await selectTab('channel', false);
    $('yt-connection-settings').open = true;
    (state?.configured ? $('yt-connect') : $('yt-client-id')).focus();
  }
  click('yt-onboarding-start', openConnection);
  async function review(promise) {
    const result = await promise;
    pending = result;
    $('yt-review').hidden = false;
    const [resource, verb] = String(result.action || '').split('.');
    $('yt-review-action').textContent = result.action
      ? (names[resource] || resource) + ' · ' + (verbs[verb] || verb)
      : '';
    $('yt-review-warning').textContent = result.warning;
    $('yt-review-content').textContent = JSON.stringify({ ...result, preview_token: undefined }, null, 2);
    $('yt-review-result').textContent = 'Noch nicht ausgeführt. Diese Vorschau gilt zehn Minuten.';
    $('yt-execute').disabled = false;
    $('yt-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  click('yt-check-change', async () => {
    if (!pending) throw Error('Keine offene Änderungsvorschau.');
    const result = await api('change-status', { preview_token: pending.preview_token });
    $('yt-review-result').textContent = JSON.stringify(result, null, 2);
  });
  click('yt-cancel', async () => {
    pending = null;
    $('yt-review').hidden = true;
    notify('Vorschau verworfen. Keine Änderung ausgeführt.');
  });
  click('yt-execute', async () => {
    if (!pending) throw Error('Zuerst eine Änderungsvorschau erstellen.');
    const token = pending.preview_token;
    const result = await api('execute', { preview_token: token, approved: true });
    $('yt-review-result').textContent = 'Änderung bestätigt: ' + JSON.stringify(result.result);
    pending = null;
    notify('Die geprüfte Änderung wurde ausgeführt.');
    if (selectedTab === 'upload') await loadUploads();
  });
  async function loadStatus() {
    const previousAccount = $('yt-account').value;
    state = await api('status');
    choices(
      'yt-account',
      state.accounts,
      x =>
        x.title +
        (state.accounts.filter(item => item.title === x.title).length > 1 ? ' · ' + x.channel_id.slice(-6) : '')
    );
    if (!state.accounts.length) $('yt-account').append(new Option('Noch kein Kanal verbunden', ''));
    if (!state.accounts.length || previousAccount !== $('yt-account').value) resetVideos();
    $('yt-client-id').value = state.client_id;
    $('yt-client-secret').value = '';
    $('yt-callback').textContent = state.redirect_uri;
    $('yt-status').textContent = state.accounts.length
      ? 'Google-Verbindung bereit. Änderungen benötigen eine eigene Freigabe.'
      : state.configured
        ? 'Google-Client bereit. Verbinde jetzt deinen Kanal.'
        : 'Google-OAuth-Client einrichten und anschließend den Kanal verbinden.';
    $('yt-connect').disabled = !state.configured;
    $('yt-connect').textContent = state.accounts.length ? 'Weiteren Kanal verbinden' : 'Mit Google verbinden';
    $('yt-status').dataset.state = state.accounts.length ? 'ready' : 'setup';
    showConnected(Boolean(state.accounts.length));
    if (state.accounts.length) {
      await loadChannel();
      if (['videos', 'overview'].includes(selectedTab)) await loadVideos();
      if (selectedTab === 'overview') loadOverviewAnalytics();
    }
  }
  click('yt-refresh', loadStatus);
  click('yt-configure', async () => {
    await api('configure', { client_id: $('yt-client-id').value.trim(), client_secret: $('yt-client-secret').value });
    await loadStatus();
    notify('Google-Verbindungseinstellungen verschlüsselt gespeichert.');
  });
  click('yt-connect', async () => {
    const result = await api('oauth/start', {
      memberships: $('yt-memberships').checked,
      analytics: $('yt-analytics-consent').checked
    });
    window.location.assign(result.url);
  });
  click('yt-disconnect', async () => {
    if (!$('yt-disconnect-approval').checked) throw Error('Widerruf zuerst mit dem Kontrollfeld bestätigen.');
    await api('disconnect', { account_id: account(), approved: true });
    $('yt-disconnect-approval').checked = false;
    pending = null;
    $('yt-review').hidden = true;
    await loadStatus();
    notify('Google-Zugriff widerrufen. Bestehende YouTube-Videos bleiben erhalten.');
  });
  $('yt-account').addEventListener('change', () =>
    run($('yt-account'), async () => {
      pending = null;
      $('yt-review').hidden = true;
      resetVideos();
      playlist = null;
      videoPage = null;
      commentPage = null;
      for (const id of ['yt-videos', 'yt-playlists', 'yt-comments', 'yt-captions']) $(id).replaceChildren();
      await loadChannel();
      if (['videos', 'overview'].includes(selectedTab)) await loadVideos();
      if (selectedTab === 'overview') await loadOverviewAnalytics();
      if (selectedTab === 'analytics') await loadAnalytics();
      if (selectedTab === 'comments') await loadComments();
      if (selectedTab === 'playlists') await loadPlaylists();
    })
  );
  async function loadChannel() {
    const result = await read('channels.list', {
      part: 'snippet,statistics,brandingSettings,contentDetails',
      mine: true
    });
    const active = state.accounts.find(x => x.id === account());
    channel = result.items?.find(x => x.id === active.channel_id);
    if (!channel) throw Error('Der ausgewählte Kanal ist bei Google nicht mehr freigegeben. Bitte erneut verbinden.');
    const branding = channel.brandingSettings?.channel || {};
    renderChannel();
    $('yt-channel-title').value = branding.title || channel.snippet.title;
    $('yt-channel-description').value = branding.description || channel.snippet.description || '';
    $('yt-channel-keywords').value = branding.keywords || '';
    $('yt-channel-language').value = branding.defaultLanguage || '';
    $('yt-channel-country').value = branding.country || '';
    $('yt-channel-trailer').value = branding.unsubscribedTrailer || '';
    $('yt-channel-banner').value = channel.brandingSettings?.image?.bannerExternalUrl || '';
  }
  submit('yt-brand-form', async () => {
    if (!channel) throw Error('Kanal zuerst laden.');
    const branding = structuredClone(channel.brandingSettings || {});
    branding.channel = {
      ...branding.channel,
      title: $('yt-channel-title').value,
      description: $('yt-channel-description').value,
      keywords: $('yt-channel-keywords').value,
      defaultLanguage: $('yt-channel-language').value,
      country: $('yt-channel-country').value,
      unsubscribedTrailer: $('yt-channel-trailer').value
    };
    if ($('yt-channel-banner').value)
      branding.image = { ...branding.image, bannerExternalUrl: $('yt-channel-banner').value };
    await preview(
      'channels.update',
      { part: 'brandingSettings' },
      { id: channel.id, brandingSettings: branding },
      undefined,
      channel.etag
    );
  });
  async function loadVideos(more = false) {
    const request = ++libraryRequest;
    $('yt-video-list-status').textContent = 'Videos werden geladen …';
    try {
      if (!channel) await loadChannel();
      const id = channel.contentDetails?.relatedPlaylists?.uploads;
      if (!id) throw Error('Google hat keine Upload-Playlist geliefert.');
      const result = await read('playlistItems.list', {
        part: 'snippet,contentDetails',
        playlistId: id,
        maxResults: 25,
        ...(more && videoPage ? { pageToken: videoPage } : {})
      });
      const ids = (result.items || []).map(x => x.contentDetails.videoId).filter(videoId);
      const details = ids.length
        ? await read('videos.list', { part: 'snippet,status', id: ids.join(',') })
        : { items: [] };
      if (request !== libraryRequest) return;
      videoPage = result.nextPageToken;
      $('yt-more-videos').disabled = !videoPage;
      const items = ids.map(id => details.items?.find(x => x.id === id)).filter(Boolean);
      library = more ? [...new Map([...library, ...items].map(x => [x.id, x])).values()] : items;
      renderVideoList();
      renderOverviewVideos();
      renderPlaylistPicker();
    } catch (error) {
      if (request === libraryRequest)
        $('yt-video-list-status').textContent = 'Videos konnten nicht geladen werden. Bitte erneut versuchen.';
      throw error;
    }
  }
  $('yt-video-search').addEventListener('input', renderVideoList);
  click('yt-load-videos', () => loadVideos());
  click('yt-more-videos', () => loadVideos(true));
  async function loadVideo(id) {
    if (!videoId(id)) throw Error('Bitte eine gültige YouTube-Video-ID mit elf Zeichen eingeben.');
    const request = ++videoRequest;
    const result = await read('videos.list', { part: 'snippet,status,localizations,recordingDetails', id });
    if (request !== videoRequest) return;
    video = result.items?.[0];
    if (!video) throw Error('Video nicht gefunden.');
    if (!categories) {
      try {
        categories = (await read('videoCategories.list', { part: 'snippet', regionCode: 'DE', hl: 'de' })).items || [];
      } catch {
        categories = [];
      }
      if (request !== videoRequest) return;
    }
    $('yt-video-id').value = video.id;
    $('yt-video-title').value = video.snippet.title;
    $('yt-video-description').value = video.snippet.description || '';
    $('yt-video-tags').value = (video.snippet.tags || []).join(', ');
    choices(
      'yt-video-category',
      categories.map(x => ({ id: x.id, title: x.snippet.title })),
      x => x.title
    );
    if (![...$('yt-video-category').options].some(x => x.value === video.snippet.categoryId))
      $('yt-video-category').add(new Option('Kategorie ' + video.snippet.categoryId, video.snippet.categoryId));
    $('yt-video-category').value = video.snippet.categoryId;
    $('yt-video-privacy').value = video.status.privacyStatus;
    const language = video.snippet.defaultLanguage || '';
    if (![...$('yt-video-language').options].some(x => x.value === language))
      $('yt-video-language').add(new Option(language, language));
    $('yt-video-language').value = language;
    $('yt-video-kids').checked = Boolean(video.status.selfDeclaredMadeForKids);
    $('yt-video-synthetic').checked = Boolean(video.status.containsSyntheticMedia);
    $('yt-video-publish').value = video.status.publishAt ? localDateTime(video.status.publishAt) : '';
    $('yt-caption-video').value = video.id;
    $('yt-video-empty').hidden = true;
    $('yt-video-editor').hidden = false;
    $('yt-selected-title').textContent = video.snippet.title;
    $('yt-watch').href = 'https://www.youtube.com/watch?v=' + video.id;
    $('yt-studio').href = 'https://studio.youtube.com/video/' + video.id + '/edit';
    $('yt-asset-context').textContent = 'Ausgewähltes Video: ' + video.snippet.title;
    const url = ['maxres', 'standard', 'high', 'medium', 'default']
      .map(key => imageUrl(video.snippet.thumbnails?.[key]?.url))
      .find(Boolean);
    $('yt-current-thumbnail').hidden = !url;
    if (url) $('yt-current-thumbnail').src = url;
    else $('yt-current-thumbnail').removeAttribute('src');
    clearThumbnailPreview();
    captions = [];
    $('yt-captions').replaceChildren();
    $('yt-caption-id').value = '';
    $('yt-caption-text').value = '';
    $('yt-caption-name').value = '';
    $('yt-caption-language').value = video.snippet.defaultLanguage || '';
    $('yt-caption-draft').checked = false;
    renderPlayer();
    renderVideoList();
  }
  click('yt-edit-assets', async () => {
    await selectTab('captions');
    document.querySelector('[data-panel="captions"]').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  function localDateTime(value) {
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  click('yt-video-load', () => loadVideo($('yt-video-id').value.trim()));
  submit('yt-video-form', async () => {
    const id = $('yt-video-id').value.trim();
    if (!video || video.id !== id) throw Error('Video zuerst über „Video laden“ oder aus der Liste auswählen.');
    const snippet = {
      title: $('yt-video-title').value,
      description: $('yt-video-description').value,
      tags: $('yt-video-tags')
        .value.split(',')
        .map(s => s.trim())
        .filter(Boolean),
      categoryId: $('yt-video-category').value
    };
    if ($('yt-video-language').value) snippet.defaultLanguage = $('yt-video-language').value;
    if (video.snippet.defaultAudioLanguage) snippet.defaultAudioLanguage = video.snippet.defaultAudioLanguage;
    const status = {
      privacyStatus: $('yt-video-privacy').value,
      selfDeclaredMadeForKids: $('yt-video-kids').checked,
      containsSyntheticMedia: $('yt-video-synthetic').checked
    };
    for (const key of ['embeddable', 'license', 'publicStatsViewable'])
      if (video.status[key] !== undefined) status[key] = video.status[key];
    if ($('yt-video-publish').value) status.publishAt = new Date($('yt-video-publish').value).toISOString();
    await preview('videos.update', { part: 'snippet,status' }, { id, snippet, status }, undefined, video.etag);
  });
  click('yt-delete-video', () => preview('videos.delete', { id: $('yt-video-id').value }));
  function renderPlaylistPicker() {
    const pick = $('yt-playlist-pick'),
      old = pick.value;
    pick.replaceChildren(new Option(library.length ? 'Video auswählen …' : 'Keine Videos geladen', ''));
    for (const item of library) pick.append(new Option(item.snippet.title, item.id));
    if (library.some(item => item.id === old)) pick.value = old;
  }
  $('yt-playlist-pick').addEventListener('change', () => {
    $('yt-playlist-video').value = $('yt-playlist-pick').value;
  });
  function renderPlaylists() {
    const box = $('yt-playlists');
    box.replaceChildren();
    $('yt-playlists-status').textContent = playlists.length
      ? playlists.length + (playlists.length === 1 ? ' Playlist' : ' Playlists')
      : 'Noch keine Playlists. Lege rechts deine erste an.';
    for (const item of playlists) {
      const count = item.contentDetails?.itemCount;
      box.append(
        rowButton(
          item.snippet.title,
          [privacy(item.status?.privacyStatus), count === undefined ? '' : count + (count === 1 ? ' Video' : ' Videos')]
            .filter(Boolean)
            .join(' · '),
          playlist?.id === item.id,
          () => selectPlaylist(item)
        )
      );
    }
  }
  // null starts a new playlist; an item opens it for editing together with its videos.
  async function selectPlaylist(item) {
    playlist = item;
    $('yt-playlist-id').value = item?.id || '';
    $('yt-playlist-title').value = item?.snippet.title || '';
    $('yt-playlist-description').value = item?.snippet.description || '';
    $('yt-playlist-privacy').value = item?.status.privacyStatus || 'private';
    $('yt-playlist-heading').textContent = item ? 'Playlist bearbeiten' : 'Neue Playlist';
    $('yt-playlist-submit').textContent = item ? 'Playliständerung prüfen' : 'Neue Playlist prüfen';
    $('yt-playlist-contents').hidden = !item;
    $('yt-playlist-items-list').replaceChildren();
    renderPlaylists();
    if (item) await loadPlaylistItems();
  }
  async function loadPlaylists() {
    $('yt-playlists-status').textContent = 'Playlists werden geladen …';
    const result = await read('playlists.list', { part: 'snippet,status,contentDetails', mine: true, maxResults: 50 });
    playlists = result.items || [];
    if (playlist) playlist = playlists.find(item => item.id === playlist.id) || null;
    renderPlaylists();
  }
  click('yt-playlist-new', async () => {
    await selectPlaylist(null);
    $('yt-playlist-title').focus();
  });
  // Typing an ID by hand switches between "new" and "edit" like a selection does.
  $('yt-playlist-id').addEventListener('input', () => {
    const typed = Boolean($('yt-playlist-id').value.trim());
    $('yt-playlist-heading').textContent = typed ? 'Playlist bearbeiten' : 'Neue Playlist';
    $('yt-playlist-submit').textContent = typed ? 'Playliständerung prüfen' : 'Neue Playlist prüfen';
    $('yt-playlist-contents').hidden = !typed;
  });
  click('yt-load-playlists', loadPlaylists);
  submit('yt-playlist-form', () => {
    const id = $('yt-playlist-id').value.trim(),
      body = {
        ...(id ? { id } : {}),
        snippet: { title: $('yt-playlist-title').value, description: $('yt-playlist-description').value },
        status: { privacyStatus: $('yt-playlist-privacy').value }
      };
    if (id && playlist?.id === id && playlist.snippet.defaultLanguage)
      body.snippet.defaultLanguage = playlist.snippet.defaultLanguage;
    return preview(id ? 'playlists.update' : 'playlists.insert', { part: 'snippet,status' }, body);
  });
  click('yt-playlist-delete', () => preview('playlists.delete', { id: $('yt-playlist-id').value }));
  async function loadPlaylistItems() {
    const box = $('yt-playlist-items-list');
    const result = await read('playlistItems.list', {
      part: 'snippet,contentDetails',
      playlistId: $('yt-playlist-id').value,
      maxResults: 50
    });
    box.replaceChildren();
    if (!(result.items || []).length) return emptyRow(box, 'Diese Playlist enthält noch keine Videos.');
    for (const item of result.items) {
      const row = element('div', 'yt-row yt-row-static');
      const text = element('span', 'yt-row-text');
      text.append(element('strong', '', item.snippet.title));
      const remove = element('button', 'yt-row-action', 'Entfernen');
      remove.type = 'button';
      remove.setAttribute('aria-label', 'Aus Playlist entfernen: ' + item.snippet.title);
      remove.addEventListener('click', () => run(remove, () => preview('playlistItems.delete', { id: item.id })));
      row.append(text, remove);
      box.append(row);
    }
  }
  click('yt-playlist-items', loadPlaylistItems);
  click('yt-playlist-add', () =>
    preview(
      'playlistItems.insert',
      { part: 'snippet' },
      {
        snippet: {
          playlistId: $('yt-playlist-id').value,
          resourceId: { kind: 'youtube#video', videoId: $('yt-playlist-video').value }
        }
      }
    )
  );
  function selectComment(thread) {
    const top = thread?.snippet.topLevelComment;
    $('yt-comment-id').value = top?.id || '';
    $('yt-comment-text').value = '';
    $('yt-comment-empty').hidden = Boolean(thread);
    $('yt-comment-editor').hidden = !thread;
    if (thread) {
      const quote = $('yt-comment-quote');
      quote.replaceChildren(
        element('strong', '', top.snippet.authorDisplayName),
        element('p', '', top.snippet.textOriginal)
      );
    }
    for (const b of $('yt-comments').children) b.setAttribute('aria-pressed', String(b.dataset.commentId === top?.id));
  }
  function renderComments() {
    const box = $('yt-comments');
    box.replaceChildren();
    $('yt-comments-status').textContent = comments.length
      ? comments.length +
        (comments.length === 1 ? ' Kommentar' : ' Kommentare') +
        (commentPage ? ' · weitere verfügbar' : '')
      : 'In dieser Ansicht gibt es keine Kommentare.';
    const selected = $('yt-comment-id').value;
    for (const thread of comments) {
      const top = thread.snippet.topLevelComment,
        b = element('button', 'yt-comment');
      b.type = 'button';
      b.dataset.commentId = top.id;
      b.setAttribute('aria-pressed', String(top.id === selected));
      const head = element('span', 'yt-comment-head');
      head.append(
        element('strong', '', top.snippet.authorDisplayName),
        element('small', '', shortDate(top.snippet.publishedAt))
      );
      const replies = Number(thread.snippet.totalReplyCount) || 0,
        about = library.find(item => item.id === thread.snippet.videoId)?.snippet.title;
      b.append(head, element('span', 'yt-comment-text', top.snippet.textOriginal));
      const meta = element('span', 'yt-comment-meta');
      if (about) meta.append(element('small', '', 'Zu: ' + about));
      meta.append(
        badge(
          replies ? replies + (replies === 1 ? ' Antwort' : ' Antworten') : 'Unbeantwortet',
          replies ? '' : 'attention'
        )
      );
      b.append(meta);
      b.addEventListener('click', () => selectComment(thread));
      box.append(b);
    }
  }
  async function loadComments(more = false) {
    if (!channel) throw Error('Bitte zuerst einen YouTube-Kanal verbinden und auswählen.');
    $('yt-comments-status').textContent = 'Kommentare werden geladen …';
    const result = await read('commentThreads.list', {
      part: 'snippet,replies',
      allThreadsRelatedToChannelId: channel.id,
      moderationStatus: $('yt-comment-filter').value,
      maxResults: 50,
      ...(more && commentPage ? { pageToken: commentPage } : {})
    });
    commentPage = result.nextPageToken;
    $('yt-more-comments').disabled = !commentPage;
    $('yt-more-comments').hidden = !commentPage;
    comments = more ? [...comments, ...(result.items || [])] : result.items || [];
    if (!more) selectComment(null);
    renderComments();
  }
  $('yt-comment-filter').addEventListener('change', () => run($('yt-comment-filter'), () => loadComments()));
  // A manually typed ID opens the editor without a quoted comment.
  $('yt-comment-id').addEventListener('input', () => {
    const typed = Boolean($('yt-comment-id').value.trim());
    $('yt-comment-editor').hidden = !typed;
    $('yt-comment-empty').hidden = typed;
    $('yt-comment-quote').replaceChildren(element('p', '', 'Kommentar über ID gewählt.'));
  });
  click('yt-load-comments', () => loadComments());
  click('yt-more-comments', () => loadComments(true));
  click('yt-comment-reply', () =>
    preview(
      'comments.insert',
      { part: 'snippet' },
      { snippet: { parentId: $('yt-comment-id').value, textOriginal: $('yt-comment-text').value } }
    )
  );
  click('yt-comment-update', () =>
    preview(
      'comments.update',
      { part: 'snippet' },
      { id: $('yt-comment-id').value, snippet: { textOriginal: $('yt-comment-text').value } }
    )
  );
  click('yt-comment-delete', () => preview('comments.delete', { id: $('yt-comment-id').value }));
  click('yt-comment-moderate', () =>
    preview('comments.setModerationStatus', {
      id: $('yt-comment-id').value,
      moderationStatus: $('yt-comment-moderation').value,
      banAuthor: $('yt-comment-ban').checked
    })
  );
  function selectCaption(track) {
    $('yt-caption-id').value = track?.id || '';
    $('yt-caption-name').value = track?.snippet.name || '';
    $('yt-caption-draft').checked = Boolean(track?.snippet.isDraft);
    if (track) $('yt-caption-language').value = track.snippet.language;
    renderCaptions();
  }
  function renderCaptions() {
    const box = $('yt-captions');
    box.replaceChildren();
    if (!captions.length) return emptyRow(box, 'Dieses Video hat noch keine Untertitelspur.');
    for (const track of captions)
      box.append(
        rowButton(
          track.snippet.name || 'Ohne Namen',
          track.snippet.language + (track.snippet.isDraft ? ' · Entwurf' : ''),
          $('yt-caption-id').value === track.id,
          async () => selectCaption(track)
        )
      );
  }
  async function loadCaptions() {
    if (video?.id !== $('yt-caption-video').value.trim()) await loadVideo($('yt-caption-video').value.trim());
    const result = await read('captions.list', { part: 'snippet', videoId: $('yt-caption-video').value });
    captions = result.items || [];
    renderCaptions();
  }
  click('yt-load-captions', loadCaptions);
  click('yt-caption-new', async () => {
    selectCaption(null);
    $('yt-caption-text').value = '';
    $('yt-caption-name').focus();
  });
  const base64 = text => {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  click('yt-caption-save', () => {
    const id = $('yt-caption-id').value.trim(),
      snippet = { name: $('yt-caption-name').value, isDraft: $('yt-caption-draft').checked };
    if (!id) {
      snippet.videoId = $('yt-caption-video').value;
      snippet.language = $('yt-caption-language').value;
    }
    const media = $('yt-caption-text').value
      ? { mime_type: 'application/octet-stream', data_base64: base64($('yt-caption-text').value) }
      : undefined;
    return preview(
      id ? 'captions.update' : 'captions.insert',
      { part: 'snippet' },
      { ...(id ? { id } : {}), snippet },
      media
    );
  });
  click('yt-caption-delete', () => preview('captions.delete', { id: $('yt-caption-id').value }));
  click('yt-caption-download', async () => {
    const result = await read('captions.download', { id: $('yt-caption-id').value, tfmt: 'srt' });
    const bytes = Uint8Array.from(atob(result.data_base64), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: result.mime_type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'youtube-untertitel.srt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  async function fileMedia(id) {
    const file = $(id).files[0];
    if (!file) return undefined;
    if (file.size > 8 * 1024 * 1024)
      throw Error('Datei ist zu groß (höchstens 8 MiB; Google kann ein niedrigeres Limit vorgeben).');
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    return { mime_type: file.type || 'application/octet-stream', data_base64: data };
  }
  async function importSuiteThumbnail() {
    const id = new URLSearchParams(location.hash.split('?')[1] || '').get('asset');
    if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return;
    const image = new Image();
    image.src = '/api/video-suite/assets/' + encodeURIComponent(id);
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const h = (image.width * 9) / 16;
    canvas.getContext('2d').drawImage(image, 0, (image.height - h) / 2, image.width, h, 0, 0, 1280, 720);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw Error('Titelbild konnte nicht übernommen werden.');
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], 'video-suite-thumbnail.jpg', { type: 'image/jpeg' }));
    $('yt-thumbnail').files = transfer.files;
    $('yt-thumbnail').dispatchEvent(new Event('change'));
    notify('Titelbild aus Video Suite übernommen. Video-ID wählen und Thumbnailänderung prüfen.');
  }
  $('yt-thumbnail').addEventListener('change', () => {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
    thumbnailUrl = undefined;
    $('yt-new-thumbnail-box').hidden = true;
    const file = $('yt-thumbnail').files[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      $('yt-thumbnail').value = '';
      notify('Bitte ein PNG- oder JPEG-Thumbnail bis 2 MiB auswählen.', true);
      return;
    }
    thumbnailUrl = URL.createObjectURL(file);
    $('yt-new-thumbnail').src = thumbnailUrl;
    $('yt-new-thumbnail-box').hidden = false;
  });
  window.addEventListener('beforeunload', () => {
    if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  });
  click('yt-thumbnail-set', async () => {
    const media = await fileMedia('yt-thumbnail');
    if (!media) throw Error('Thumbnail-Datei auswählen.');
    await preview('thumbnails.set', { videoId: $('yt-caption-video').value }, undefined, media);
  });
  async function loadJobs() {
    const r = await fetch('/api/video-studio/jobs', { credentials: 'same-origin' });
    if (!r.ok) throw Error('Video-Studio-Aufträge konnten nicht geladen werden.');
    const jobs = (await r.json()).filter(x => x.status === 'done');
    choices('yt-upload-job', jobs, x => x.title);
    const requestedJob = new URLSearchParams(location.hash.split('?')[1] || '').get('job');
    if (jobs.some(j => j.id === requestedJob)) $('yt-upload-job').value = requestedJob;
    if (new URLSearchParams(location.hash.split('?')[1] || '').get('kind') === 'short')
      $('yt-upload-kind').value = 'short';
    if (!jobs.length) $('yt-upload-job').append(new Option('Keine abgeschlossenen Aufträge vorhanden', ''));
  }
  click('yt-upload-preview', async () => {
    if (!$('yt-upload-declarations').checked) throw Error('Zielgruppe und Kennzeichnung zuerst prüfen und bestätigen.');
    await review(
      api('upload-preview', {
        account_id: account(),
        job_id: $('yt-upload-job').value,
        kind: $('yt-upload-kind').value,
        made_for_kids: $('yt-upload-kids').checked,
        contains_synthetic_media: $('yt-upload-synthetic').checked
      })
    );
  });
  const uploadStates = {
    queued: ['Wartet', ''],
    pending: ['Wartet', ''],
    retry: ['Neuer Versuch folgt', 'progress'],
    uploading: ['Lädt hoch', 'progress'],
    processing: ['Wird verarbeitet', 'progress'],
    done: ['Fertig', 'success'],
    completed: ['Fertig', 'success'],
    failed: ['Fehlgeschlagen', 'error'],
    cancelled: ['Abgebrochen', '']
  };
  async function loadUploads() {
    const rows = await api('uploads?account_id=' + encodeURIComponent(account()));
    const box = $('yt-uploads');
    box.replaceChildren();
    if (!rows.length) emptyRow(box, 'Noch keine Uploads aus SiteOps.');
    for (const row of rows) {
      const article = element('article', 'yt-upload'),
        [label, tone] = uploadStates[row.status] || [row.status, ''],
        percent = row.total_bytes
          ? Math.max(0, Math.min(100, Math.round((Number(row.uploaded_bytes) / Number(row.total_bytes)) * 100)))
          : null;
      const head = element('div', 'yt-upload-head');
      head.append(
        element(
          'strong',
          '',
          (row.kind === 'short' ? '9:16-Short' : 'Hauptvideo') +
            (shortDate(row.created_at) ? ' · ' + shortDate(row.created_at) : '')
        ),
        badge(label, tone),
        element('small', '', percent === null ? 'Größe wird ermittelt' : percent + ' %')
      );
      article.append(head);
      if (percent !== null) {
        const bar = element('div', 'yt-progress');
        bar.setAttribute('role', 'progressbar');
        bar.setAttribute('aria-valuemin', '0');
        bar.setAttribute('aria-valuemax', '100');
        bar.setAttribute('aria-valuenow', String(percent));
        bar.setAttribute('aria-label', 'Upload-Fortschritt');
        const fill = element('span');
        fill.style.width = percent + '%';
        bar.append(fill);
        article.append(bar);
      }
      if (row.error) article.append(element('p', 'yt-error', row.error));
      if (row.remote_video_id) {
        const a = document.createElement('a');
        a.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(row.remote_video_id);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = 'Video auf YouTube öffnen ↗';
        article.append(a);
      }
      if (row.status === 'failed') {
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Upload fortsetzen';
        retry.addEventListener('click', async () => {
          retry.disabled = true;
          try {
            await api('uploads/retry', { account_id: account(), upload_id: row.id });
            await loadUploads();
          } catch (error) {
            retry.disabled = false;
            retry.textContent = error.message;
          }
        });
        article.append(retry);
      }
      box.append(article);
    }
  }
  click('yt-load-uploads', loadUploads);
  click('yt-asset-jobs', async () => {
    const response = await fetch('/api/video-studio/jobs', { credentials: 'same-origin' });
    if (!response.ok) throw Error('Video-Studio-Aufträge konnten nicht geladen werden.');
    choices(
      'yt-asset-job',
      (await response.json()).filter(x => x.status === 'done'),
      x => x.title
    );
  });
  for (const [button, kind] of [
    ['yt-asset-thumbnail', 'thumbnail'],
    ['yt-asset-subtitles', 'subtitles']
  ])
    click(button, () =>
      review(
        api('asset-preview', {
          account_id: account(),
          job_id: $('yt-asset-job').value,
          video_id: $('yt-caption-video').value,
          kind
        })
      )
    );
  const names = {
    channels: 'Kanal',
    videos: 'Videos',
    playlists: 'Playlists',
    playlistItems: 'Playlist-Inhalte',
    comments: 'Kommentare',
    commentThreads: 'Kommentarverläufe',
    captions: 'Untertitel',
    thumbnails: 'Thumbnails',
    channelBanners: 'Kanalbanner',
    channelSections: 'Kanalabschnitte',
    watermarks: 'Wasserzeichen',
    subscriptions: 'Abonnements',
    liveBroadcasts: 'Live-Sendungen',
    liveStreams: 'Live-Streams',
    liveChatMessages: 'Live-Chat',
    liveChatModerators: 'Live-Moderatoren',
    liveChatBans: 'Live-Sperren',
    members: 'Mitglieder',
    membershipsLevels: 'Mitgliedschaftsstufen',
    activities: 'Aktivitäten',
    search: 'Suche',
    videoCategories: 'Videokategorien'
  };
  const verbs = {
    list: 'Auflisten',
    insert: 'Anlegen',
    update: 'Bearbeiten',
    delete: 'Löschen',
    set: 'Hochladen / setzen',
    unset: 'Entfernen',
    download: 'Herunterladen',
    transition: 'Status wechseln',
    bind: 'Verknüpfen',
    rate: 'Bewerten',
    getRating: 'Bewertung lesen',
    setModerationStatus: 'Moderieren'
  };
  async function loadCatalog() {
    catalog = await api('catalog');
    const resources = [...new Set(catalog.operations.map(x => x.action.split('.')[0]))].sort();
    choices(
      'yt-resource',
      resources.map(id => ({ id })),
      x => names[x.id] || x.id
    );
    await loadOperations();
  }
  async function loadOperations() {
    const operations = catalog.operations.filter(x => x.action.startsWith($('yt-resource').value + '.'));
    choices(
      'yt-operation',
      operations.map(x => ({ id: x.action })),
      x => verbs[x.id.split('.')[1]] || x.id
    );
    await showOperation();
  }
  $('yt-resource').addEventListener('change', () => run($('yt-resource'), loadOperations));
  $('yt-operation').addEventListener('change', () => run($('yt-operation'), showOperation));
  async function showOperation() {
    const operation = catalog.operations.find(x => x.action === $('yt-operation').value);
    $('yt-operation-description').textContent = operation.description;
    const box = $('yt-operation-parameters');
    box.replaceChildren();
    for (const [key, p] of Object.entries(operation.parameters)) {
      const wrapper = document.createElement('div'),
        label = document.createElement('label');
      label.htmlFor = 'yt-param-' + key;
      label.textContent = key + (p.required ? ' *' : '');
      const field = document.createElement(p.enum ? 'select' : 'input');
      field.id = 'yt-param-' + key;
      field.dataset.parameter = key;
      field.dataset.type = p.type || 'string';
      field.required = p.required;
      if (p.enum) {
        field.append(new Option('Auswählen', ''));
        for (const value of p.enum) field.append(new Option(value, value));
      } else field.type = p.type === 'integer' ? 'number' : 'text';
      if (key === 'part') field.value = 'snippet';
      if (key === 'channelId' && channel) field.value = channel.id;
      wrapper.append(label, field);
      box.append(wrapper);
    }
    $('yt-operation-body').value = '';
    $('yt-operation-body').disabled = !operation.request;
    $('yt-operation-file').disabled = !operation.media;
    const info = await api('catalog?action=' + encodeURIComponent(operation.action));
    $('yt-operation-schema').textContent = JSON.stringify(info.schemas || {}, null, 2);
  }
  submit('yt-operation-form', async () => {
    const definition = catalog.operations.find(x => x.action === $('yt-operation').value),
      parameters = {};
    for (const field of document.querySelectorAll('[data-parameter]'))
      if (field.value !== '')
        parameters[field.dataset.parameter] =
          field.dataset.type === 'integer'
            ? Number(field.value)
            : field.dataset.type === 'boolean'
              ? field.value === 'true'
              : field.value;
    const body = $('yt-operation-body').value.trim() ? JSON.parse($('yt-operation-body').value) : undefined,
      media = await fileMedia('yt-operation-file');
    if (definition.method === 'GET')
      $('yt-operation-result').textContent = JSON.stringify(await read(definition.action, parameters), null, 2);
    else await preview(definition.action, parameters, body, media);
  });
  const initialTab = [
    'overview',
    'analytics',
    'upload',
    'videos',
    'channel',
    'playlists',
    'comments',
    'captions',
    'advanced'
  ].includes(location.hash.slice(1).split('?')[0])
    ? location.hash.slice(1).split('?')[0]
    : 'overview';
  selectTab(initialTab, false);
  document.querySelector('.yt-tabs').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...document.querySelectorAll('[data-tab]')],
      index = tabs.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
    tabs[next].focus();
    tabs[next].click();
  });
  loadStatus()
    .then(() => selectTab(initialTab))
    .catch(e => {
      notify(e.message, true);
      $('yt-status').textContent = 'Verbindung konnte nicht geprüft werden.';
      if (initialTab === 'analytics')
        analyticsGate('Verbindung nicht verfügbar', 'Prüfe die Kanalverbindung und lade die Ansicht erneut.', true);
    });
  setInterval(() => {
    if (selectedTab === 'upload' && document.visibilityState === 'visible' && $('yt-account').value)
      loadUploads().catch(e => notify(e.message, true));
  }, 10000);
})();
