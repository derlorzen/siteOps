export default async function migrateVideoVoiceProvider({ ensureColumn }) {
  await ensureColumn(
    'video_studio_projects',
    'voice_provider',
    "VARCHAR(16) NOT NULL DEFAULT 'kokoro'"
  );
}
