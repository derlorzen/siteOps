// Integration test: applies the real migrations/ files against a real MySQL
// database. Skips instead of failing when no test database is configured
// (local dev without MySQL running); CI provides one via a service container.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const hasDb = Boolean(process.env.DATABASE_URL || (process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME));

test('migrate() applies every migration file and is idempotent on re-run', { skip: !hasDb }, async t => {
  process.env.SITEOPS_MASTER_KEY ||= 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  process.env.DASHBOARD_USER ||= 'test';
  process.env.DASHBOARD_PASSWORD ||= 'test-password';
  process.env.SITEOPS_TEST_NO_AUTOSTART = '1';
  const { migrate, q, db, registerCoolifyWebsite } = await import('../app.mjs');
  t.after(() => db.end());

  await migrate();
  const files = (
    await import('node:fs/promises').then(fs => fs.readdir(new URL('../migrations/', import.meta.url)))
  ).filter(f => /\.(sql|mjs)$/.test(f));
  const applied = (await q('select id from schema_migrations')).rows.map(r => r.id).sort();
  assert.deepEqual(applied, [...files].sort());

  const sitesColumns = (await q("show columns from sites like 'deployment_mode'")).rows;
  assert.equal(sitesColumns.length, 1);

  // Re-running must be a no-op, not an error (columns/tables already exist).
  await migrate();
  const appliedAgain = (await q('select id from schema_migrations')).rows.map(r => r.id).sort();
  assert.deepEqual(appliedAgain, applied);
  const { checkSearchConsoleMysql } = await import('./search-console-mysql.mjs');
  await checkSearchConsoleMysql(db, migrate);
  const { checkBillingDraftsMysql } = await import('./billing-drafts-mysql.mjs');
  await checkBillingDraftsMysql(db);

  // Serialize this check with migrations and other database fixtures. It exercises
  // the real policy row lock, so mocks cannot hide overspending under concurrency.
  const { createAiUsage } = await import('../lib/ai-usage.mjs');
  const budgetModel = 'budget-test-' + (await import('node:crypto')).randomUUID();
  const [budgetPolicy] = await db.query('SELECT * FROM ai_usage_policy WHERE id=1');
  const [budgetSummary] = await db.query(
    "SELECT COUNT(*) calls,COALESCE(SUM(accounted_tokens),0) tokens FROM ai_usage_ledger WHERE created_at>=DATE_FORMAT(UTC_TIMESTAMP(),'%Y-%m-01')"
  );
  try {
    await db.query('UPDATE ai_usage_policy SET monthly_calls=?,monthly_tokens=?,monthly_usd=NULL WHERE id=1', [
      Number(budgetSummary[0].calls) + 1,
      Number(budgetSummary[0].tokens) + 100000
    ]);
    let calls = 0;
    const usage = createAiUsage({ db });
    const run = () =>
      usage.run({ operation: 'responses', body: { model: budgetModel, max_output_tokens: 100 } }, async () => {
        calls++;
        return { usage: { input_tokens: 10, output_tokens: 10 } };
      });
    const results = await Promise.allSettled([run(), run()]);
    assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(calls, 1);
  } finally {
    await db.query('DELETE FROM ai_usage_ledger WHERE model=?', [budgetModel]);
    const policy = budgetPolicy[0];
    await db.query(
      'UPDATE ai_usage_policy SET monthly_calls=?,monthly_tokens=?,monthly_usd=?,prices_json=? WHERE id=1',
      [
        policy.monthly_calls,
        policy.monthly_tokens,
        policy.monthly_usd,
        typeof policy.prices_json === 'string' ? policy.prices_json : JSON.stringify(policy.prices_json)
      ]
    );
  }

  // Video additions must preserve existing rows and execute real MySQL queries.
  const { createVideoStudio } = await import('../lib/video-studio.mjs');
  const videoStudio = createVideoStudio({ db });
  const videoProject = await videoStudio.createProject({ name: 'CI German video', language: 'de' });
  let videoJob;
  try {
    videoJob = await videoStudio.createJob({
      project_id: videoProject.id,
      title: 'CI Video Studio',
      script: 'Dies ist eine vollständig deutschsprachige Testszenenbeschreibung.'
    });
    assert.equal(videoJob.render_settings.language, 'de');
    assert.equal(videoJob.render_settings.voice, 'de_DE-thorsten-medium');
    assert.equal(videoJob.youtube.title, 'CI Video Studio');
    await videoStudio.updateProject(videoProject.id, { language: 'en' });
    assert.equal((await videoStudio.getJob(videoJob.id)).render_settings.language, 'de');
    assert.equal((await videoStudio.listJobs(videoProject.id)).length, 1);
    await videoStudio.updateMetadata(videoJob.id, { ...videoJob.youtube, title: 'CI Updated title' });
    assert.equal((await videoStudio.getJob(videoJob.id)).youtube.title, 'CI Updated title');
    const { createYouTubeService } = await import('../lib/youtube.mjs');
    const { encryptWithKey, decryptWithKey } = await import('../lib/crypto.mjs');
    const { randomUUID } = await import('node:crypto');
    const accountId = randomUUID(),
      testKey = Buffer.alloc(32, 9);
    const encrypted = encryptWithKey(
      { access_token: 'ci-youtube-test-token', refresh_token: 'ci-refresh-test', expires_at: Date.now() + 3600000 },
      testKey
    );
    await db.query('INSERT INTO youtube_accounts(id,channel_id,title,encrypted_credentials) VALUES(?,?,?,?)', [
      accountId,
      'UC' + accountId,
      'CI YouTube channel',
      encrypted
    ]);
    const youtube = createYouTubeService({
      db,
      encrypt: value => encryptWithKey(value, testKey),
      decrypt: value => decryptWithKey(value, testKey),
      publicBaseUrl: () => 'https://siteops.example.com',
      studio: () => ({
        refreshJob: id => videoStudio.getJob(id),
        capabilities: async () => ({ artifactRanges: true })
      }),
      fetcher: async () => Response.json({ id: 'testvideo01' })
    });
    try {
      assert.ok((await youtube.accounts()).some(x => x.id === accountId));
      const preview = await youtube.preview({
        account_id: accountId,
        action: 'videos.update',
        parameters: { part: 'snippet' },
        body: { id: 'testvideo01', snippet: { title: 'CI YouTube title', categoryId: '28' } }
      });
      await youtube.execute({ preview_token: preview.preview_token, approved: true });
      assert.equal((await youtube.previewStatus(preview.preview_token)).status, 'done');
      await db.query('UPDATE video_studio_jobs SET status=?,result=? WHERE id=?', [
        'done',
        JSON.stringify({ files: ['video'] }),
        videoJob.id
      ]);
      const upload = await youtube.previewUpload({
        account_id: accountId,
        job_id: videoJob.id,
        made_for_kids: false,
        contains_synthetic_media: true
      });
      await youtube.execute({ preview_token: upload.preview_token, approved: true });
      assert.equal((await youtube.uploads(accountId)).length, 1);
    } finally {
      await db.query('DELETE FROM youtube_uploads WHERE account_id=?', [accountId]);
      await db.query('DELETE FROM youtube_previews WHERE account_id=?', [accountId]);
      await db.query('DELETE FROM youtube_accounts WHERE id=?', [accountId]);
    }
  } finally {
    if (videoJob) await db.query('DELETE FROM video_studio_jobs WHERE id=?', [videoJob.id]);
    await db.query('DELETE FROM video_studio_projects WHERE id=?', [videoProject.id]);
  }

  // Regression: load and move tasks using real MySQL, not only mocked queries.
  const { randomUUID } = await import('node:crypto');
  const { createBillingBoard } = await import('../lib/billing-board.mjs');
  const customerId = randomUUID();
  const projectId = randomUUID();
  const taskId = randomUUID();
  try {
    await db.query('INSERT INTO customers(id,name) VALUES(?,?)', [customerId, 'Board Regression Kunde']);
    await db.query('INSERT INTO customer_projects(id,customer_id,name) VALUES(?,?,?)', [
      projectId,
      customerId,
      'Regressionsprojekt'
    ]);
    await db.query('INSERT INTO project_tasks(id,project_id,name,status) VALUES(?,?,?,?)', [
      taskId,
      projectId,
      'Testtask',
      'open'
    ]);
    const board = createBillingBoard({ db });
    const before = await board.getBoard(projectId);
    assert.equal(before.project.customer_id, customerId);
    assert.equal(before.columns.open.length, 1);
    assert.equal(before.columns.open[0].id, taskId);
    const columns = Object.fromEntries(['backlog', 'open', 'in_progress', 'review', 'done'].map(key => [key, []]));
    columns.in_progress.push(taskId);
    const after = await board.saveBoard(projectId, { revision: before.revision, columns });
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.columns.open.length, 0);
    assert.equal(after.columns.in_progress[0].id, taskId);
    const [events] = await db.query('SELECT event_type FROM billing_task_events WHERE task_id=?', [taskId]);
    assert.ok(events.some(event => event.event_type === 'kanban_moved'));
    await assert.rejects(
      board.saveBoard(projectId, { revision: before.revision, columns }),
      error => error.statusCode === 409
    );
    // Execute the new search, project 360 and activity queries against real MySQL.
    // Unit tests with mocks cannot catch incorrect table/column names.
    const { createWorkspaceSearch } = await import('../lib/workspace-search.mjs');
    const { createProjectOverview } = await import('../lib/project-overview.mjs');
    const { createWorkspaceActivity } = await import('../lib/workspace-activity.mjs');
    const search = await createWorkspaceSearch({ db }).search('Regressionsprojekt');
    assert.ok(search.results.some(result => result.type === 'project' && result.id === projectId));
    const overview = await createProjectOverview(db).get(projectId);
    assert.equal(overview.project.id, projectId);
    assert.equal(Number(overview.task_counts.total), 1);
    assert.deepEqual(overview.sites, []);
    const activity = await createWorkspaceActivity(db).list({ projectId, limit: 20 });
    assert.ok(activity.entries.some(entry => entry.kind === 'task'));

    const { createWorkspaceOverview } = await import('../lib/workspace-overview.mjs');
    const portfolio = await createWorkspaceOverview({
      db,
      activity: { list: async () => ({ entries: [] }) },
      dueTasks: async () => []
    }).portfolio();
    assert.ok(Array.isArray(portfolio.items));
    assert.equal(typeof portfolio.counts.unknown, 'number');
    const { createActionApprovals } = await import('../lib/action-approvals.mjs');
    const { encryptWithKey: approvalEncrypt, decryptWithKey: approvalDecrypt } = await import('../lib/crypto.mjs');
    const approvalKey = Buffer.alloc(32, 7),
      actor = { type: 'oauth', subject: 'ci-' + projectId, clientId: 'client', scope: 'siteops:access siteops:write' };
    const approvals = createActionApprovals({
      db,
      encrypt: value => approvalEncrypt(value, approvalKey),
      decrypt: value => approvalDecrypt(value, approvalKey)
    });
    const proposal = { tool: 'ci-only-no-provider', args: { project_id: projectId }, state: { revision: 1 }, actor };
    const prepared = await approvals.prepare(proposal);
    try {
      assert.equal((await approvals.pending({ type: 'dashboard_session', subject: actor.subject })).length, 1);
      assert.equal((await approvals.pending({ type: 'dashboard_session', subject: 'other' })).length, 0);
      await assert.rejects(approvals.approve(prepared.id, { type: 'dashboard_session', subject: 'other' }), {
        statusCode: 409
      });
      await approvals.approve(prepared.id, { type: 'dashboard_session', subject: actor.subject });
      await assert.rejects(approvals.consume({ ...proposal, id: prepared.id, state: { revision: 2 } }), {
        statusCode: 409
      });
      const attempts = await Promise.allSettled([
        approvals.consume({ ...proposal, id: prepared.id }),
        approvals.consume({ ...proposal, id: prepared.id })
      ]);
      assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
    } finally {
      await db.query('DELETE FROM action_approvals WHERE id=?', [prepared.id]);
    }

    // A stored server profile can be created, listed, resolved and removed
    // without exposing credentials in the public response.
    const { createConnectionProfiles } = await import('../lib/connection-profiles.mjs');
    const profiles = createConnectionProfiles({
      db,
      encrypt: input => JSON.stringify(input),
      decrypt: JSON.parse
    });
    const profile = await profiles.create({
      name: 'CI Server ' + projectId,
      protocol: 'sftp',
      host: 'ci.example.invalid',
      port: 22,
      username: 'test',
      password: 'test-only-secret'
    });
    try {
      const listed = await profiles.list();
      assert.ok(listed.some(item => item.id === profile.id));
      assert.equal(listed.find(item => item.id === profile.id).password, undefined);
      const resolved = await profiles.resolve(profile.id, '/test-website');
      assert.equal(resolved.password, 'test-only-secret');
      assert.equal(resolved.remoteRoot, '/test-website');
    } finally {
      await profiles.remove(profile.id);
    }
    // Exercise the deployment journal, actual website INSERT and project link
    // on MySQL. Only external API calls are mocked; no production provisioning.
    const { createCoolifyDeployer } = await import('../lib/coolify-deployer.mjs');
    const { encryptWithKey, decryptWithKey } = await import('../lib/crypto.mjs');
    const key = Buffer.alloc(32, 9),
      connectionId = randomUUID();
    await db.query('INSERT INTO coolify_connections(id,name,base_url,encrypted_token) VALUES(?,?,?,?)', [
      connectionId,
      'CI Coolify',
      'https://coolify.example.de',
      encryptWithKey('test-only-api-token', key)
    ]);
    const remoteApps = [],
      remoteProjects = [];
    const api = {
      version: async () => 'v4.4.7',
      servers: async () => [{ uuid: 'server-one', ip: '8.8.4.4' }],
      projects: async () => remoteProjects,
      createProject: async (name, description) => {
        const p = { uuid: 'project-one', name, description };
        remoteProjects.push(p);
        return p;
      },
      environments: async () => [{ name: 'production' }],
      applications: async () => remoteApps,
      createApplication: async (_kind, body) => {
        const a = { uuid: 'application-one', ...body };
        remoteApps.push(a);
        return a;
      },
      application: async () => ({ ...remoteApps[0], status: 'running:healthy' }),
      updateApplication: async () => ({}),
      startApplication: async () => ({ deployment_uuid: 'deployment-one' }),
      deployment: async () => ({ status: 'finished' })
    };
    const deploymentService = createCoolifyDeployer({
      db,
      encrypt: v => encryptWithKey(v, key),
      decrypt: v => decryptWithKey(v, key),
      loadConnection: async () => ({ base_url: 'https://coolify.example.de' }),
      makeClient: () => api,
      registerWebsite: registerCoolifyWebsite,
      dnsService: {
        inspect: async () => ({ accountId: customerId, action: 'reuse' }),
        ensure: async () => ({ ensured: true })
      },
      addresses: async () => [{ address: '8.8.4.4', family: 4 }],
      http: async (_url, { headers } = {}) => ({ status: headers?.Authorization ? 200 : 401, body: 'healthy' })
    });
    let installation;
    try {
      const ensuredProject = await deploymentService.siteopsProjectEnsure({
        name: 'Coolify CI ' + projectId,
        customerId
      });
      const input = {
        connectionId,
        name: 'CI Application',
        domain: 'ci-' + projectId + '.example.de',
        projectName: ensuredProject.name,
        siteopsProjectId: ensuredProject.id,
        sourceKind: 'image',
        image: 'example/app',
        containerPort: 3000,
        authUsername: 'ci',
        authPassword: 'test-password-at-least16',
        reviewEvidence: 'CI reviewed fixture only, no real external operations.'
      };
      installation = await deploymentService.plan(input);
      const approval = {
        id: installation.id,
        approve: true,
        approveRisks: true,
        riskAcknowledgement: 'CI fixture is explicitly approved for mock provisioning.'
      };
      await deploymentService.execute(approval);
      const finished = await deploymentService.process(installation.id);
      assert.equal(finished.state, 'online');
      const [websites] = await db.query('SELECT * FROM sites WHERE coolify_deployment_id=?', [installation.id]);
      assert.equal(websites.length, 1);
      assert.equal(websites[0].deployment_mode, 'coolify');
      assert.equal(Number(websites[0].backup_enabled), 0);
      assert.equal(websites[0].coolify_application_uuid, 'application-one');
      assert.ok(websites[0].last_deployed_at);
      const [links] = await db.query('SELECT project_id FROM project_sites WHERE site_id=?', [websites[0].id]);
      assert.equal(links[0].project_id, ensuredProject.id);
      assert.equal((await deploymentService.plan(input)).id, installation.id);
      await deploymentService.execute(approval);
      await deploymentService.process(installation.id);
      assert.equal(remoteApps.length, 1);
    } finally {
      if (installation) {
        const [websites] = await db.query('SELECT id FROM sites WHERE coolify_deployment_id=?', [installation.id]);
        for (const site of websites) await db.query('DELETE FROM sites WHERE id=?', [site.id]);
        await db.query('DELETE FROM coolify_deployments WHERE id=?', [installation.id]);
      }
      await db.query('DELETE FROM customer_projects WHERE name=?', ['Coolify CI ' + projectId]);
      await db.query('DELETE FROM coolify_connections WHERE id=?', [connectionId]);
    }
  } finally {
    await db.query('DELETE FROM project_tasks WHERE id=?', [taskId]);
    await db.query('DELETE FROM customer_projects WHERE id=?', [projectId]);
    await db.query('DELETE FROM customers WHERE id=?', [customerId]);
  }
});
