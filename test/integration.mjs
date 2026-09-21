/* 最小 DOM/WebGL stub 下驱动 src/main.js 的真实集成路径 */

const elements = {};
function makeEl(id) {
  const el = {
    id, textContent: '', innerHTML: '', style: {}, value: '50000',
    classList: { _set: new Set(), add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); }, toggle(c, f) { f ? this._set.add(c) : this._set.delete(c); }, contains(c) { return this._set.has(c); } },
    listeners: {},
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent(ev) {
      const list = this.listeners[ev.type] || [];
      for (const fn of list.slice()) fn(ev);
      return true;
    },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    setPointerCapture() {},
    parentNode: { replaceChild() {} }
  };
  elements[id] = el;
  return el;
}

const canvas = makeEl('glCanvas');
canvas.width = 800; canvas.height = 600;
['tooltip','backend','pointCount','fps','hovered','selected','status','countInput','reloadBtn','resetBtn','pickMode','banner'].forEach(makeEl);

let rafQueue = [];
globalThis.performance = { now: () => Date.now() };
let nextFrame = 1;
globalThis.requestAnimationFrame = (fn) => { const id = nextFrame++; rafQueue.push({ id, fn }); return id; };
globalThis.cancelAnimationFrame = (id) => { rafQueue = rafQueue.filter((f) => f.id !== id); };
async function pump(frames = 5) {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue;
    rafQueue = [];
    const now = performance.now() + 16;
    for (const { fn } of q) fn(now);
    await new Promise((r) => setTimeout(r, 0));
  }
}

function makePointerEvent(type, x, y, pointerId) {
  return { type, clientX: x, clientY: y, pointerId: pointerId ?? 1, pointerType: 'mouse', preventDefault() {} };
}

/* ---- Mock WebGL（含可配置拾取像素）---- */
let pickPixelValue = new Uint8Array([0, 0, 0, 255]);
function installWebGLMock() {
  canvas.getContext = (name) => {
    if (name !== 'webgl' && name !== 'experimental-webgl') return null;
    return makeGL();
  };
}
function makeGL() {
  const programs = new Set();
  return {
    VERTEX_SHADER:1, FRAGMENT_SHADER:2, ARRAY_BUFFER:34962, STATIC_DRAW:35044,
    POINTS:0, LINES:1, DEPTH_TEST:3029, LEQUAL:515, BLEND:3042, SRC_ALPHA:770,
    ONE_MINUS_SRC_ALPHA:771, CULL_FACE:2884, COLOR_BUFFER_BIT:16384, DEPTH_BUFFER_BIT:256,
    COMPILE_STATUS:35713, LINK_STATUS:35714, ALIASED_POINT_SIZE_RANGE:33901,
    FRAMEBUFFER:36160, RGBA:6408, UNSIGNED_BYTE:5121, TEXTURE_2D:3553, NEAREST:9728,
    TEXTURE_MIN_FILTER:10241, TEXTURE_MAG_FILTER:10240, TEXTURE_WRAP_S:10242,
    TEXTURE_WRAP_T:10243, CLAMP_TO_EDGE:33071, COLOR_ATTACHMENT0:36064,
    DEPTH_COMPONENT16:33189, DEPTH_ATTACHMENT:36096, RENDERBUFFER:36161,
    FRAMEBUFFER_COMPLETE:36053, FRAGMENT_SHADER:2, HIGH_FLOAT:36338,
    createShader:()=>({}), shaderSource(){}, compileShader(){}, getShaderParameter:()=>true,
    getShaderInfoLog:()=>'', deleteShader(){},
    createProgram:()=>{ const p={}; programs.add(p); return p; },
    attachShader(){}, linkProgram(){}, getProgramParameter:(p,k)=> k===35714 ? true : true,
    getProgramInfoLog:()=>'', deleteProgram(p){ programs.delete(p); },
    getAttribLocation:(p,n)=>({aPosition:0,aColor:1,aSize:2,aId:3}[n]??0),
    getUniformLocation:(p,n)=>({loc:n}),
    createBuffer:()=>({}), bindBuffer(){}, bufferData(){}, deleteBuffer(){},
    enableVertexAttribArray(){}, vertexAttribPointer(){},
    createFramebuffer:()=>({}), createTexture:()=>({}), createRenderbuffer:()=>({}),
    bindFramebuffer(){}, bindTexture(){}, texImage2D(){}, texParameteri(){},
    framebufferTexture2D(){}, bindRenderbuffer(){}, renderbufferStorage(){},
    framebufferRenderbuffer(){}, checkFramebufferStatus:()=>36053,
    readPixels(x,y,w,h,f,t,arr){ arr.set(pickPixelValue); },
    deleteTexture(){}, deleteRenderbuffer(){}, deleteFramebuffer(){},
    viewport(){}, clearColor(){}, clear(){}, enable(){}, disable(){}, blendFunc(){},
    depthFunc(){}, useProgram(){}, uniformMatrix4fv(){}, uniform1f(){}, depthMask(){},
    drawArrays(){}, getParameter:(p)=> p===33901 ? [1,256] : null, getError:()=>0,
    getShaderPrecisionFormat:()=>({precision:23,rangeMin:127,rangeMax:127})
  };
}

