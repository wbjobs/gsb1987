/* 应用入口：渲染调度、交互、拾取、异常降级 */

import { Camera } from './camera.js';
import { GLScatterRenderer } from './gl-scatter.js';
import { Canvas2DRenderer } from './canvas2d-renderer.js';
import { cpuPick } from './cpu-pick.js';

const DEFAULT_COUNT = 50000;

const els = {
  canvas: document.getElementById('glCanvas'),
  tooltip: document.getElementById('tooltip'),
  backend: document.getElementById('backend'),
  pointCount: document.getElementById('pointCount'),
  fps: document.getElementById('fps'),
  hovered: document.getElementById('hovered'),
  selected: document.getElementById('selected'),
  status: document.getElementById('status'),
  countInput: document.getElementById('countInput'),
  reloadBtn: document.getElementById('reloadBtn'),
  resetBtn: document.getElementById('resetBtn'),
  pickMode: document.getElementById('pickMode'),
  banner: document.getElementById('banner')
};

let renderer = null;
let rendererName = '';
let camera = null;
let dataset = null;
let worker = null;

let rafId = 0;
let needsRender = true;
let lastFrame = performance.now();
let fpsSmooth = 0;

let dragging = false;
let downX = 0, downY = 0, downT = 0, moved = false;
const activePointers = new Map();
let pinchStartDist = 0;
let pinchStartZoom = 0;

let hoverId = -1;
let lastPickKey = '';

function setStatus(text, isError) {
  els.status.textContent = text;
  els.status.classList.toggle('error', !!isError);
}

function showBanner(text) {
  els.banner.textContent = text;
  els.banner.classList.add('visible');
}

function setBackend(name, mode) {
  rendererName = name;
  els.backend.textContent = name + (mode ? ' · ' + mode : '');
}

const FORCE_2D = new URLSearchParams(location.search).get('force2d') === '1';

function createRenderer() {
  if (FORCE_2D) {
    const r0 = new Canvas2DRenderer(els.canvas);
    setBackend('Canvas 2D', 'CPU 拾取（force2d 手动降级）');
    return r0;
  }
  try {
    const r = new GLScatterRenderer(els.canvas);
    if (r.gpuPickSupported) {
      setBackend('WebGL', 'GPU 拾取');
    } else {
      setBackend('WebGL', 'CPU 拾取（设备不支持高精度着色器）');
    }
    r.onContextLost = () => {
      showBanner('WebGL 上下文丢失，已切换到 Canvas 2D 降级渲染');
      switchToCanvas2D('上下文丢失');
    };
    return r;
  } catch (err) {
    console.warn('WebGL 初始化失败，降级到 Canvas 2D：', err);
    return createFallback2D('当前浏览器不支持 WebGL 或着色器不可用，已自动降级到 Canvas 2D');
  }
}

function createFallback2D(bannerText) {
  replaceCanvas();
  let r2;
  try {
    r2 = new Canvas2DRenderer(els.canvas);
  } catch (err2) {
    setStatus('Canvas 2D 也不可用，请更换现代浏览器', true);
    throw err2;
  }
  setBackend('Canvas 2D', 'CPU 拾取（降级）');
  showBanner(bannerText);
  return r2;
}

function replaceCanvas() {
  const old = els.canvas;
  const fresh = document.createElement('canvas');
  fresh.id = 'glCanvas';
  old.parentNode.replaceChild(fresh, old);
  els.canvas = fresh;
}

function switchToCanvas2D(reason) {
  if (rendererName === 'Canvas 2D') return;
  const oldData = dataset;
  try { renderer && renderer.dispose(); } catch (e) { /* noop */ }
  replaceCanvas();
  camera = new Camera(els.canvas);
  camera.selectedId = null;
  bindEvents();
  els.canvas.style.cursor = 'grab';
  let renderer2d;
  try {
    renderer2d = new Canvas2DRenderer(els.canvas);
  } catch (err) {
    setStatus('2D 降级也不可用：' + err.message, true);
    return;
  }
  renderer = renderer2d;
  setBackend('Canvas 2D', 'CPU 拾取（' + reason + ' 降级）');
  applyCanvasSize();
  if (oldData) {
    renderer.setData(oldData);
    needsRender = true;
  }
}

function applyCanvasSize() {
  const rect = els.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.resize(rect.width, rect.height);
  if (camera) camera.updateProjection();
  needsRender = true;
}

function adoptData(raw) {
  dataset = {
    count: raw.count,
    positions: new Float32Array(raw.positions),
    sizes: new Float32Array(raw.sizes),
    colors: new Float32Array(raw.colors)
  };
  renderer.setData(dataset);
  els.pointCount.textContent = raw.count.toLocaleString();
  applyCanvasSize();
  needsRender = true;
}

