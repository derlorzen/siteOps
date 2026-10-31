export function operationState(raw) {
  const states = {
    queued: 'waiting',
    pending: 'waiting',
    scheduled: 'waiting',
    running: 'running',
    processing: 'running',
    rendering: 'running',
    deploying: 'running',
    completed: 'completed',
    succeeded: 'completed',
    done: 'completed',
    failed: 'failed',
    error: 'failed',
    cancelled: 'cancelled',
    canceled: 'cancelled'
  };
  const source = raw?.status ?? raw?.state ?? null;
  return { status: states[source] || 'unknown', source_status: source, result: raw };
}
