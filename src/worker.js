/* 数据 Worker：在后台线程生成/处理大规模点数据，传输零拷贝 ArrayBuffer */

'use strict';

if (typeof importScripts === 'function') {
  importScripts(self.location.href.replace(/worker\.js.*$/, 'data.js'));
}

self.onmessage = function (event) {
  const msg = event.data;
  if (!msg || msg.type !== 'generate') return;
  try {
    const count = Math.max(1, Math.min(2000000, msg.count | 0));
    const start = (self.performance && performance.now) ? performance.now() : Date.now();
    const data = self.ScatterData.generate(count, msg.seed || 1);
    const elapsed = ((self.performance && performance.now) ? performance.now() : Date.now()) - start;
    self.postMessage({
      type: 'data',
      positions: data.positions.buffer,
      sizes: data.sizes.buffer,
      colors: data.colors.buffer,
      count: data.count,
      meta: data.meta,
      elapsed: Math.round(elapsed)
    }, [data.positions.buffer, data.sizes.buffer, data.colors.buffer]);
  } catch (err) {
    self.postMessage({ type: 'error', message: (err && err.message) || String(err) });
  }
};
