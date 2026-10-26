// A bounded catalog for ChatGPT action discovery. Claude and other clients retain
// the complete SiteOps toolset. Keep this list small and deterministic: large
// tool manifests can cause ChatGPT to reject discovery after a successful OAuth flow.
export const CHATGPT_MCP_TOOL_NAMES = Object.freeze([
  'sites_list',
  'site_get',
  'site_overview',
  'site_status',
  'monitor_history',
  'incidents_list',
  'incident_get',
  'files_find',
  'text_search',
  'file_read',
  'seo_start',
  'seo_run_status',
  'seo_latest',
  'seo_page',
  'seo_issues',
  'change_preview',
  'change_apply',
  'history_list',
  'coolify_connections',
  'coolify_apps_list',
  'coolify_app_info',
  'coolify_app_logs',
  'coolify_app_analyze',
  'coolify_app_plan',
  'coolify_install_execute',
  'coolify_app_status',
  'coolify_install_logs',
  'video_studio_projects',
  'video_studio_create_project',
  'video_studio_create_job',
  'video_studio_list_jobs',
  'video_studio_job_status',
  'video_studio_render_job',
  'youtube_status',
  'youtube_api_catalog',
  'youtube_read',
  'youtube_change_preview',
  'youtube_change_execute'
]);

const chatgptTools = new Set(CHATGPT_MCP_TOOL_NAMES);

export function shouldRegisterMcpTool(profile, toolName) {
  return profile !== 'chatgpt' || chatgptTools.has(toolName);
}

// The OAuth grant identifies a client; user-agent is not a trusted client identity.
// ChatGPT can use either a CIMD HTTPS client_id or a DCR client with metadata.
export function isChatGptMcpClient(client) {
  if (!client) return false;
  const name = String(client.clientName || '');
  if (/\bchatgpt\b/i.test(name)) return true;
  const urls = [client.clientId, ...(client.redirectUris || [])];
  return urls.some(value => {
    try {
      const host = new URL(value).hostname.toLowerCase();
      return host === 'chatgpt.com' || host.endsWith('.openai.com');
    } catch {
      return false;
    }
  });
}
