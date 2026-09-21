/* 散点数据生成：可在 Worker（importScripts）与主线程（<script>）共用 */
(function (global) {
  'use strict';

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(rng) {
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  const PALETTE = [
    [0.95, 0.36, 0.32],
    [0.30, 0.69, 0.95],
    [0.47, 0.80, 0.35],
    [0.98, 0.75, 0.27],
    [0.68, 0.51, 0.96],
    [0.18, 0.82, 0.80]
  ];

  /* 生成 6 个高斯团簇，坐标归一化到约 [-1, 1] */
  function generate(count, seed) {
    const rng = mulberry32(seed || 1);
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const centers = [
      [0.55, 0.55, 0.45], [-0.55, 0.5, 0.4], [0.45, -0.55, -0.35],
      [-0.5, -0.45, -0.5], [0.1, 0.1, -0.7], [-0.15, -0.1, 0.7]
    ];
    for (let i = 0; i < count; i++) {
      const c = centers[i % centers.length];
      const spread = 0.16 + rng() * 0.1;
      const x = c[0] + gaussian(rng) * spread;
      const y = c[1] + gaussian(rng) * spread;
      const z = c[2] + gaussian(rng) * spread;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      sizes[i] = 3 + rng() * 6;
      const col = PALETTE[i % PALETTE.length];
      const shade = 0.75 + rng() * 0.4;
      colors[i * 3] = Math.min(1, col[0] * shade);
      colors[i * 3 + 1] = Math.min(1, col[1] * shade);
      colors[i * 3 + 2] = Math.min(1, col[2] * shade);
    }
    return {
      count: count,
      positions: positions,
      sizes: sizes,
      colors: colors,
      meta: { clusters: centers.length }
    };
  }

  const api = { generate: generate, mulberry32: mulberry32, gaussian: gaussian };
  global.ScatterData = api;
  if (typeof self !== 'undefined') self.ScatterData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