function loadData(count) {
  setStatus('Worker 正在生成 ' + count.toLocaleString() + ' 个点…');
  if (worker) {
    try { worker.terminate(); } catch (e) { /* noop */ }
  }
  let useWorker = typeof window.Worker === 'function';
  if (useWorker) {
    try {
      worker = new Worker('src/worker.js');
    } catch (e) {
      useWorker = false;
      worker = null;
    }
  }
  if (!useWorker) {
    generateOnMainThread(count);
    return;
  }
  const timer = setTimeout(() => {
    setStatus('Worker 响应较慢，继续等待…');
  }, 4000);
  worker.onmessage = (event) => {
    clearTimeout(timer);
    const msg = event.data;
    if (msg.type === 'data') {
      adoptData(msg);
      setStatus('就绪 · Worker 数据生成耗时 ' + msg.elapsed + ' ms');
    } else if (msg.type === 'error') {
      setStatus('Worker 出错，已在主线程降级：' + msg.message, true);
      generateOnMainThread(count);
    }
  };
  worker.onerror = (err) => {
    clearTimeout(timer);
    setStatus('Worker 不可用（' + (err.message || '加载失败') + '），主线程降级', true);
    worker = null;
    generateOnMainThread(count);
  };
  worker.postMessage({ type: 'generate', count: count, seed: Date.now() & 0xffffff });
}

function generateOnMainThread(count) {
  setStatus('主线程生成数据（Worker 不可用）…');
  const started = performance.now();
  setTimeout(() => {
    try {
      const data = window.ScatterData.generate(count, Date.now() & 0xffffff);
      adoptData({
        count: data.count,
        positions: data.positions.buffer,
        sizes: data.sizes.buffer,
        colors: data.colors.buffer
      });
      setStatus('就绪 · 主线程生成耗时 ' + Math.round(performance.now() - started) + ' ms');
    } catch (err) {
      setStatus('数据生成失败：' + err.message, true);
    }
  }, 16);
}

function performPick(clientX, clientY) {
  if (!dataset) return -1;
  const rect = els.canvas.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return -1;
  let id = -1;
  try {
    if (rendererName === 'WebGL' && renderer.gpuPickSupported) {
      id = renderer.pick(camera, x, y);
      if (id < 0) {
        id = cpuPick(dataset, camera.mvp, camera.model, x, y, rect.width, rect.height,
          { tolerance: 3 });
      }
    } else {
      id = cpuPick(dataset, camera.mvp, camera.model, x, y, rect.width, rect.height,
        { tolerance: 8 });
    }
  } catch (err) {
    console.warn('拾取异常，使用 CPU 降级：', err);
    if (rendererName === 'WebGL') renderer.gpuPickSupported = false;
    id = cpuPick(dataset, camera.mvp, camera.model, x, y, rect.width, rect.height,
      { tolerance: 8 });
  }
  return id;
}

function showTooltip(id, clientX, clientY) {
  if (id == null || id < 0) {
    els.tooltip.classList.remove('visible');
    els.hovered.textContent = '—';
    return;
  }
  const p = dataset.positions;
  const x = p[id * 3], y = p[id * 3 + 1], z = p[id * 3 + 2];
  els.tooltip.innerHTML =
    '<b>#' + id + '</b><br>' +
    'x ' + x.toFixed(3) + '<br>' +
    'y ' + y.toFixed(3) + '<br>' +
    'z ' + z.toFixed(3);
  els.tooltip.style.left = Math.min(window.innerWidth - 130, clientX + 14) + 'px';
  els.tooltip.style.top = Math.min(window.innerHeight - 110, clientY + 14) + 'px';
  els.tooltip.classList.add('visible');
  els.hovered.textContent = '#' + id;
}

function pickAt(clientX, clientY, force) {
  const rect = els.canvas.getBoundingClientRect();
  const qx = Math.round(clientX - rect.left);
  const qy = Math.round(clientY - rect.top);
  const moving = camera.arcball.active || Math.abs(camera.targetDist - camera.distance) > 0.01;
  const q = camera.arcball.orientation;
  const poseKey = q[0].toFixed(3) + ',' + q[1].toFixed(3) + ',' +
    q[2].toFixed(3) + ',' + q[3].toFixed(3) + ',' + camera.distance.toFixed(3);
  const key = qx + ':' + qy + ':' + (moving ? 'm' : 's') + ':' + poseKey + ':' + camera.selectedId;
  if (!force && key === lastPickKey) return;
  lastPickKey = key;
  const id = performPick(clientX, clientY);
  hoverId = id;
  els.canvas.style.cursor = id >= 0 ? 'pointer' : (dragging ? 'grabbing' : 'grab');
  showTooltip(id, clientX, clientY);
}

function hideHover() {
  hoverId = -1;
  lastPickKey = '';
  els.tooltip.classList.remove('visible');
  els.hovered.textContent = '—';
  els.canvas.style.cursor = dragging ? 'grabbing' : 'grab';
}

