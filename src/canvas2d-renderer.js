/* Canvas 2D 降级渲染器：无 WebGL 时使用，采样上限保证性能 */

import { transformPoint } from './math.js';
import { cpuPick } from './cpu-pick.js';

const MAX_DRAW_POINTS = 12000;

export class Canvas2DRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('CANVAS2D_UNAVAILABLE');
    this.count = 0;
    this.dpr = 1;
    this.gpuPickSupported = false;
    this.onContextLost = null;
  }

  static isSupported(canvas) {
    const probe = canvas || document.createElement('canvas');
    return !!probe.getContext('2d');
  }

  setData(data) {
    this.data = data;
    this.count = data.count;
    this.stride = Math.max(1, Math.ceil(data.count / MAX_DRAW_POINTS));
  }

  resize(width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
  }

  _color(i) {
    const colors = this.data.colors;
    return 'rgb(' +
      Math.round(colors[i * 3] * 255) + ',' +
      Math.round(colors[i * 3 + 1] * 255) + ',' +
      Math.round(colors[i * 3 + 2] * 255) + ')';
  }

  _project(x, y, z) {
    const c = transformPoint(this._mvp, x, y, z);
    if (!c || c[3] <= 0) return null;
    const w = this.canvas.width;
    const h = this.canvas.height;
    return {
      sx: (c[0] * 0.5 + 0.5) * w,
      sy: (1 - (c[1] * 0.5 + 0.5)) * h,
      depth: c[2],
      w: c[3]
    };
  }

  _drawAxes() {
    const ctx = this.ctx;
    const L = 1.25;
    const axes = [
      [[0, 0, 0], [L, 0, 0], '#f25952'],
      [[0, 0, 0], [0, L, 0], '#59d973'],
      [[0, 0, 0], [0, 0, L], '#6699fa']
    ];
    ctx.lineWidth = Math.max(1, this.dpr);
    axes.forEach(([a, b, color]) => {
      const pa = this._project(a[0], a[1], a[2]);
      const pb = this._project(b[0], b[1], b[2]);
      if (!pa || !pb) return;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(pa.sx, pa.sy);
      ctx.lineTo(pb.sx, pb.sy);
      ctx.stroke();
    });
  }

  render(camera) {
    if (!this.data || this.count === 0) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    this._mvp = camera.mvp;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e1117';
    ctx.fillRect(0, 0, w, h);
    this._drawAxes();

    const positions = this.data.positions;
    const stride = this.stride;
    const points = [];
    for (let i = 0; i < this.count; i += stride) {
      const p = this._project(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      if (p && p.depth >= -1 && p.depth <= 1) {
        p.i = i;
        p.r = Math.max(1.5 * this.dpr, (this.data.sizes[i] || 4) * this.dpr * (camera.refDist / Math.max(0.1, p.w)));
        points.push(p);
      }
    }
    points.sort((a, b) => b.depth - a.depth);
    const selected = camera.selectedId;
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const sel = selected === p.i;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, sel ? p.r * 1.8 : p.r, 0, Math.PI * 2);
      ctx.fillStyle = sel ? '#ffffff' : this._color(p.i);
      ctx.globalAlpha = 0.9;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  pick(camera, cssX, cssY) {
    const rect = this.canvas.getBoundingClientRect();
    return cpuPick(
      this.data, camera.mvp, camera.model,
      cssX, cssY, rect.width, rect.height, { tolerance: 8 }
    );
  }

  dispose() {}
}
