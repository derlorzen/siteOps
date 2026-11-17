import test from 'node:test';
import assert from 'node:assert/strict';
import { ffmpegVideoSkill, ffmpegSkillSource } from '../lib/ffmpeg-skill-catalog.mjs';
import { builtinVideoSkills } from '../lib/video-skills.mjs';
import { renderWorkHome } from '../lib/product-ui.mjs';

test('the upstream FFmpeg workflow is available as one built-in Video Suite skill', () => {
  const matches = builtinVideoSkills.filter(skill => skill.id === 'ffmpeg-postproduktion');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].source, 'builtin');
  assert.equal(matches[0].mode, 'edit');
  assert.equal(matches[0].name, ffmpegVideoSkill.name);
  assert.match(matches[0].instructions, /probe the actual input/);
  assert.match(matches[0].instructions, /does not install or expose/);
  assert.equal(ffmpegSkillSource.availableToolsUpstream, 42);
});

test('the work homepage shows the FFmpeg skill and links to its SiteOps entry and source', () => {
  const html = renderWorkHome({
    websites: {
      items: [], total_sites: 0,
      counts: { online: 0, attention: 0, unknown: 0, paused: 0 }
    },
    tasks: [],
    activity: { entries: [] },
    sources: { tasks: { status: 'available' }, activity: { status: 'available' } }
  });
  assert.match(html, /SiteOps-Skills/);
  assert.ok(html.includes(ffmpegVideoSkill.name));
  assert.ok(html.includes('/video-suite#templates'));
  assert.ok(html.includes(ffmpegSkillSource.url));
  assert.match(html, /nicht automatisch installiert/);
});
