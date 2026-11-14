import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoAutopilot } from '../lib/video-autopilot.mjs';

const project = '11111111-1111-4111-8111-111111111111';
const login = '22222222-2222-4222-8222-222222222222';
const draft = () => ({
  title: 'Package Manager tutorial',
  script: 'Intro. Open the package list. Outro.',
  scenes: [
    { headline: 'Intro', narration: 'Welcome to this short tutorial.', capture_mode: 'text' },
    {
      headline: 'Package list',
      narration: 'Open the package list in the admin panel.',
      capture_mode: 'recording',
      visual_directions: 'Show the package list.',
      demoUrl: 'https://invented.example/',
      demoSteps: [{ action: 'click', selector: '#invented' }]
    },
    { headline: 'Settings', narration: 'Then look at the settings page.', capture_mode: 'recording' }
  ],
  youtube: { title: 'Package Manager tutorial' }
});
function fixture({ inspect, plans, jobStatus = ['running', 'done'] } = {}) {
  const rows = new Map();
  const calls = { inspect: [], chat: [], structured: [], createJob: [], render: [] };
  const db = {
    async query(query, params = []) {
      if (query.startsWith('INSERT INTO video_autopilot_runs')) {
        const [id, project_id, status, stage, prompt, options, state] = params;
        rows.set(id, { id, project_id, status, stage, prompt, options, state, job_id: null, error: null });
        return [{}];
      }
      if (query.startsWith('UPDATE video_autopilot_runs')) {
        const [status, stage, state, job_id, error, id] = params;
        Object.assign(rows.get(id), { status, stage, state, job_id, error });
        return [{}];
      }
      if (query.includes('WHERE id=?')) return [rows.has(params[0]) ? [{ ...rows.get(params[0]) }] : []];
      if (query.includes("status IN ('running','needs_input')"))
        return [
          [...rows.values()].filter(r => r.project_id === params[0] && ['running', 'needs_input'].includes(r.status))
        ];
      if (query.includes("status='running'")) return [[...rows.values()].filter(r => r.status === 'running')];
      return [[...rows.values()]];
    }
  };
  const pages = {
    'https://shop.test/admin': {
      url: 'https://shop.test/admin',
      title: 'Dashboard',
      headings: ['Dashboard'],
      text: 'Welcome',
      elements: [
        {
          selector: 'a[href="/admin/packages"]',
          role: 'link',
          name: 'Packages',
          href: 'https://shop.test/admin/packages'
        },
        { selector: '#delete-all', role: 'button', name: 'Delete all', href: null },
        { selector: '#menu', role: 'button', name: 'Menu', href: null }
      ]
    }
  };
  const studio = {
    getProject: async id =>
      id === project ? { id, language: 'en' } : Promise.reject(Object.assign(Error('x'), { statusCode: 404 })),
    demoLogins: {
      list: async () => [{ id: login, landing_url: 'https://shop.test/admin' }],
      get: async id => ({ id, landing_url: 'https://shop.test/admin' })
    },
    inspectPage: async input => {
      calls.inspect.push(input);
      if (inspect) return inspect(input, calls);
      const last = input.steps.findLast?.(step => step.action === 'goto');
      return last
        ? { url: last.url, title: 'Packages', headings: ['Packages'], text: '', elements: [] }
        : pages['https://shop.test/admin'];
    },
    createJob: async input => {
      calls.createJob.push(input);
      return { id: '33333333-3333-4333-8333-333333333333' };
    },
    renderJob: async id => calls.render.push(id),
    refreshJob: async () => {
      const status = jobStatus.length > 1 ? jobStatus.shift() : jobStatus[0];
      return {
        status,
        error: status === 'failed' ? 'Szene 2: Aufnahme leer.' : null,
        result: { quality: { technical_status: 'passed' } }
      };
    }
  };
  const queue = [...(plans || [])];
  const suite = {
    status: async () => ({ configured: true }),
    chat: async input => {
      calls.chat.push(input);
      return { draft: draft(), conversation_id: '44444444-4444-4444-8444-444444444444', usage: { total_tokens: 1000 } };
    },
    structured: async input => {
      calls.structured.push(input);
      return { data: queue.shift() || { actions: [], done: true, note: '' }, total_tokens: 100 };
    }
  };
  const autopilot = createVideoAutopilot({ db, studio, suite });
  const run = async (id, times) => {
    for (let i = 0; i < times; i++) await autopilot.advance(id);
    return autopilot.status(id);
  };
  return { autopilot, calls, run, rows };
}

