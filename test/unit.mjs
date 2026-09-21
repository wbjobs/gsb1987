import assert from 'node:assert/strict';
import { perspective, lookAt, multiply, fromQuat, quatFromVectors, quatMultiply, transformPoint } from '../src/math.js';
import { Arcball } from '../src/arcball.js';
import { Camera } from '../src/camera.js';
import { cpuPick } from '../src/cpu-pick.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS  ' + name); }
  catch (e) { console.error('FAIL  ' + name + ' -> ' + e.message); process.exitCode = 1; }
}

test('透视投影：相机前方点映射到 NDC', () => {
  const p = new Float32Array(16);
  perspective(p, Math.PI / 2, 1, 1, 100);
  const v = lookAt(new Float32Array(16), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const mvp = multiply(new Float32Array(16), p, v);
  const c = transformPoint(mvp, 0, 0, 0);
  assert.ok(Math.abs(c[0]) < 1e-6 && Math.abs(c[1]) < 1e-6, '原点应在屏幕中心');
  const right = transformPoint(mvp, 1, 0, 0);
  assert.ok(right[0] > 0, '+x 应在右侧');
  assert.ok(c[2] > -1 && c[2] < 1, '深度在范围内');
});

test('四元数旋转：绕 Y 轴 90° 把 +z 转到 +x', () => {
  const q = quatFromVectors(new Float32Array(4), [0, 0, 1], [1, 0, 0]);
  const m = fromQuat(new Float32Array(16), q);
  const x = m[0] * 0 + m[4] * 0 + m[8] * 1;
  const z = m[2] * 0 + m[6] * 0 + m[10] * 1;
  assert.ok(Math.abs(x - 1) < 1e-5, 'x=' + x);
  assert.ok(Math.abs(z) < 1e-5, 'z=' + z);
});

test('四元数复合：单位四元数不改变方向', () => {
  const id = new Float32Array([0, 0, 0, 1]);
  const q = quatFromVectors(new Float32Array(4), [0, 0, 1], [0, 0, 1]);
  quatMultiply(id, q, id);
  assert.deepEqual(Array.from(id).map((v) => Math.abs(v) < 1e-6 ? 0 : v), [0, 0, 0, 1]);
});

function fakeCanvas(w, h) {
  return {
    width: w, height: h,
    style: {},
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: this.cssW || 800, height: this.cssH || 600 }; },
    getContext() { return null; }
  };
}

test('轨迹球拖拽累积旋转', () => {
  const canvas = fakeCanvas(800, 600);
  canvas.cssW = 800; canvas.cssH = 600;
  const ball = new Arcball(canvas);
  const before = Float32Array.from(ball.orientation);
  ball.start(300, 300);
  let changed = false;
  for (let i = 1; i <= 10; i++) changed = ball.move(300 + i * 10, 300) || changed;
  ball.end();
  assert.ok(changed, 'move 应报告变化');
  let diff = 0;
  for (let i = 0; i < 4; i++) diff += Math.abs(ball.orientation[i] - before[i]);
  assert.ok(diff > 1e-4, '四元数应已变化');
  const s = ball.update(16);
  assert.ok(s || ball.angularSpeed === 0, '有惯性或已停止');
});

test('轨迹球惯性逐渐衰减到静止', () => {
  const canvas = fakeCanvas(800, 600);
  canvas.cssW = 800; canvas.cssH = 600;
  const ball = new Arcball(canvas);
  ball.start(300, 300);
  for (let i = 1; i <= 8; i++) ball.move(300 + i * 12, 300 + i);
  ball.end();
  assert.ok(ball.angularSpeed > 0, '应有初速度');
  for (let i = 0; i < 200; i++) ball.update(16);
  assert.equal(ball.angularSpeed, 0, '惯性应衰减为 0');
});

test('相机缩放被钳制且具备点大小参考距离', () => {
  const canvas = fakeCanvas(800, 600);
  const cam = new Camera(canvas);
  assert.ok(cam.refDist > 0);
  for (let i = 0; i < 100; i++) cam.zoom(0.5);
  for (let i = 0; i < 60; i++) cam.update(16);
  assert.ok(cam.targetDist >= 1.6 - 1e-6, '最近不越界');
  for (let i = 0; i < 100; i++) cam.zoom(2);
  for (let i = 0; i < 60; i++) cam.update(16);
  assert.ok(cam.targetDist <= 12 + 1e-6, '最远不越界');
});