function pointerDistance() {
  const pts = Array.from(activePointers.values());
  if (pts.length < 2) return 0;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

function bindEvents() {
  const canvas = els.canvas;

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ }
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 2) {
      pinchStartDist = pointerDistance();
      pinchStartZoom = camera.targetDist;
      camera.arcball.end();
    } else if (activePointers.size === 1) {
      dragging = true;
      moved = false;
      downX = e.clientX;
      downY = e.clientY;
      downT = performance.now();
      camera.arcball.start(e.clientX, e.clientY);
    }
    hideHover();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (activePointers.has(e.pointerId)) {
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (activePointers.size === 2) {
      const d = pointerDistance();
      if (pinchStartDist > 0) {
        camera.targetDist = Math.max(1.6, Math.min(12,
          pinchStartZoom * (pinchStartDist / Math.max(1, d))));
      }
      needsRender = true;
      return;
    }
    if (dragging && activePointers.size === 1) {
      const changed = camera.arcball.move(e.clientX, e.clientY);
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
      if (changed) {
        needsRender = true;
        hideHover();
      }
    } else if (activePointers.size === 0) {
      lastClientX = e.clientX;
      lastClientY = e.clientY;
      pointerInside = true;
      pickAt(e.clientX, e.clientY, false);
    }
  });

  const endPointer = (e) => {
    const wasDragging = dragging;
    const wasMoved = moved;
    const upX = e.clientX != null ? e.clientX : lastClientX;
    const upY = e.clientY != null ? e.clientY : lastClientY;
    activePointers.delete(e.pointerId);
    if (activePointers.size < 2) pinchStartDist = 0;
    if (activePointers.size === 1 && wasDragging) {
      const remaining = Array.from(activePointers.values())[0];
      camera.arcball.start(remaining.x, remaining.y);
      moved = true;
      return;
    }
    if (activePointers.size === 0 && wasDragging) {
      dragging = false;
      camera.arcball.end();
      canvas.style.cursor = 'grab';
      if (!wasMoved && performance.now() - downT < 500) {
        const id = performPick(upX, upY);
        camera.selectedId = id >= 0 ? id : null;
        els.selected.textContent = camera.selectedId == null ? '—' : '#' + camera.selectedId;
        showTooltip(id, upX, upY);
        needsRender = true;
      }
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('pointerleave', () => {
    if (!dragging && activePointers.size === 0) {
      pointerInside = false;
      hideHover();
    }
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0012);
    camera.zoom(factor);
    needsRender = true;
  }, { passive: false });

  canvas.addEventListener('dblclick', () => {
    camera.reset();
    camera.selectedId = null;
    els.selected.textContent = '—';
    needsRender = true;
  });

  els.reloadBtn.addEventListener('click', () => {
    const n = Math.max(100, Math.min(2000000, parseInt(els.countInput.value, 10) || DEFAULT_COUNT));
    camera.selectedId = null;
    els.selected.textContent = '—';
    loadData(n);
  });
  els.resetBtn.addEventListener('click', () => {
    camera.reset();
    camera.selectedId = null;
    els.selected.textContent = '—';
    needsRender = true;
  });
}

function bindWindowEvents() {
  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      applyCanvasSize();
    }, 80);
  });
}

let lastClientX = 0, lastClientY = 0, pointerInside = false;

function frame(now) {
  rafId = requestAnimationFrame(frame);
  const dt = Math.min(64, now - lastFrame);
  lastFrame = now;

  const moving = camera.update(dt);
  if (moving) needsRender = true;

  if (needsRender && dataset) {
    try {
      renderer.render(camera);
    } catch (err) {
      console.warn('渲染异常：', err);
      if (rendererName === 'WebGL') {
        showBanner('WebGL 渲染出错，已切换到 Canvas 2D 降级');
        switchToCanvas2D('渲染异常');
        try { renderer.render(camera); } catch (e2) { setStatus('降级渲染失败：' + e2.message, true); }
      } else {
        setStatus('渲染失败：' + err.message, true);
      }
    }
    needsRender = false;
  }

  const activelyDragging = camera.arcball.active;
  if (pointerInside && !activelyDragging && moving) {
    pickAt(lastClientX, lastClientY, false);
  }

  const fps = 1000 / Math.max(1, dt);
  fpsSmooth = fpsSmooth ? fpsSmooth * 0.92 + fps * 0.08 : fps;
  els.fps.textContent = Math.round(fpsSmooth);
}

document.addEventListener('mousemove', (e) => {
  lastClientX = e.clientX;
  lastClientY = e.clientY;
  const rect = els.canvas.getBoundingClientRect();
  pointerInside = e.clientX >= rect.left && e.clientX <= rect.right &&
    e.clientY >= rect.top && e.clientY <= rect.bottom;
});

function init() {
  try {
    renderer = createRenderer();
  } catch (err) {
    console.error(err);
    return;
  }
  camera = new Camera(els.canvas);
  window.__scatter = {
    pick: (clientX, clientY) => performPick(clientX, clientY),
    getCamera: () => camera,
    getRenderer: () => renderer,
    getDataset: () => dataset,
    getBackend: () => rendererName,
    reload: (n) => loadData(n)
  };
  els.canvas.style.cursor = 'grab';
  bindEvents();
  bindWindowEvents();
  applyCanvasSize();
  loadData(DEFAULT_COUNT);
  rafId = requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