globalThis.document = {
  readyState: 'complete',
  getElementById: (id) => elements[id],
  createElement: (tag) => {
    const el = makeEl('created-' + Math.random());
    el.tagName = tag;
    if (tag === 'canvas') {
      el.width = 300; el.height = 150;
      el.getContext = (name) => name === '2d' ? make2DContext() : null;
    }
    return el;
  },
  addEventListener() {}
};
function make2DContext() {
  return new Proxy({}, { get: (t, p) => {
    if (p === 'canvas') return canvas;
    if (p === 'measureText') return () => ({ width: 0 });
    return typeof p === 'string' ? () => {} : undefined;
  }, set: () => true });
}
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;
globalThis.Worker = undefined;
globalThis.addEventListener = () => {};
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.Worker = undefined;

/* data.js 先挂到 window（主线程降级路径）*/
await import(new URL('../src/data.js', import.meta.url).href.replace('file://', ''));

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('PASS  ' + name);
  else { failures++; console.error('FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
}

/* data.js 的 UMD 会挂到 globalThis.ScatterData */
check('data.js UMD 全局可用', typeof globalThis.ScatterData?.generate === 'function');

installWebGLMock();
await import(new URL('../src/main.js', import.meta.url).href.replace('file://', ''));
await pump(3);

check('初始化后暴露测试钩子', !!globalThis.__scatter);
check('后端识别为 WebGL', globalThis.__scatter.getBackend() === 'WebGL', globalThis.__scatter.getBackend());

/* 等待主线程降级生成（Worker 在 stub 中不可用）*/
let ready = false;
for (let i = 0; i < 60; i++) {
  await pump(2);
  if (globalThis.__scatter.getDataset() && globalThis.__scatter.getDataset().count === 50000) { ready = true; break; }
}
check('Worker 不可用时主线程降级生成 50000 点', ready);
check('点数面板更新', elements.pointCount.textContent === '50,000', elements.pointCount.textContent);
check('状态包含降级说明', /Worker|就绪/.test(elements.status.textContent), elements.status.textContent);

/* 交互：按下-拖动-抬起 */
const cam0 = Array.from(globalThis.__scatter.getCamera().arcball.orientation).join(',');
canvas.dispatchEvent(makePointerEvent('pointerdown', 300, 300));
for (let i = 1; i <= 10; i++) {
  canvas.dispatchEvent(makePointerEvent('pointermove', 300 + i * 12, 300 + i));
}
await pump(3);
const cam1 = Array.from(globalThis.__scatter.getCamera().arcball.orientation).join(',');
check('拖拽产生旋转', cam0 !== cam1);
canvas.dispatchEvent(makePointerEvent('pointerup', 420, 310));
const spd0 = globalThis.__scatter.getCamera().arcball.angularSpeed;
check('松手有惯性速度', spd0 > 0, spd0 + '');

/* 惯性按真实流逝时间衰减：累计推进约 8 秒 */
for (let i = 0; i < 500; i++) {
  await new Promise((r) => setTimeout(r, 16));
  await pump(1);
  if (globalThis.__scatter.getCamera().arcball.angularSpeed === 0) break;
}
check('惯性最终停止', globalThis.__scatter.getCamera().arcball.angularSpeed === 0);

/* 缩放 */
const distBefore = globalThis.__scatter.getCamera().targetDist;
canvas.dispatchEvent({ type: 'wheel', deltaY: -300, preventDefault() {} });
await pump(4);
check('滚轮拉近', globalThis.__scatter.getCamera().targetDist < distBefore);

/* 单击选中（GPU 像素设为点 #1234）*/
function encodeId(id) {
  const v = id + 1;
  const r = Math.floor(v / 65536);
  const g = Math.floor((v - r * 65536) / 256);
  const b = v - r * 65536 - g * 256;
  return new Uint8Array([r, g, b, 255]);
}
pickPixelValue = encodeId(1234);
canvas.dispatchEvent(makePointerEvent('pointerdown', 400, 300));
canvas.dispatchEvent(makePointerEvent('pointerup', 400, 300));
check('单击 GPU 拾取选中 #1234', globalThis.__scatter.getCamera().selectedId === 1234,
  String(globalThis.__scatter.getCamera().selectedId));
check('选中面板更新', elements.selected.textContent === '#1234', elements.selected.textContent);

/* 悬停 tooltip */
canvas.dispatchEvent(makePointerEvent('pointermove', 401, 301));
check('悬停显示 tooltip 且含点号', elements.tooltip.classList.contains('visible') && /#1234/.test(elements.tooltip.innerHTML),
  elements.tooltip.innerHTML.slice(0, 40));

/* GPU 像素为背景时悬落空 */
pickPixelValue = new Uint8Array([0, 0, 0, 255]);
canvas.dispatchEvent(makePointerEvent('pointermove', 5, 5));
check('背景像素悬落空', elements.hovered.textContent === '—', elements.hovered.textContent);

/* 双击重置 */
canvas.dispatchEvent({ type: 'dblclick' });
check('双击清除选中', globalThis.__scatter.getCamera().selectedId === null);

/* 2D 降级路径：直接构造 Canvas2DRenderer 跑渲染 + 拾取（与 force2d 同一代码路径）*/
const { Canvas2DRenderer } = await import(new URL('../src/canvas2d-renderer.js', import.meta.url).href.replace('file://', ''));
const { Camera } = await import(new URL('../src/camera.js', import.meta.url).href.replace('file://', ''));
const data500 = globalThis.ScatterData.generate(500, 7);
const canvas2 = document.createElement('canvas');
canvas2.width = 800; canvas2.height = 600;
const renderer2d = new Canvas2DRenderer(canvas2);
renderer2d.resize(800, 600);
renderer2d.setData(data500);
const cam2 = new Camera(canvas2);
cam2.updateProjection();
cam2.updateMatrices();
let render2dOk = true;
try { renderer2d.render(cam2); } catch (e) { render2dOk = false; console.error(e); }
check('Canvas2D 降级渲染不抛异常', render2dOk);
const pid = renderer2d.pick(cam2, 400, 300);
check('Canvas2D CPU 拾取返回合法索引', pid >= -1 && pid < 500, String(pid));
check('Canvas2D 大数据跨步采样（100k 点）', (() => {
  const big = globalThis.ScatterData.generate(100000, 9);
  const c3 = document.createElement('canvas'); c3.width = 800; c3.height = 600;
  const r3 = new Canvas2DRenderer(c3);
  r3.resize(800, 600);
  r3.setData(big);
  r3.render(cam2);
  return r3.stride >= 1;
})());

process.exit(failures ? 1 : 0);
