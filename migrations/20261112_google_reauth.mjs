// Marks a Google connection whose refresh token Google no longer accepts (expired in
// OAuth test mode after seven days, revoked, or password changed), so the dashboard can
// offer a one-click reconnect instead of failing on the next request.
export default async function run({ ensureColumn }) {
  await ensureColumn('youtube_accounts', 'reauth_required_at', 'DATETIME(3) NULL');
  await ensureColumn('search_console_accounts', 'reauth_required_at', 'DATETIME(3) NULL');
}
