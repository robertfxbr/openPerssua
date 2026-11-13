export const LISTEN_INTERVAL_MS = 30 * 60 * 1000;
export const LISTEN_REPLY_MS = 60 * 1000;

// Relógio absoluto: atrasos de timers não reiniciam os 30 minutos.
export function createListenReminder({ startedAt, now = Date.now, onWarn, onPause }) {
  let baseline = startedAt;
  let deadline = null;
  let cancelled = false;
  return {
    tick() {
      if (cancelled) return;
      const current = now();
      if (deadline !== null && current >= deadline) {
        cancelled = true;
        onPause();
      } else if (deadline === null && current - baseline >= LISTEN_INTERVAL_MS) {
        deadline = current + LISTEN_REPLY_MS;
        onWarn(deadline);
      }
    },
    confirm() { if (!cancelled) { baseline = now(); deadline = null; } },
    cancel() { cancelled = true; },
  };
}