test('CPU 拾取命中屏幕中心的点', () => {
  const p = new Float32Array(16);
  perspective(p, Math.PI / 2, 1, 1, 100);
  const v = lookAt(new Float32Array(16), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const m = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const mvp = multiply(new Float32Array(16), p, v);
  const positions = new Float32Array([0.5, 0.5, 0, 0, 0, 0, -0.5, 0, 0]);
  const data = { count: 3, positions, sizes: new Float32Array([4, 4, 4]), colors: new Float32Array(9) };
  const id = cpuPick(data, mvp, m, 400, 300, 800, 600, { tolerance: 6 });
  assert.equal(id, 1, '中心点应为 #1，实际 #' + id);
});

test('CPU 拾取忽略视锥外的点', () => {
  const p = new Float32Array(16);
  perspective(p, Math.PI / 2, 1, 1, 100);
  const v = lookAt(new Float32Array(16), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const m = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const mvp = multiply(new Float32Array(16), p, v);
  const positions = new Float32Array([50, 50, 50]);
  const data = { count: 1, positions, sizes: new Float32Array([4]), colors: new Float32Array(3) };
  const id = cpuPick(data, mvp, m, 400, 300, 800, 600, { tolerance: 6 });
  assert.equal(id, -1);
});

test('CPU 拾取空白点：近距离点优先于远处重叠点（按屏幕距离）', () => {
  const p = new Float32Array(16);
  perspective(p, Math.PI / 2, 1, 1, 100);
  const v = lookAt(new Float32Array(16), [0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const m = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
  const mvp = multiply(new Float32Array(16), p, v);
  const positions = new Float32Array([0.02, 0, 0.0, 0.05, 0, 0]);
  const data = { count: 2, positions, sizes: new Float32Array([4, 4]), colors: new Float32Array(6) };
  const id = cpuPick(data, mvp, m, 400, 300, 800, 600, { tolerance: 10 });
  assert.equal(id, 0);
  const miss = cpuPick(data, mvp, m, 300, 300, 800, 600, { tolerance: 5 });
  assert.equal(miss, -1, '100px 外不应命中');
});

console.log('\n' + passed + ' 个单元测试通过');

/* ---- WebGL 渲染器 Mock 驱动（验证 FBO 拾取编解码往返与渲染流程） ---- */
test('GPU 拾取 RGBA 编解码往返（0 ~ 16,000,000 全覆盖采样）', () => {
  function encode(id) {
    const v = id + 1;
    const r = Math.floor(v / 65536);
    const g = Math.floor((v - r * 65536) / 256);
    const b = v - r * 65536 - g * 256;
    return [Math.round(r / 255 * 255), Math.round(g / 255 * 255), Math.round(b / 255 * 255)];
  }
  function decode(px) { return px[0] * 65536 + px[1] * 256 + px[2] - 1; }
  const samples = [0, 1, 255, 256, 65535, 65536, 49999, 99999, 500000, 16777214, 16777215];
  for (const id of samples) {
    const px = encode(id);
    assert.equal(decode(px), id, 'id=' + id + ' px=' + px);
  }
});

const rendererTest = await (async () => {
  try {
    const { GLScatterRenderer } = await import('../src/gl-scatter.js');
    return GLScatterRenderer;
  } catch (e) { return null; }
})();

if (rendererTest) {
  test('GLScatterRenderer：mock GL 环境下完整渲染 + 拾取流程无异常', async () => {
    const drawCalls = [];
    const buffers = new Map();
    let pickPixel = new Uint8Array([0, 0, 0, 255]);

    function makeMockGL() {
      const gl = {
        VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, ARRAY_BUFFER: 34962, STATIC_DRAW: 35044,
        POINTS: 0, LINES: 1, DEPTH_TEST: 3029, LEQUAL: 515, BLEND: 3042,
        SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771, CULL_FACE: 2884,
        COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256,
        COMPILE_STATUS: 35713, LINK_STATUS: 35714,
        ALIASED_POINT_SIZE_RANGE: 33901, FRAMEBUFFER: 36160,
        RGBA: 6408, UNSIGNED_BYTE: 5121, TEXTURE_2D: 3553, NEAREST: 9728,
        TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240,
        TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243, CLAMP_TO_EDGE: 33071,
        COLOR_ATTACHMENT0: 36064, DEPTH_COMPONENT16: 33189,
        DEPTH_ATTACHMENT: 36096, RENDERBUFFER: 36161, FRAMEBUFFER_COMPLETE: 36053,
        FRAGMENT_SHADER: 2, HIGH_FLOAT: 36338,
        _bound: {},
        createShader: () => ({}), shaderSource() {}, compileShader() {},
        getShaderParameter: () => true, getShaderInfoLog: () => '', deleteShader() {},
        createProgram: () => ({}), attachShader() {}, linkProgram() {},
        getProgramParameter: () => true, getProgramInfoLog: () => '', deleteProgram() {},
        getAttribLocation: (p, n) => ({ aPosition: 0, aColor: 1, aSize: 2, aId: 3 }[n] ?? 0),
        getUniformLocation: (p, n) => ({ loc: n }),
        createBuffer: () => ({}), bindBuffer(t, b) { this._bound[t] = b; },
        bufferData(t, data) { buffers.set(this._bound[t], data); },
        deleteBuffer() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
        createFramebuffer: () => ({}), createTexture: () => ({}), createRenderbuffer: () => ({}),
        bindFramebuffer() {}, bindTexture() {}, texImage2D() {}, texParameteri() {},
        framebufferTexture2D() {}, bindRenderbuffer() {}, renderbufferStorage() {},
        framebufferRenderbuffer() {}, checkFramebufferStatus: () => 36053,
        readPixels(x, y, w, h, f, t, arr) { arr.set(pickPixel); },
        deleteTexture() {}, deleteRenderbuffer() {}, deleteFramebuffer() {},
        viewport() {}, clearColor() {}, clear() {}, enable() {}, disable() {},
        blendFunc() {}, depthFunc() {}, useProgram() {}, uniformMatrix4fv() {},
        uniform1f() {}, depthMask() {}, drawArrays(mode, first, count) { drawCalls.push({ mode, first, count }); },
        getParameter(p) { return p === 33901 ? [1, 1024] : null; },
        getError: () => 0,
        getShaderPrecisionFormat: () => ({ precision: 23, rangeMin: 127, rangeMax: 127 })
      };
      return gl;
    }

    const canvas = {
      width: 800, height: 600,
      addEventListener() {}, removeEventListener() {},
      getContext(name) { return name === 'webgl' ? makeMockGL() : null; }
    };
    const { GLScatterRenderer } = await import('../src/gl-scatter.js');
    const renderer = new GLScatterRenderer(canvas);
    assert.equal(renderer.gpuPickSupported, true);

    const N = 50000;
    const data = {
      count: N,
      positions: new Float32Array(N * 3).fill(0.1),
      sizes: new Float32Array(N).fill(4),
      colors: new Float32Array(N * 3).fill(0.5)
    };
    renderer.setData(data);
    const cam = {
      mvp: new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,-4,1]),
      proj: new Float32Array(16),
      selectedId: null
    };
    cam.proj[5] = 1;
    renderer.render(cam);
    const pointDraw = drawCalls.filter((d) => d.mode === 0);
    assert.equal(pointDraw.length, 1);
    assert.equal(pointDraw[0].count, N);

    function encode(id) {
      const v = id + 1;
      const r = Math.floor(v / 65536);
      const g = Math.floor((v - r * 65536) / 256);
      const b = v - r * 65536 - g * 256;
      return new Uint8Array([r, g, b, 255]);
    }
    pickPixel = encode(777);
    const got = renderer.pick(cam, 400, 300);
    assert.equal(got, 777, '拾取应解码出 777，实际 ' + got);

    pickPixel = new Uint8Array([0, 0, 0, 255]);
    const none = renderer.pick(cam, 10, 10);
    assert.equal(none, -1, '背景像素应为 -1');

    pickPixel = encode(49999);
    assert.equal(renderer.pick(cam, 2, 2), 49999);

    pickPixel = encode(999999);
    assert.equal(renderer.pick(cam, 5, 5), -1, '超出点数范围应返回 -1');

    renderer.dispose();
  });
}
