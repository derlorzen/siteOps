/* Loads the Umami tracker after consent to the "statistics" category. Umami sets no cookies. */
(() => {
  const config = document.querySelector('script[data-lorzcms-umami]');
  if (!config || document.querySelector('script[data-lorzcms-umami-tracker]')) return;
  let origin;
  try {
    origin = new URL(config.dataset.host);
  } catch {
    return;
  }
  if (origin.protocol !== 'https:' || !/^[0-9a-f-]{36}$/.test(config.dataset.websiteId || '')) return;
  const tracker = document.createElement('script');
  tracker.defer = true;
  tracker.src = origin.origin + '/script.js';
  tracker.dataset.websiteId = config.dataset.websiteId;
  tracker.dataset.domains = location.hostname;
  tracker.dataset.lorzcmsUmamiTracker = '';
  document.head.appendChild(tracker);
})();
