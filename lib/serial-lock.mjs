// Serialises async operations (one at a time, in call order) like a plain promise chain, but
// with a maximum hold time per operation. A plain chain blocks every later operation forever
// if one of them never settles (a hung FTP data socket, a stalled HTTP request): that is how
// a single stuck backup snapshot used to freeze every following change_apply. When an
// operation exceeds its hold time, its caller gets a LOCK_HOLD_TIMEOUT error and the queue
// moves on. The stuck operation itself cannot be cancelled from here; anything it still does
// afterwards must be safe against a concurrent writer (the backup commits use non-forced ref
// updates, so a late commit fails instead of overwriting newer history).
export function createSerialLock({ maxHoldMs = 10 * 60 * 1000, onTimeout } = {}) {
  let tail = Promise.resolve();
  let active = null;
  function withLock(fn, { maxHoldMs: hold = maxHoldMs, label = 'operation' } = {}) {
    const run = tail.then(() => runBounded(fn, hold, label));
    tail = run.catch(() => {});
    return run;
  }
  function runBounded(fn, hold, label) {
    return new Promise((resolve, reject) => {
      let settled = false;
      active = { label, startedAt: Date.now() };
      const finish = () => {
        settled = true;
        clearTimeout(timer);
        active = null;
      };
      const timer = setTimeout(() => {
        if (settled) return;
        finish();
        try {
          onTimeout?.({ label, maxHoldMs: hold });
        } catch {}
        reject(
          Object.assign(new Error(`${label} held the backup lock longer than ${hold} ms; lock released`), {
            code: 'LOCK_HOLD_TIMEOUT'
          })
        );
      }, hold);
      Promise.resolve()
        .then(fn)
        .then(
          value => {
            if (settled) return;
            finish();
            resolve(value);
          },
          error => {
            if (settled) return;
            finish();
            reject(error);
          }
        );
    });
  }
  withLock.active = () => (active ? { ...active, heldMs: Date.now() - active.startedAt } : null);
  return withLock;
}
