// Shared catalog entry for the external FFmpeg editing workflow.
// The upstream project is MIT-licensed; SiteOps references its method without bundling
// the third-party CLI/MCP server or claiming its tools are installed in the runner.
export const ffmpegSkillSource = Object.freeze({
  name: 'kajisho5/ffmpeg-skill',
  url: 'https://github.com/kajisho5/ffmpeg-skill',
  license: 'MIT',
  availableToolsUpstream: 42
});

export const ffmpegVideoSkill = Object.freeze({
  id: 'ffmpeg-postproduktion',
  name: 'FFmpeg · Postproduktion',
  summary: 'Dateien prüfen, Schnitt und Audio planen, Format-Exports und Qualitätskontrollen vorbereiten.',
  mode: 'edit',
  starter:
    'Prüfe meine vorhandene Videoproduktion und erstelle einen umsetzbaren FFmpeg-Postproduktionsplan: Schnitt, Format, Ton, Untertitel und Qualitätskontrolle.',
  instructions: [
    'Follow the verification-driven workflow of kajisho5/ffmpeg-skill (https://github.com/kajisho5/ffmpeg-skill): probe the actual input before deciding, prefer lossless operations when practical, plan edits, verify exported files and visually inspect changed frames where image inspection is available.',
    'Work from the real video, audio and scene metadata supplied by SiteOps. Do not invent duration, fps, resolution, LUFS, transcripts, cuts or visual observations. Identify unavailable measurements and tools explicitly.',
    'Recommend operations in an explicit sequence: probe, trim/join, remove silence where appropriate, reframe to the required aspect, captions/overlays, audio cleanup and loudness, platform export, check and visual review. Respect subtitle safe areas, brand assets and existing approved browser recordings.',
    'For YouTube landscape and Shorts or Reels portrait, select delivery settings only from the named destination and the production requirements; do not assert an upload limit without verification.',
    'Never overwrite originals. Changes to approved footage, recordings or a completed production require explicit user approval. Preserve the original voice and transcript unless an edit is requested.',
    'This is a planning and review skill in the SiteOps Video Suite. It does not install or expose the upstream 42 CLI/MCP tools. Do not claim to have run ffmpeg-skill, processed a media file, or passed verification without real runner tool results.',
    'If the user asks for a concrete plan, give concise steps with the expected input and output plus a checklist of measurable validation criteria. Return draft=null unless a deliberate change to the scene plan is requested.'
  ].join(' ')
});
