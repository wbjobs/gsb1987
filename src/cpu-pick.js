/* CPU 拾取降级：屏幕像素构造 NDC 阈值，在世界空间中比对投影位置 */

import { transformPoint } from './math.js';

/* 返回距离屏幕点最近的点索引；无结果返回 -1。tolerance 单位为 CSS 像素 */
export function cpuPick(data, mvp, model, cssX, cssY, cssWidth, cssHeight, options) {
  const count = data.count;
  const positions = data.positions;
  const sizes = data.sizes;
  const px = cssX / cssWidth * 2 - 1;
  const py = 1 - cssY / cssHeight * 2;
  const basePx = options && options.tolerance != null ? options.tolerance : 8;
  let best = -1;
  let bestDist = Infinity;
  const world = new Float32Array(3);

  for (let i = 0; i < count; i++) {
    const lx = positions[i * 3];
    const ly = positions[i * 3 + 1];
    const lz = positions[i * 3 + 2];
    world[0] = model[0] * lx + model[4] * ly + model[8] * lz + model[12];
    world[1] = model[1] * lx + model[5] * ly + model[9] * lz + model[13];
    world[2] = model[2] * lx + model[6] * ly + model[10] * lz + model[14];
    const clip = transformPoint(mvp, world[0], world[1], world[2]);
    if (!clip || clip[2] < -1 || clip[2] > 1) continue;
    const dx = clip[0] - px;
    const dy = clip[1] - py;
    const dist = dx * dx + dy * dy;
    const tolX = (basePx + (sizes[i] || 4) * 0.5) * 2 / cssWidth;
    const tolY = (basePx + (sizes[i] || 4) * 0.5) * 2 / cssHeight;
    const norm = (dx / tolX) * (dx / tolX) + (dy / tolY) * (dy / tolY);
    if (norm <= 1 && dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
