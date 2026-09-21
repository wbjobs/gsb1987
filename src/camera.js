/* 相机：透视投影 + 轨迹球模型旋转 + 缩放 */

import { perspective, lookAt, multiply, fromQuat } from './math.js';
import { Arcball } from './arcball.js';

const NEAR = 0.1;
const FAR = 100;
const MIN_DIST = 1.6;
const MAX_DIST = 12;

export class Camera {
  constructor(canvas) {
    this.canvas = canvas;
    this.arcball = new Arcball(canvas);
    this.distance = 4.2;
    this.targetDist = 4.2;
    this.refDist = 4.2;
    this.fovy = Math.PI / 4;
    this.proj = new Float32Array(16);
    this.view = new Float32Array(16);
    this.model = new Float32Array(16);
    this.mvp = new Float32Array(16);
    this._scratch = new Float32Array(16);
    this.selectedId = null;
    this.updateProjection();
    this.updateMatrices();
  }

  updateProjection() {
    const aspect = this.canvas.width && this.canvas.height
      ? this.canvas.width / this.canvas.height
      : 1;
    perspective(this.proj, this.fovy, aspect, NEAR, FAR);
  }

  updateMatrices() {
    lookAt(this.view, [0, 0, this.distance], [0, 0, 0], [0, 1, 0]);
    fromQuat(this.model, this.arcball.orientation);
    multiply(this._scratch, this.view, this.model);
    multiply(this.mvp, this.proj, this._scratch);
  }

  update(dt) {
    const spinning = this.arcball.update(dt);
    let zooming = false;
    if (Math.abs(this.targetDist - this.distance) > 0.001) {
      const k = 1 - Math.pow(0.002, dt / 1000);
      this.distance += (this.targetDist - this.distance) * k;
      zooming = true;
    }
    this.updateMatrices();
    return spinning || zooming;
  }

  zoom(factor) {
    this.targetDist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.targetDist * factor));
  }

  reset() {
    this.arcball.reset();
    this.distance = this.targetDist = 4.2;
  }
}

