import test from 'node:test';
import assert from 'node:assert/strict';
import { CHATGPT_MCP_TOOL_NAMES, isChatGptMcpClient, shouldRegisterMcpTool } from '../lib/mcp-profile.mjs';

test('ChatGPT catalog is bounded and contains no duplicate names', () => {
  assert.ok(CHATGPT_MCP_TOOL_NAMES.length > 20);
  assert.ok(CHATGPT_MCP_TOOL_NAMES.length < 50);
  assert.equal(new Set(CHATGPT_MCP_TOOL_NAMES).size, CHATGPT_MCP_TOOL_NAMES.length);
  for (const name of ['sites_list', 'site_overview', 'files_find', 'change_preview', 'change_apply']) {
    assert.ok(CHATGPT_MCP_TOOL_NAMES.includes(name));
  }
});

test('Claude and legacy clients keep the full MCP catalog', () => {
  for (const name of ['cms_admin_recovery', 'youtube_upload_preview', 'video_studio_demo_templates']) {
    assert.equal(shouldRegisterMcpTool('full', name), true);
    assert.equal(shouldRegisterMcpTool('chatgpt', name), false);
  }
  assert.equal(shouldRegisterMcpTool('chatgpt', 'sites_list'), true);
});

test('ChatGPT CIMD and DCR clients are detected without trusting user-agent', () => {
  assert.equal(isChatGptMcpClient({ clientId: 'https://chatgpt.com/oauth/client-metadata' }), true);
  assert.equal(isChatGptMcpClient({ clientId: 'siteops_abcd', clientName: 'ChatGPT' }), true);
  assert.equal(
    isChatGptMcpClient({
      clientId: 'siteops_abcd',
      clientName: 'MCP Client',
      redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect']
    }),
    true
  );
  assert.equal(isChatGptMcpClient({ clientId: 'https://claude.ai/client/metadata', clientName: 'Claude' }), false);
  assert.equal(
    isChatGptMcpClient({
      clientId: 'siteops_abcd',
      clientName: 'Claude',
      redirectUris: ['https://claude.ai/api/mcp/auth_callback']
    }),
    false
  );
  assert.equal(isChatGptMcpClient(null), false);
});
