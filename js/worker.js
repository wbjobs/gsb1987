/* 点云引擎：数据生成 + CPU 拾取。
   既可作为 Web Worker 运行，也可在主线程直接加载（Worker 不可用时的降级）。 */
'use strict';

const PointCloudEngine = {
  /* 生成多簇高斯点云，返回 { positions, colors }（Float32Array） */
  generate(count) {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const clusters = [];
    const palette = [
      [0.35, 0.65, 1.0], [1.0, 0.45, 0.42], [0.35, 0.85, 0.55],
      [0.95, 0.75, 0.30], [0.75, 0.55, 1.0], [0.40, 0.85, 0.90],
    ];
    const K = palette.length;
    for (let k = 0; k < K; k++) {
      const a = (k / K) * Math.PI * 2;
      clusters.push({
        cx: Math.cos(a) * 55, cy: (k % 3 - 1) * 35, cz: Math.sin(a) * 55,
        spread: 14 + (k % 3) * 8, color: palette[k],
      });
    }
    // Box-Muller 高斯
    let spare = null;
    const gauss = () => {
      if (spare !== null) { const v = spare; spare = null; return v; }
      let u = 0, v = 0, s = 0;
      do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
      const m = Math.sqrt(-2 * Math.log(s) / s);
      spare = v * m;
      return u * m;
    };
    for (let i = 0; i < count; i++) {
      const c = clusters[i % K];
      positions[i * 3]     = c.cx + gauss() * c.spread;
      positions[i * 3 + 1] = c.cy + gauss() * c.spread * 0.7;
      positions[i * 3 + 2] = c.cz + gauss() * c.spread;
      const jitter = 0.85 + Math.random() * 0.15;
      colors[i * 3]     = c.color[0] * jitter;
      colors[i * 3 + 1] = c.color[1] * jitter;
      colors[i * 3 + 2] = c.color[2] * jitter;
    }
    return { positions, colors };
  },

  /* CPU 拾取：把点投到屏幕，找鼠标半径内最近（深度最小）的点。
     mvp: Float32Array(16)；返回 id 或 -1。 */
  pick(positions, mvp, mouseX, mouseY, width, height, radiusPx) {
    let best = -1, bestDepth = Infinity;
    const r2 = radiusPx * radiusPx;
    const n = positions.length / 3;
    for (let i = 0; i < n; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (cw <= 0) continue; // 相机后方
      const cx = (mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / cw;
      const cy = (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / cw;
      const cz = (mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14]) / cw;
      if (cx < -1 || cx > 1 || cy < -1 || cy > 1 || cz < -1 || cz > 1) continue;
      const sx = (cx + 1) * 0.5 * width;
      const sy = (1 - cy) * 0.5 * height;
      const dx = sx - mouseX, dy = sy - mouseY;
      const d2 = dx * dx + dy * dy;
      if (d2 <= r2 && cz < bestDepth) { bestDepth = cz; best = i; }
    }
    return best;
  },
};

/* Worker 模式：仅在真正的 Worker 全局中注册消息处理 */
if (typeof self !== 'undefined' && typeof self.importScripts === 'function' && typeof window === 'undefined') {
  let positions = null;
  self.onmessage = (e) => {
    const msg = e.data;
    try {
      if (msg.type === 'generate') {
        const t0 = Date.now();
        const data = PointCloudEngine.generate(msg.count);
        self.postMessage(
          { type: 'generated', positions: data.positions, colors: data.colors, elapsed: Date.now() - t0 },
          [data.positions.buffer, data.colors.buffer]
        );
      } else if (msg.type === 'setPositions') {
        positions = msg.positions;
      } else if (msg.type === 'pick') {
        const id = PointCloudEngine.pick(
          positions, msg.mvp, msg.x, msg.y, msg.width, msg.height, msg.radius
        );
        self.postMessage({ type: 'picked', id, seq: msg.seq });
      }
    } catch (err) {
      self.postMessage({ type: 'error', message: String(err && err.message || err) });
    }
  };
}

if (typeof module !== 'undefined') module.exports = PointCloudEngine;
