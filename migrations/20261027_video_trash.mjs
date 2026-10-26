export default async function migrateVideoTrash({ ensureColumn }) {
  await ensureColumn('video_studio_jobs', 'deleted_at', 'DATETIME(3) NULL');
}
