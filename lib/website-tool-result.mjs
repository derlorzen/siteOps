// Expected operational failures belong in an MCP tool result, not a JSON-RPC
// "Internal error". Never expose arbitrary exception messages or credentials.
export async function websiteToolResult(operation, run) {
  try {
    const value = await run();
    return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
  } catch (error) {
    const stage = error.siteopsStage || 'operation';
    const raw = String(error.message || '');
    let code = 'WEBSITE_OPERATION_FAILED';
    let message = 'Website operation failed. Check the SiteOps server configuration and logs before retrying.';
    if (/GitHub backup is not configured/.test(raw)) {
      code = 'BACKUP_NOT_CONFIGURED';
      message = 'Configure the GitHub backup repository and token in SiteOps before applying website changes.';
    } else if (/GitHub .*failed \((\d{3})\)/.test(raw) || /GitHub API rate limit exceeded/.test(raw)) {
      code = 'GITHUB_BACKUP_FAILED';
      message =
        'GitHub rejected the backup operation. Check backup token permissions, repository, branch and API quota.';
    } else if (/Remote (existence|file) changed/.test(raw) || /Preview not found or expired/.test(raw)) {
      code = 'PREVIEW_STALE';
      message =
        'The preview is expired, already applied or no longer matches the website. Read the current files and prepare a new preview.';
    } else if (/path traversal|file path/i.test(raw)) {
      code = 'INVALID_FILE_PATH';
      message = 'Website file paths must be unique, non-empty paths inside the website root.';
    } else if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED/.test(error.code || raw)) {
      code = 'WEBSITE_CONNECTION_FAILED';
      message =
        'The website or backup connection failed. Verify connection settings and inspect the current website state before retrying.';
    }
    console.error('SiteOps website operation failed', { operation, stage, code, causeCode: error.code });
    return { isError: true, content: [{ type: 'text', text: JSON.stringify({ operation, stage, code, message }) }] };
  }
}
