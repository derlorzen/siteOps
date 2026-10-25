import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoStudio } from '../lib/video-studio.mjs';

function fakeDatabase() {
  const projects = new Map();
  return {
    projects,
    db: {
      query: async (sql, args = []) => {
        if (sql.startsWith('INSERT INTO video_studio_projects')) {
          const [id, name, channel, language, voice_provider, voice] = args;
          projects.set(id, { id, name, channel, language, voice_provider, voice });
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('UPDATE video_studio_projects')) {
          const [name, channel, language, voice_provider, voice, id] = args;
          projects.set(id, { ...projects.get(id), name, channel, language, voice_provider, voice });
          return [{ affectedRows: 1 }];
        }
        if (sql.startsWith('SELECT * FROM video_studio_projects')) return [[projects.get(args[0])].filter(Boolean)];
        return [[]];
      }
    }
  };
}

test('English projects use free local Kokoro by default', async () => {
  const { db } = fakeDatabase();
  const studio = createVideoStudio({ db, runnerUrl: () => '', runnerToken: () => '' });
  const project = await studio.createProject({ name: 'English Bagisto', language: 'en' });
  assert.equal(project.language, 'en');
  assert.equal(project.voice_provider, 'kokoro');
  assert.equal(project.voice, 'am_michael');
});

test('German projects use free local Piper and can select licensed German voices', async () => {
  const { db } = fakeDatabase();
  const studio = createVideoStudio({ db, runnerUrl: () => '', runnerToken: () => '' });
  const project = await studio.createProject({ name: 'Bagisto auf Deutsch', language: 'de' });
  assert.equal(project.voice_provider, 'piper');
  assert.equal(project.voice, 'de_DE-thorsten-medium');
  const changed = await studio.updateProject(project.id, { voice: 'de_DE-kerstin-low' });
  assert.equal(changed.voice, 'de_DE-kerstin-low');
});

test('A project can switch between languages without inheriting an invalid local voice', async () => {
  const { db } = fakeDatabase();
  const studio = createVideoStudio({ db, runnerUrl: () => '', runnerToken: () => '' });
  const project = await studio.createProject({ name: 'Bilingual tutorials' });
  const converted = await studio.updateProject(project.id, { language: 'de' });
  assert.equal(converted.voice_provider, 'piper');
  assert.equal(converted.voice, 'de_DE-thorsten-medium');
});

test('Reject unsupported combinations; OpenAI works in both languages', async () => {
  const { db } = fakeDatabase();
  const studio = createVideoStudio({ db, runnerUrl: () => '', runnerToken: () => '' });
  await assert.rejects(
    studio.createProject({ name: 'Bad German Kokoro', language: 'de', voice_provider: 'kokoro' }),
    /unterstützt/
  );
  await assert.rejects(
    studio.createProject({ name: 'Bad English Piper', language: 'en', voice_provider: 'piper' }),
    /unterstützt/
  );
  const de = await studio.createProject({ name: 'German OpenAI', language: 'de', voice_provider: 'openai' });
  const en = await studio.createProject({ name: 'English OpenAI', language: 'en', voice_provider: 'openai' });
  assert.equal(de.voice, 'alloy');
  assert.equal(en.voice, 'alloy');
});
