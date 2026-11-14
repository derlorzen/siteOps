import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoAutopilot, consentStep, requestedUrl } from '../lib/video-autopilot.mjs';

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
      if (query.startsWith('UPDATE video_autopilot_runs SET options')) {
        rows.get(params[1]).options = params[0];
        return [{}];
      }
      if (query.includes('id<>?'))
        return [
          [...rows.values()].filter(
            r => r.project_id === params[0] && r.id !== params[1] && ['running', 'needs_input'].includes(r.status)
          )
        ];
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
      const last = (input.steps || []).findLast(step => step.action === 'goto');
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
  // The storyboard is written from the real start page, without production caveats.
  assert.match(calls.chat[0].message, /Live page at the start address/);
  assert.match(calls.chat[0].message, /"title":"Dashboard"/);
  assert.match(calls.chat[0].message, /Never mention the production itself/);
  assert.ok(state.log.some(entry => /Startseite gelesen/.test(entry.text)));
  // Addresses and selectors invented by the planning model are discarded.
  assert.equal(state.scenes[1].url, null);
  assert.equal(state.scenes[1].actions, 0);

  state = await run(started.id, 1);
  const first = calls.createJob.length === 0 && state.scenes[1];
  assert.equal(first.status, 'ready');
  assert.equal(first.url, 'https://shop.test/admin');
  assert.equal(first.actions, 2);
  // The destructive button and the unknown element were not turned into actions.
  // Inspections: 0 research, 1 fresh page, 2 first round, 3 after the link, 4 proof run.
  assert.deepEqual(calls.inspect[3].steps, [{ action: 'goto', url: 'https://shop.test/admin/packages' }]);
  assert.ok(state.log.some(entry => entry.level === 'warning' && /Delete all/.test(entry.text)));
  // The proof run executes exactly the accepted actions.
  assert.deepEqual(calls.inspect[4].steps, [
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

test('a rejected storyboard is reworked with the owner feedback and a new start address', async () => {
  const { autopilot, calls, run } = fixture();
  const started = await autopilot.start({
    project_id: project,
    prompt: 'Show how customers use the storefront.',
    mode: 'review'
  });
  let state = await run(started.id, 5);
  assert.equal(state.awaiting, 'approve');
  assert.equal(state.can_revise, true);
  await assert.rejects(autopilot.act({ id: started.id, action: 'revise' }), { statusCode: 422 });
  state = await autopilot.act({
    id: started.id,
    action: 'revise',
    feedback: 'Stay in the storefront, no admin scenes.',
    start_url: 'https://frontend.test/'
  });
  assert.equal(state.status, 'running');
  assert.equal(state.stage, 'plan');
  assert.equal(state.options.start_url, 'https://frontend.test/');
  assert.equal(state.options.login_profile_id, undefined);
  state = await run(started.id, 1);
  const second = calls.chat[1];
  assert.match(second.message, /Stay in the storefront, no admin scenes\./);
  assert.match(second.message, /All recordings start at https:\/\/frontend\.test\//);
  assert.equal(second.conversation_id, '44444444-4444-4444-8444-444444444444');
  assert.equal(second.context.scenes.length, 3);
  assert.ok(!JSON.stringify(second.context.scenes).includes('demoSteps'));
  // Recordings are planned again from the new address.
  state = await run(started.id, 1);
  assert.equal(calls.inspect.at(-1).url, 'https://frontend.test/');
  assert.equal(calls.inspect.at(-1).login_profile_id, undefined);
  state = await run(started.id, 3);
  assert.equal(state.awaiting, 'approve');
  assert.equal(calls.createJob.length, 0);

  await autopilot.act({ id: started.id, action: 'cancel' });
  state = await autopilot.act({ id: started.id, action: 'revise', feedback: 'Shorter, three scenes only.' });
  assert.equal(state.status, 'running');
  await run(started.id, 5);
  await autopilot.act({ id: started.id, action: 'approve' });
  state = await run(started.id, 1);
  assert.equal(state.can_revise, false);
  await assert.rejects(autopilot.act({ id: started.id, action: 'revise', feedback: 'Too late now.' }), {
    statusCode: 409
  });
});

test('the address in the request wins, cookie banners are closed and search fields can be used', async () => {
  assert.equal(
    requestedUrl('Demo of the converter\nhttps://shop.test/tools/convert?locale=en.'),
    'https://shop.test/tools/convert?locale=en'
  );
  assert.equal(requestedUrl('no address here'), null);
  const banner = [
    { role: 'button', name: 'Accept all', selector: '#all', in_view: true },
    { role: 'button', name: 'Necessary only', selector: '#needed', in_view: true }
  ];
  assert.deepEqual(consentStep(banner), { action: 'click', selector: '#needed' });
  assert.deepEqual(consentStep([banner[0]]), { action: 'click', selector: '#all' });
  assert.equal(consentStep([{ role: 'button', name: 'Accept all', selector: '#x', in_view: false }]), null);

  const page = {
    url: 'https://shop.test/tools/convert',
    title: 'Convert extensions',
    headings: ['Cookie settings', 'Convert extensions'],
    text: 'Turn an extension into a ZIP.',
    elements: [
      { selector: '#needed', role: 'button', name: 'Necessary only', in_view: true },
      { selector: '#q', role: 'textbox', name: 'Search products', type: 'text', in_view: true },
      { selector: '#note', role: 'textbox', name: 'Notes', type: 'text', in_view: true }
    ]
  };
  const { autopilot, calls, run } = fixture({
    inspect: () => page,
    plans: [
      {
        actions: [
          { type: 'type', element: 1, text: 'invoice', pixels: null, ms: null },
          { type: 'press_enter', element: 1, text: null, pixels: null, ms: null },
          { type: 'press_enter', element: 2, text: null, pixels: null, ms: null }
        ],
        done: true,
        note: ''
      }
    ]
  });
  const started = await autopilot.start({
    project_id: project,
    prompt: 'Demo of the converter https://shop.test/tools/convert please',
    start_url: 'https://shop.test/'
  });
  assert.equal(started.options.start_url, 'https://shop.test/tools/convert');
  assert.equal(started.options.login_profile_id, undefined);
  let state = await run(started.id, 1);
  // Research closed the banner before reading the page; the cookie heading is not part of the facts.
  assert.deepEqual(calls.inspect[1].steps, [{ action: 'click', selector: '#needed' }]);
  assert.doesNotMatch(calls.chat[0].message, /Cookie settings/);
  state = await run(started.id, 1);
  const proof = calls.inspect.at(-1).steps;
  assert.deepEqual(proof, [
    { action: 'click', selector: '#needed' },
    { action: 'wait', ms: 600 },
    { action: 'fill', selector: '#q', value: 'invoice' },
    { action: 'press', selector: '#q', key: 'Enter' }
  ]);
  assert.ok(state.log.some(entry => /nur in Suchfeldern/.test(entry.text)));
});

test('a cancelled storyboard is reworked at the address named in the request', async () => {
  const { autopilot, calls, run, rows } = fixture();
  const started = await autopilot.start({
    project_id: project,
    prompt: 'Explain the converter https://shop.test/tools/convert',
    mode: 'review'
  });
  await run(started.id, 1);
  // An older run started in the admin area although the request named the storefront page.
  const stored = rows.get(started.id);
  stored.options = JSON.stringify({
    ...JSON.parse(stored.options),
    start_url: 'https://shop.test/admin',
    start_from_prompt: undefined
  });
  const before = await autopilot.act({ id: started.id, action: 'cancel' });
  assert.equal(before.can_revise, true);
  assert.equal(before.options.start_url, 'https://shop.test/admin');
  const revised = await autopilot.act({
    id: started.id,
    action: 'revise',
    feedback: 'Stay in the storefront converter page.'
  });
  assert.equal(revised.status, 'running');
  assert.equal(revised.options.start_url, 'https://shop.test/tools/convert');
  await run(started.id, 1);
  assert.match(calls.chat.at(-1).message, /Stay in the storefront converter page/);
  assert.equal(calls.inspect.at(-1).url, 'https://shop.test/tools/convert');
});
