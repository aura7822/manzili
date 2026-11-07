import { reactive } from 'vue';
import { session } from './api.js';

/** Shared live-update state. Views watch `live.tick` and reload quietly when something changes. */
export const live = reactive({ connected: false, tick: 0, last: null });

let stop = null;

export function startLive() {
  if (stop) return;
  let halted = false;
  let controller = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function loop() {
    while (!halted && session.token) {
      try {
        controller = new AbortController();
        const res = await fetch('/api/events', {
          headers: { Authorization: `Bearer ${session.token}` },
          signal: controller.signal,
        });
        if (!res.ok || !res.body) throw new Error('stream unavailable');

        live.connected = true;
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const type = /^event: (.+)$/m.exec(frame)?.[1];
            const data = /^data: (.+)$/m.exec(frame)?.[1];
            if (type && data) {
              try {
                live.last = { type, data: JSON.parse(data) };
                live.tick++;
              } catch { /* ignore malformed frame */ }
            }
          }
        }
      } catch { /* fall through to retry */ }
      live.connected = false;
      if (!halted) await sleep(3000);
    }
  }

  loop();
  stop = () => {
    halted = true;
    controller?.abort();
    live.connected = false;
    stop = null;
  };
}

export function stopLive() {
  stop?.();
}
