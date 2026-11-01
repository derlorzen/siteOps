// Uses the application's real HTTP boundary. No external provider mutation or
// claims about a live ChatGPT/Claude connection are made by this local probe.
export async function runMcpDiagnostics({ inject, accessToken }) {
  const checks = [];
  const decode = response => {
    const raw = response.body;
    return JSON.parse(
      raw.startsWith('event:') || raw.startsWith('data:')
        ? raw
            .split('\n')
            .find(line => line.startsWith('data:'))
            .slice(5)
            .trim()
        : raw
    );
  };
  async function check(label, execute) {
    try {
      checks.push({ label, ok: Boolean(await execute()) });
    } catch {
      checks.push({ label, ok: false });
    }
  }
  const rpc = async (method, params, version = '2025-11-25') => {
    if (version === '2026-07-28')
      params = {
        ...params,
        _meta: {
          'io.modelcontextprotocol/protocolVersion': version,
          'io.modelcontextprotocol/clientInfo': { name: 'siteops-local-self-test', version: '1' },
          'io.modelcontextprotocol/clientCapabilities': {}
        }
      };
    const response = await inject({
      method: 'POST',
      url: '/mcp',
      headers: {
        authorization: 'Bearer ' + accessToken,
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        'mcp-protocol-version': version,
        'mcp-method': method,
        ...(params?.name ? { 'mcp-name': params.name } : {})
      },
      payload: { jsonrpc: '2.0', id: 1, method, params }
    });
    if (response.statusCode !== 200) throw Error('Transport failed');
    const body = decode(response);
    if (body.error) throw Error('Protocol failed');
    return body.result;
  };
  await check(
    'OAuth-Ressourcenmetadaten',
    async () =>
      (await inject({ method: 'GET', url: '/.well-known/oauth-protected-resource' })).json().authorization_servers
        ?.length > 0
  );
  await check('Anmeldeserver und PKCE', async () =>
    (await inject({ method: 'GET', url: '/.well-known/oauth-authorization-server' }))
      .json()
      .code_challenge_methods_supported.includes('S256')
  );
  await check(
    'Zugriff ohne gültiges Token abgewiesen',
    async () =>
      (await inject({ method: 'POST', url: '/mcp', payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } }))
        .statusCode === 401
  );
  await check('Initialisierung für bestehende Clients', async () =>
    Boolean(
      (
        await rpc('initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'siteops-local-self-test', version: '1' }
        })
      ).capabilities
    )
  );
  await check('Zustandslose Discovery 2026-07-28', async () =>
    Boolean((await rpc('server/discover', {}, '2026-07-28')).capabilities)
  );
  await check('Aktuelle Tool-Discovery und Leseaufruf 2026-07-28', async () => {
    const catalog = await rpc('tools/list', {}, '2026-07-28');
    const result = await rpc('tools/call', { name: 'capabilities_list', arguments: { limit: 1 } }, '2026-07-28');
    return catalog.tools.length > 0 && !result.isError && result.structuredContent?.data?.items?.length === 1;
  });
  await check('Tool-Discovery und Schemas', async () => {
    const catalog = await rpc('tools/list', {});
    return (
      catalog.tools.length > 0 &&
      catalog.tools.every(
        tool =>
          tool.name && tool.description && tool.inputSchema?.type === 'object' && tool.outputSchema?.type === 'object'
      )
    );
  });
  await check('Authentifizierter ungefährlicher Tool-Aufruf', async () => {
    const result = await rpc('tools/call', { name: 'capabilities_list', arguments: { limit: 1 } });
    return !result.isError && result.structuredContent?.data?.items?.length === 1;
  });
  return {
    ok: checks.every(item => item.ok),
    verification: 'Lokal über den tatsächlichen SiteOps-HTTP-Handler geprüft; temporäres OAuth-Testtoken.',
    checks,
    checked_at: new Date().toISOString(),
    external_clients_verified: []
  };
}
