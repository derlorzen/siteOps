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
    videoRequest = 0,
    libraryRequest = 0,
    thumbnailUrl,
    categories,
    selectedTab = 'videos';
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
    if (!r.ok) throw Error(x.message || x.error || 'HTTP ' + r.status);
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
  const list = (id, items, label, choose, append = false) => {
    const container = $(id);
    if (!append) container.replaceChildren();
    if (!items.length && !append) {
      container.textContent = 'Keine Einträge vorhanden.';
      return;
    }
    for (const item of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label(item);
      b.addEventListener('click', () => run(b, () => choose(item)));
      container.append(b);
    }
  };
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
  function resetVideos() {
    video = null;
    channel = null;
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
      : 'Noch keine Videos vorhanden. Eine fertige Produktion kannst du unter „Aus Video Studio hochladen“ übernehmen.';
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
  const selectTab = async tab => {
    selectedTab = tab;
    for (const el of document.querySelectorAll('[data-panel]')) el.hidden = el.dataset.panel !== tab;
    for (const el of document.querySelectorAll('[data-tab]'))
      el.setAttribute('aria-current', el.dataset.tab === tab ? 'page' : 'false');
    $('yt-player').replaceChildren();
    if (tab === 'videos') {
      if (video) renderPlayer();
      if (channel && !library.length) await loadVideos();
    }
    if (tab === 'captions') await importSuiteThumbnail();
    if (tab === 'upload') {
      await loadJobs();
      if ($('yt-account').value) await loadUploads();
    }
    if (tab === 'advanced' && !catalog) await loadCatalog();
  };
  for (const b of document.querySelectorAll('[data-tab]'))
    b.addEventListener('click', () => run(b, () => selectTab(b.dataset.tab)));
  async function review(promise) {
    const result = await promise;
    pending = result;
    $('yt-review').hidden = false;
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
    choices('yt-account', state.accounts, x => x.title + ' · ' + x.channel_id);
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
    if (state.accounts.length) {
      await loadChannel();
      if (selectedTab === 'videos') await loadVideos();
    }
  }
  click('yt-refresh', loadStatus);
  click('yt-configure', async () => {
    await api('configure', { client_id: $('yt-client-id').value.trim(), client_secret: $('yt-client-secret').value });
    await loadStatus();
    notify('Google-Verbindungseinstellungen verschlüsselt gespeichert.');
  });
  click('yt-connect', async () => {
    const result = await api('oauth/start', { memberships: $('yt-memberships').checked });
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
      if (selectedTab === 'videos') await loadVideos();
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
    $('yt-channel-summary').textContent =
      channel.snippet.title +
      ' · ' +
      (channel.statistics?.subscriberCount || '–') +
      ' Abonnenten · ' +
      (channel.statistics?.videoCount || '–') +
      ' Videos · ' +
      (channel.statistics?.viewCount || '–') +
      ' Aufrufe';
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
  async function loadPlaylists() {
    const result = await read('playlists.list', { part: 'snippet,status', mine: true, maxResults: 50 });
    list(
      'yt-playlists',
      result.items || [],
      x => x.snippet.title,
      async x => {
        playlist = x;
        $('yt-playlist-id').value = x.id;
        $('yt-playlist-title').value = x.snippet.title;
        $('yt-playlist-description').value = x.snippet.description || '';
        $('yt-playlist-privacy').value = x.status.privacyStatus;
      }
    );
  }
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
  click('yt-playlist-items', async () => {
    const result = await read('playlistItems.list', {
      part: 'snippet,contentDetails',
      playlistId: $('yt-playlist-id').value,
      maxResults: 50
    });
    list(
      'yt-playlist-items-list',
      result.items || [],
      x => x.snippet.title + ' – Aus Playlist entfernen',
      x => preview('playlistItems.delete', { id: x.id })
    );
  });
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
  async function loadComments(more = false) {
    const result = await read('commentThreads.list', {
      part: 'snippet,replies',
      allThreadsRelatedToChannelId: channel.id,
      moderationStatus: $('yt-comment-filter').value,
      maxResults: 50,
      ...(more && commentPage ? { pageToken: commentPage } : {})
    });
    commentPage = result.nextPageToken;
    $('yt-more-comments').disabled = !commentPage;
    list(
      'yt-comments',
      result.items || [],
      x => x.snippet.topLevelComment.snippet.authorDisplayName + ': ' + x.snippet.topLevelComment.snippet.textOriginal,
      async x => {
        $('yt-comment-id').value = x.snippet.topLevelComment.id;
        $('yt-comment-text').value = '';
      },
      more
    );
  }
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
  click('yt-load-captions', async () => {
    if (video?.id !== $('yt-caption-video').value.trim()) await loadVideo($('yt-caption-video').value.trim());
    const result = await read('captions.list', { part: 'snippet', videoId: $('yt-caption-video').value });
    list(
      'yt-captions',
      result.items || [],
      x => x.snippet.name + ' · ' + x.snippet.language,
      async x => {
        $('yt-caption-id').value = x.id;
        $('yt-caption-language').value = x.snippet.language;
        $('yt-caption-name').value = x.snippet.name;
        $('yt-caption-draft').checked = Boolean(x.snippet.isDraft);
      }
    );
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
    const image = new Image(); image.src = '/api/video-suite/assets/' + encodeURIComponent(id); await image.decode();
    const canvas = document.createElement('canvas'); canvas.width=1280; canvas.height=720;
    const h=image.width*9/16; canvas.getContext('2d').drawImage(image,0,(image.height-h)/2,image.width,h,0,0,1280,720);
    const blob = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.9));
    if (!blob) throw Error('Titelbild konnte nicht übernommen werden.');
    const transfer = new DataTransfer(); transfer.items.add(new File([blob],'video-suite-thumbnail.jpg',{type:'image/jpeg'}));
    $('yt-thumbnail').files=transfer.files; $('yt-thumbnail').dispatchEvent(new Event('change'));
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
  async function loadUploads() {
    const rows = await api('uploads?account_id=' + encodeURIComponent(account()));
    const box = $('yt-uploads');
    box.replaceChildren();
    if (!rows.length) box.textContent = 'Noch keine Uploads aus SiteOps.';
    for (const row of rows) {
      const article = document.createElement('article');
      article.textContent =
        row.status +
        ' · ' +
        (row.total_bytes
          ? Math.round((Number(row.uploaded_bytes) / Number(row.total_bytes)) * 100) + ' %'
          : 'Größe wird ermittelt') +
        (row.error ? ' · ' + row.error : '');
      if (row.remote_video_id) {
        const a = document.createElement('a');
        a.href = 'https://www.youtube.com/watch?v=' + encodeURIComponent(row.remote_video_id);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = ' Video auf YouTube öffnen';
        article.append(a);
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
  if (['upload','videos','channel','playlists','comments','captions','advanced'].includes(location.hash.slice(1).split('?')[0])) selectTab(location.hash.slice(1).split('?')[0]).catch(e=>notify(e.message,true));
  loadStatus().catch(e => {
    notify(e.message, true);
    $('yt-status').textContent = 'Verbindung konnte nicht geprüft werden.';
  });
  setInterval(() => {
    if (selectedTab === 'upload' && document.visibilityState === 'visible' && $('yt-account').value)
      loadUploads().catch(e => notify(e.message, true));
  }, 10000);
})();
