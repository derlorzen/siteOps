import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVideoStudio, registerVideoStudioRoutes } from '../lib/video-studio.mjs';
import { renderVideoStudio } from '../lib/video-studio-ui.mjs';

const id = '11111111-1111-4111-8111-111111111111';
test('Video Studio creates a project, stores scene paragraphs and lists jobs', async () => {
  const rows = { project: null, job: null };
  const db = {
    query: async (sql, params = []) => {
      if (sql.startsWith('INSERT INTO video_studio_projects')) {
        rows.project = {
          id: params[0],
          name: params[1],
          channel: params[2],
          language: params[3],
          voice_provider: params[4],
          voice: params[5]
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM video_studio_projects')) return [[rows.project].filter(Boolean)];
      if (sql.startsWith('INSERT INTO video_studio_jobs')) {
        rows.job = {
          id: params[0],
          project_id: params[1],
          title: params[2],
          topic: params[3],
          script: params[4],
          scenes: params[5],
          format: params[6],
          status: params[7],
          runner_job_id: null
        };
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith('SELECT * FROM video_studio_jobs')) return [[rows.job].filter(Boolean)];
      return [[]];
    }
  };
  const studio = createVideoStudio({ db, runnerUrl: () => '', runnerToken: () => '' });
  const p = await studio.createProject({ name: 'Bagisto Tutorials' });
  assert.equal(p.language, 'en');
  assert.equal(p.voice_provider, 'kokoro');
  assert.equal(p.voice, 'am_michael');
  const job = await studio.createJob({
    project_id: p.id,
    title: 'Bagisto AI',
    script: 'First meaningful scene text.\n\nSecond demonstration scene text.'
  });
  assert.equal(job.status, 'draft');
  assert.equal(job.scenes.length, 2);
  assert.equal(job.scenes[0].headline, 'Bagisto AI');
  await assert.rejects(studio.renderJob(job.id), /Browser Runner/);
});
test('Video Studio supports explicit OpenAI projects and rejects mismatched voices', async () => {
  const db = {
    query: async (sql, params = []) => {
      if (sql.startsWith('INSERT INTO video_studio_projects')) return [{ affectedRows: 1 }];
      if (sql.startsWith('SELECT * FROM video_studio_projects'))
        return [[{ id: '11111111-1111-4111-8111-111111111111', voice_provider: 'openai', voice: 'alloy' }]];
      return [[]];
    }
  };
  const studio = createVideoStudio({ db, runnerUrl: () => '', runnerToken: () => '' });
  await assert.rejects(
    studio.createProject({ name: 'Bad Voice', voice_provider: 'openai', voice: 'am_adam' }),
    /Stimme/
  );
  const project = await studio.createProject({ name: 'OpenAI Videos', voice_provider: 'openai', voice: 'alloy' });
  assert.equal(project.voice_provider, 'openai');
});
test('German videos choose Piper by default and reject mismatched offline languages', async () => {
  const projects=[];
  const db={query:async(sql,params=[])=>{
    if(sql.startsWith('INSERT INTO video_studio_projects')){
      projects.push({id:params[0],name:params[1],channel:params[2],language:params[3],voice_provider:params[4],voice:params[5]});
      return [{affectedRows:1}];
    }
    if(sql.startsWith('SELECT * FROM video_studio_projects')) return [[projects.find(p=>p.id===params[0])].filter(Boolean)];
    return [[]];
  }};
  const studio=createVideoStudio({db,runnerUrl:()=>'',runnerToken:()=>''});
  const german=await studio.createProject({name:'Deutsche Tutorials',language:'de'});
  assert.equal(german.language,'de');
  assert.equal(german.voice_provider,'piper');
  assert.equal(german.voice,'de_DE-thorsten-medium');
  const english=await studio.createProject({name:'English tutorials',language:'en'});
  assert.equal(english.voice_provider,'kokoro');
  await assert.rejects(studio.createProject({name:'Invalid DE',language:'de',voice_provider:'kokoro'}),/Kokoro/);
  await assert.rejects(studio.createProject({name:'Invalid EN',language:'en',voice_provider:'piper'}),/Piper/);
  const multi=await studio.createProject({name:'Deutsch API',language:'de',voice_provider:'openai'});
  assert.equal(multi.voice,'alloy');
});
test('Video Studio validates scenes and project identifiers', async () => {
  const studio = createVideoStudio({ db: { query: async () => [[]] }, runnerUrl: () => '', runnerToken: () => '' });
  await assert.rejects(
    studio.createJob({
      project_id: 'not-a-uuid',
      title: 'Bad',
      script: 'This is a long enough example script for validation.'
    })
  );
  await assert.rejects(studio.createProject({ name: '' }));
});
test('Video Studio registers dashboard, JSON API and guarded media download routes', () => {
  const paths = [];
  const app = { addHook: () => {}, get: path => paths.push('GET ' + path), post: path => paths.push('POST ' + path) };
  registerVideoStudioRoutes(
    app,
    {},
    () => '',
    renderVideoStudio,
    () => 'https://example.com'
  );
  for (const p of [
    'GET /video-studio',
    'GET /api/video-studio/projects',
    'POST /api/video-studio/jobs',
    'POST /api/video-studio/jobs/:id/render',
    'GET /api/video-studio/jobs/:id/file'
  ])
    assert.ok(paths.includes(p), p);
  assert.match(renderVideoStudio(), /Video Studio/);
});
