// One process-wide concurrency limit shared by synthetic checks and Video Studio.
// Playwright's browser 'disconnected' event fires on both normal close and crash.
// This keeps the slot occupied until Chromium is actually gone, not just until an
// HTTP client disconnects or a request handler returns.
const readLimit = () => {
  const parsed = Number(process.env.BROWSER_MAX_SESSIONS || '2');
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 8 ? parsed : 2;
};
const maxSessions = readLimit();
let activeSessions = 0;

export function browserCapacityStatus() {
  return { active: activeSessions, max: maxSessions };
}

export async function launchGuarded(launch, options) {
  if (activeSessions >= maxSessions) {
    const error = new Error('Browser capacity reached; retry when an active session finishes.');
    error.statusCode = 503;
    throw error;
  }
  activeSessions++;
  let released = false;
  const release = () => {
    if (!released) {
      released = true;
      activeSessions = Math.max(0, activeSessions - 1);
    }
  };
  try {
    const browser = await launch(options);
    // A disconnected event is emitted on explicit browser.close(), a
    // browser crash, and loss of the browser transport.
    browser.once('disconnected', release);
    if (!browser.isConnected()) release();
    return browser;
  } catch (error) {
    release();
    throw error;
  }
}
