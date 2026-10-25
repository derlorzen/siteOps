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
    selectedTab = 'channel';
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
  const selectTab = async tab => {
    selectedTab = tab;
    for (const el of document.querySelectorAll('[data-panel]')) el.hidden = el.dataset.panel !== tab;
    for (const el of document.querySelectorAll('[data-tab]'))
      el.setAttribute('aria-current', el.dataset.tab === tab ? 'page' : 'false');
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
    state = await api('status');
    choices('yt-account', state.accounts, x => x.title + ' · ' + x.channel_id);
    $('yt-client-id').value = state.client_id;
    $('yt-client-secret').value = '';
    $('yt-callback').textContent = state.redirect_uri;
    $('yt-status').textContent = state.accounts.length
      ? 'Google-Verbindung bereit. Änderungen benötigen eine eigene Freigabe.'
      : state.configured
        ? 'Google-Client bereit. Verbinde jetzt deinen Kanal.'
        : 'Google-OAuth-Client einrichten und anschließend den Kanal verbinden.';
    $('yt-connect').disabled = !state.configured;
    if (state.accounts.length) await loadChannel();
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
      video = null;
      playlist = null;
      videoPage = null;
      commentPage = null;
      for (const id of ['yt-videos', 'yt-playlists', 'yt-comments', 'yt-captions']) $(id).replaceChildren();
      await loadChannel();
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
    if (!channel) await loadChannel();
    const id = channel.contentDetails?.relatedPlaylists?.uploads;
    if (!id) throw Error('Google hat keine Upload-Playlist geliefert.');
    const result = await read('playlistItems.list', {
      part: 'snippet,contentDetails',
      playlistId: id,
      maxResults: 25,
      ...(more && videoPage ? { pageToken: videoPage } : {})
    });
    videoPage = result.nextPageToken;
    $('yt-more-videos').disabled = !videoPage;
    list(
      'yt-videos',
      result.items || [],
      x => x.snippet.title + ' · ' + x.contentDetails.videoId,
      x => loadVideo(x.contentDetails.videoId),
      more
    );
  }
  click('yt-load-videos', () => loadVideos());
  click('yt-more-videos', () => loadVideos(true));
  async function loadVideo(id) {
    const result = await read('videos.list', { part: 'snippet,status,localizations,recordingDetails', id });
    video = result.items?.[0];
    if (!video) throw Error('Video nicht gefunden.');
    $('yt-video-id').value = video.id;
    $('yt-video-title').value = video.snippet.title;
    $('yt-video-description').value = video.snippet.description || '';
    $('yt-video-tags').value = (video.snippet.tags || []).join(', ');
    $('yt-video-category').value = video.snippet.categoryId;
    $('yt-video-privacy').value = video.status.privacyStatus;
    $('yt-video-language').value = video.snippet.defaultLanguage || '';
    $('yt-video-kids').checked = Boolean(video.status.selfDeclaredMadeForKids);
    $('yt-video-synthetic').checked = Boolean(video.status.containsSyntheticMedia);
    $('yt-video-publish').value = video.status.publishAt ? localDateTime(video.status.publishAt) : '';
    $('yt-caption-video').value = video.id;
  }
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
  loadStatus().catch(e => {
    notify(e.message, true);
    $('yt-status').textContent = 'Verbindung konnte nicht geprüft werden.';
  });
  setInterval(() => {
    if (selectedTab === 'upload' && document.visibilityState === 'visible' && $('yt-account').value)
      loadUploads().catch(e => notify(e.message, true));
  }, 10000);
})();
