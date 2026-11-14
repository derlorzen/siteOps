// Shared server-side configuration for the producer and OpenAI narration.
export async function videoSuiteOpenAIConfiguration({ db, decrypt, env = process.env }) {
  let saved = {};
  if (typeof decrypt === 'function') {
    const [rows] = await db.query('SELECT setting_value FROM app_settings WHERE setting_key=? LIMIT 1', [
      'video_suite_openai'
    ]);
    if (rows.length) saved = decrypt(rows[0].setting_value);
  }
  const provider = saved.provider === 'nvidia' ? 'nvidia' : 'openai';
  const openaiApiKey = saved.openai_api_key || saved.api_key || env.OPENAI_API_KEY || '';
  const nvidiaApiKey = saved.nvidia_api_key || env.NVIDIA_API_KEY || '';
  return {
    model: provider === 'nvidia' ? 'nvidia/nemotron-3.5-super-vl-120b-a12b' : 'gpt-4.1',
    image_model: 'gpt-image-1',
    ...saved,
    provider,
    openai_api_key: openaiApiKey,
    nvidia_api_key: nvidiaApiKey,
    // Keep api_key bound to OpenAI: the narration runner uses this shared configuration.
    api_key: openaiApiKey
  };
}
