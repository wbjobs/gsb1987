/* Canvas 2D 兜底渲染器：WebGL 不可用时使用，仍支持旋转与拾取 */
'use strict';

class Fallback2DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D 也不可用');
    this.pointCount = 0;
    this.pickSupported = false; // 拾取走 CPU（Worker 或主线程）
    this._order = null;
  }

  setData(positions, colors) {
    this.positions = positions;
    this.colors = colors;
    this.pointCount = positions.length / 3;
    this._order = new Uint32Array(this.pointCount);
    for (let i = 0; i < this.pointCount; i++) this._order[i] = i;
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
  }

  render(mvp, pointSize, highlightId) {
    const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
    const pos = this.positions, col = this.colors, n = this.pointCount;
    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, w, h);
    if (!pos) return;
    // 投影并按深度排序（远 -> 近）
    const sx = new Float32Array(n), sy = new Float32Array(n), sz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
      if (cw <= 0.001) { sz[i] = Infinity; continue; }
      sx[i] = ((mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12]) / cw + 1) * 0.5 * w;
      sy[i] = (1 - (mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13]) / cw) * 0.5 * h;
      sz[i] = (mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14]) / cw;
    }
    const order = this._order;
    Array.prototype.sort.call(order, (a, b) => sz[b] - sz[a]);
    const r = Math.max(1, pointSize * 0.4);
    for (let k = 0; k < n; k++) {
      const i = order[k];
      if (!isFinite(sz[i]) || sz[i] < -1 || sz[i] > 1) continue;
      if (sx[i] < -r || sx[i] > w + r || sy[i] < -r || sy[i] > h + r) continue;
      if (i === highlightId) {
        ctx.fillStyle = '#ffd94d';
        ctx.beginPath(); ctx.arc(sx[i], sy[i], r * 1.8, 0, 6.2832); ctx.fill();
      } else {
        ctx.fillStyle = `rgb(${col[i*3]*255|0},${col[i*3+1]*255|0},${col[i*3+2]*255|0})`;
        ctx.fillRect(sx[i] - r / 2, sy[i] - r / 2, r, r);
      }
    }
  }

  pick() { return -2; } // 始终走 CPU 拾取
  dispose() {}
}
