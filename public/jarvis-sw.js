self.addEventListener('push', event => {
  let chatId;
  try {
    chatId = event.data?.json().chatId;
  } catch {
    return;
  }
  if (!/^[a-f0-9-]{36}$/i.test(chatId || '')) return;
  event.waitUntil(
    self.registration.showNotification('Jarvis', {
      body: 'Deine Hermes-Antwort ist fertig.',
      icon: '/assets/jarvis-icon-192.png',
      tag: 'jarvis-' + chatId,
      data: { chatId }
    })
  );
});

self.addEventListener('notificationclick', event => {
  const chatId = event.notification.data?.chatId;
  event.notification.close();
  if (!/^[a-f0-9-]{36}$/i.test(chatId || '')) return;
  const url = new URL('/jarvis', self.location.origin);
  url.searchParams.set('chat', chatId);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find(client => client.url === url.href);
      if (existing) await existing.focus();
      else await self.clients.openWindow(url.href);
    })()
  );
});