test('autopilot turns a request into a rendered production with recordings planned from the live page', async () => {
  const { autopilot, calls, run } = fixture({
    plans: [
      {
        actions: [
          { type: 'click', element: 1, pixels: null, ms: null },
          { type: 'open_link', element: 0, pixels: null, ms: null },
          { type: 'click', element: 99, pixels: null, ms: null }
        ],
        done: false,
        note: ''
      },
      { actions: [{ type: 'wait', element: null, pixels: null, ms: 1800 }], done: true, note: 'List visible.' },
      { actions: [{ type: 'scroll', element: null, pixels: 400, ms: null }], done: true, note: '' }
    ]
  });
  const started = await autopilot.start({ project_id: project, prompt: 'Show how the package manager works.' });
  assert.equal(started.status, 'running');
  assert.equal(started.options.start_url, 'https://shop.test/admin');
  assert.equal(started.options.login_profile_id, login);
  await assert.rejects(autopilot.start({ project_id: project, prompt: 'A second one at the same time.' }), {
    statusCode: 409
  });

  let state = await run(started.id, 1);
  assert.equal(state.stage, 'explore');
  assert.match(calls.chat[0].message, /capture_mode "recording"/);
  assert.equal(calls.chat[0].skill, 'video-komplett');
  // Addresses and selectors invented by the planning model are discarded.
  assert.equal(state.scenes[1].url, null);
  assert.equal(state.scenes[1].actions, 0);

  state = await run(started.id, 1);
  const first = calls.createJob.length === 0 && state.scenes[1];
  assert.equal(first.status, 'ready');
  assert.equal(first.url, 'https://shop.test/admin');
  assert.equal(first.actions, 2);
  // The destructive button and the unknown element were not turned into actions.
  assert.deepEqual(calls.inspect[1].steps, [{ action: 'goto', url: 'https://shop.test/admin/packages' }]);
  assert.ok(state.log.some(entry => entry.level === 'warning' && /Delete all/.test(entry.text)));
  // The proof run executes exactly the accepted actions.
  assert.deepEqual(calls.inspect[2].steps, [
    { action: 'goto', url: 'https://shop.test/admin/packages' },
    { action: 'wait', ms: 1800 }
  ]);
  assert.ok(!JSON.stringify(calls.structured[0].input).includes('selector'));

  state = await run(started.id, 1);
  // The next recorded scene continues where the previous one ended.
  assert.equal(state.scenes[2].url, 'https://shop.test/admin/packages');
  state = await run(started.id, 2);
  assert.equal(state.stage, 'rendering');
  assert.equal(calls.createJob.length, 1);
  const scenes = calls.createJob[0].scenes;
  assert.equal(scenes[0].capture_mode, 'text');
  assert.equal(scenes[1].test_data_only, true);
  assert.equal(scenes[1].login_profile_id, login);
  assert.deepEqual(calls.render, ['33333333-3333-4333-8333-333333333333']);

  state = await run(started.id, 1);
  assert.equal(state.status, 'running');
  state = await run(started.id, 1);
  assert.equal(state.status, 'completed');
  assert.ok(state.phases.every(phase => phase.state === 'done'));
  assert.equal(state.quality.technical_status, 'passed');
  assert.equal(state.total_tokens, 1300);
  assert.equal((await autopilot.list(project)).length, 1);
});

test('autopilot reports failures honestly, can retry, wait for approval and be cancelled', async () => {
  const failing = fixture({ jobStatus: ['failed', 'done'] });
  const started = await failing.autopilot.start({ project_id: project, prompt: 'Show how the package manager works.' });
  let state = await failing.run(started.id, 6);
  assert.equal(state.status, 'failed');
  assert.match(state.error, /Aufnahme leer/);
  assert.equal(state.phases[2].state, 'failed');
  assert.notEqual(state.phases[3].state, 'done');
  state = await failing.autopilot.act({ id: started.id, action: 'retry' });
  assert.equal(state.status, 'running');
  state = await failing.run(started.id, 2);
  assert.equal(state.status, 'completed');
  assert.equal(failing.calls.createJob.length, 1);
  assert.equal(failing.calls.render.length, 2);

  const review = fixture();
  const second = await review.autopilot.start({
    project_id: project,
    prompt: 'Show how the package manager works.',
    mode: 'review'
  });
  state = await review.run(second.id, 5);
  assert.equal(state.status, 'needs_input');
  assert.equal(state.awaiting, 'approve');
  assert.equal(review.calls.createJob.length, 0);
  await assert.rejects(review.autopilot.act({ id: second.id, action: 'retry' }), { statusCode: 409 });
  await review.autopilot.act({ id: second.id, action: 'approve' });
  state = await review.run(second.id, 1);
  assert.equal(review.calls.render.length, 1);
  state = await review.autopilot.act({ id: second.id, action: 'cancel' });
  assert.equal(state.status, 'cancelled');
  await review.run(second.id, 3);
  assert.equal((await review.autopilot.status(second.id)).status, 'cancelled');
});

test('autopilot never invents recordings: old runner records the start page only, missing demo is refused', async () => {
  const old = fixture({
    inspect: () => {
      throw Object.assign(new Error('Seitenanalyse benötigt Browser Runner ab Version 1.6.0.'), { statusCode: 409 });
    }
  });
  const started = await old.autopilot.start({ project_id: project, prompt: 'Show how the package manager works.' });
  const state = await old.run(started.id, 4);
  assert.equal(state.scenes[1].url, 'https://shop.test/admin');
  assert.match(state.scenes[1].note, /Ohne Seitenanalyse/);
  assert.equal(state.log.filter(entry => /noch nicht analysieren/.test(entry.text)).length, 1);
  assert.equal(old.calls.structured.length, 0);

  const broken = fixture({
    inspect: () => {
      throw Object.assign(new Error('Seitenanalyse fehlgeschlagen: Demo-Sitzung nicht gültig.'), { statusCode: 422 });
    }
  });
  const run = await broken.autopilot.start({ project_id: project, prompt: 'Show how the package manager works.' });
  const failed = await broken.run(run.id, 3);
  assert.equal(failed.status, 'failed');
  assert.equal(broken.calls.createJob.length, 0);

  const bare = createVideoAutopilot({
    db: { query: async () => [[]] },
    studio: {
      getProject: async () => ({ language: 'en' }),
      demoLogins: { list: async () => [], get: async () => null }
    },
    suite: { status: async () => ({ configured: true }) }
  });
  await assert.rejects(bare.start({ project_id: project, prompt: 'Show how the package manager works.' }), {
    statusCode: 422
  });
});
