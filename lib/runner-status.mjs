// Authenticate first; older runner builds reported a stale version from /auth-test.
export async function authenticatedRunnerStatus(request) {
  const authenticated = await request('/auth-test');
  try {
    const health = await request('/health');
    if (
      health.status === 'ok' &&
      health.service === 'siteops-browser-runner' &&
      /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(health.version || '')
    )
      return { ...authenticated, version: health.version };
  } catch {
    /* Keep compatibility with runners exposing only the authenticated check. */
  }
  return authenticated;
}
