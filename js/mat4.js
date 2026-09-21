/* 极简 mat4/vec 数学库（列主序，与 WebGL 一致） */
'use strict';
const Mat4 = {
  identity() {
    return new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  },
  multiply(a, b, out) {
    out = out || new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c*4+r] = a[r]*b[c*4] + a[4+r]*b[c*4+1] + a[8+r]*b[c*4+2] + a[12+r]*b[c*4+3];
      }
    }
    return out;
  },
  perspective(fovY, aspect, near, far) {
    const f = 1 / Math.tan(fovY / 2), nf = 1 / (near - far);
    const o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f;
    o[10] = (far + near) * nf; o[11] = -1;
    o[14] = 2 * far * near * nf;
    return o;
  },
  /* 轨道相机：yaw/pitch/distance -> view 矩阵 */
  orbit(yaw, pitch, dist) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ex = dist * cp * sy, ey = dist * sp, ez = dist * cp * cy;
    // lookAt(eye, [0,0,0], up)
    let fx = -ex, fy = -ey, fz = -ez;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(fy) > 0.999) { ux = 1; uy = 0; }
    // s = f x u
    let sx = fy*uz - fz*uy, sy2 = fz*ux - fx*uz, sz = fx*uy - fy*ux;
    const sl = Math.hypot(sx, sy2, sz); sx /= sl; sy2 /= sl; sz /= sl;
    // u' = s x f
    const ux2 = sy2*fz - sz*fy, uy2 = sz*fx - sx*fz, uz2 = sx*fy - sy2*fx;
    return new Float32Array([
      sx, ux2, -fx, 0,
      sy2, uy2, -fy, 0,
      sz, uz2, -fz, 0,
      -(sx*ex + sy2*ey + sz*ez), -(ux2*ex + uy2*ey + uz2*ez), (fx*ex + fy*ey + fz*ez), 1
    ]);
  },
  /* 点变换：p' = m * [x,y,z,1]，返回 [x,y,z,w] */
  transformPoint(m, x, y, z, out, off) {
    out[off]   = m[0]*x + m[4]*y + m[8]*z  + m[12];
    out[off+1] = m[1]*x + m[5]*y + m[9]*z  + m[13];
    out[off+2] = m[2]*x + m[6]*y + m[10]*z + m[14];
    out[off+3] = m[3]*x + m[7]*y + m[11]*z + m[15];
  }
};
if (typeof module !== 'undefined') module.exports = Mat4;
