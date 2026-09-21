/* 轨迹球：把屏幕点映射到虚拟球，四元数累积旋转，带松手惯性 */

import { quatFromVectors, quatMultiply } from './math.js';

export class Arcball {
  constructor(canvas) {
    this.canvas = canvas;
    this.orientation = new Float32Array([0, 0, 0, 1]);
    this.active = false;
    this.lastX = 0;
    this.lastY = 0;
    this.lastT = 0;
    this.v0 = new Float32Array(3);
    this.axis = new Float32Array([0, 1, 0]);
    this.angularSpeed = 0;
  }

  _vector(clientX, clientY, out) {
    const rect = this.canvas.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.5;
    const x = (clientX - rect.left - rect.width * 0.5) / radius;
    const y = (rect.top + rect.height * 0.5 - clientY) / radius;
    let nx = x, ny = y;
    const d2 = nx * nx + ny * ny;
    let nz = 0;
    if (d2 <= 1) {
      nz = Math.sqrt(1 - d2);
    } else {
      const n = 1 / Math.sqrt(d2);
      nx *= n;
      ny *= n;
      nz = 0;
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    out[0] = nx / len;
    out[1] = ny / len;
    out[2] = nz / len;
    return out;
  }

  start(x, y) {
    this.active = true;
    this.lastX = x;
    this.lastY = y;
    this.lastT = performance.now();
    this._vector(x, y, this.v0);
    this.angularSpeed = 0;
  }

  move(x, y) {
    if (!this.active) return false;
    const v1 = this._vector(x, y, new Float32Array(3));
    const dq = quatFromVectors(new Float32Array(4), this.v0, v1);
    quatMultiply(this.orientation, dq, this.orientation);
    this.v0.set(v1);

    const now = performance.now();
    const dt = Math.max(1, now - this.lastT);
    const ax = dq[0], ay = dq[1], az = dq[2];
    const sinHalf = Math.min(1, Math.hypot(ax, ay, az));
    if (sinHalf > 1e-6) {
      const angle = 2 * Math.asin(sinHalf);
      const inv = 1 / sinHalf;
      this.axis[0] = ax * inv;
      this.axis[1] = ay * inv;
      this.axis[2] = az * inv;
      this.angularSpeed = angle / dt;
    }
    this.lastT = now;
    this.lastX = x;
    this.lastY = y;
    return true;
  }

  end() {
    this.active = false;
  }

  /* 返回是否仍在运动（含惯性） */
  update(dt) {
    if (this.active) return true;
    if (this.angularSpeed <= 0.00005) {
      this.angularSpeed = 0;
      return false;
    }
    const angle = this.angularSpeed * dt;
    const half = angle * 0.5;
    const s = Math.sin(half);
    const dq = new Float32Array([
      this.axis[0] * s, this.axis[1] * s, this.axis[2] * s, Math.cos(half)
    ]);
    quatMultiply(this.orientation, dq, this.orientation);
    this.angularSpeed *= Math.pow(0.02, dt / 1000);
    return true;
  }

  reset() {
    this.orientation.set([0, 0, 0, 1]);
    this.angularSpeed = 0;
  }
}
