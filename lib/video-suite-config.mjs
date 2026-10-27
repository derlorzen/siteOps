// Shared server-side configuration for the producer and OpenAI narration.
export async function videoSuiteOpenAIConfiguration({ db, decrypt, env = process.env }) {
  let saved = {};
  if (typeof decrypt === 'function') {
    const [rows] = await db.query('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', [
      'video_suite_openai'
    ]);
    if (rows.length) saved = decrypt(rows[0].setting_value);
  }
  return { model: 'gpt-4.1', image_model: 'gpt-image-1', ...saved, api_key: saved.api_key || env.OPENAI_API_KEY || '' };
}
