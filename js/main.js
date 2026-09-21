/* 主控：渲染循环、交互、拾取调度、性能自适应、异常降级 */
'use strict';

(function () {
  const POINT_COUNT = 100000;
  const FOV = Math.PI / 4;
  const canvas = document.getElementById('view');
  const statsEl = document.getElementById('stats');
  const tooltip = document.getElementById('tooltip');
  const fatalEl = document.getElementById('fatal');

  const state = {
    yaw: 0.6, pitch: 0.35, dist: 320,
    vyaw: 0, vpitch: 0,            // 惯性角速度
    dragging: false, moved: false,
    lastX: 0, lastY: 0,
    highlightId: -1,
    pointSize: 3,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    positions: null, colors: null,
    dirty: true,
    fps: 60, frames: 0, fpsTime: 0,
    degraded: 0,                   // 0=正常 1=降pixelRatio 2=再降点尺寸
    pickSeq: 0, pickPending: false,
  };

  let renderer = null;
  let worker = null;               // null 表示主线程降级
  let using2D = false;

  function fatal(msg) {
    fatalEl.hidden = false;
    document.getElementById('fatal-msg').textContent = msg;
    statsEl.textContent = '初始化失败';
  }

  /* ---------- Worker 管理（含降级） ---------- */
  function initWorker() {
    return new Promise((resolve) => {
      let w;
      try { w = new Worker('js/worker.js'); } catch (e) { return resolve(null); }
      const timer = setTimeout(() => { w.terminate(); resolve(null); }, 8000);
      w.onmessage = (e) => {
        if (e.data.type === 'generated') {
          clearTimeout(timer);
          resolve(w);
          onGenerated(e.data);
        } else if (e.data.type === 'picked') {
          onPicked(e.data);
        } else if (e.data.type === 'error') {
          console.warn('Worker 错误:', e.data.message);
        }
      };
      w.onerror = () => { clearTimeout(timer); try { w.terminate(); } catch (_) {} resolve(null); };
      w.postMessage({ type: 'generate', count: POINT_COUNT });
    });
  }

  function generateOnMainThread() {
    // Worker 不可用：主线程分片生成，避免长时间阻塞
    return new Promise((resolve) => {
      setTimeout(() => {
        const data = PointCloudEngine.generate(POINT_COUNT);
        onGenerated(data);
        resolve(null);
      }, 30);
    });
  }

  function onGenerated(data) {
    state.positions = data.positions;
    state.colors = data.colors;
    renderer.setData(data.positions, data.colors);
    if (worker) {
      const copy = new Float32Array(data.positions); // Worker 内保留一份用于拾取
      worker.postMessage({ type: 'setPositions', positions: copy }, [copy.buffer]);
    }
    state.dirty = true;
  }

  /* ---------- 拾取 ---------- */
  function computeMVP() {
    const aspect = canvas.width / Math.max(canvas.height, 1);
    const proj = Mat4.perspective(FOV, aspect, 1, 2000);
    const view = Mat4.orbit(state.yaw, state.pitch, state.dist);
    return Mat4.multiply(proj, view);
  }

  function requestPick(clientX, clientY) {
    if (!state.positions) return;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    const mvp = computeMVP();
    let id = -2;
    try {
      id = renderer.pick(mvp, state.pointSize * state.pixelRatio, x, y, state.pixelRatio);
    } catch (e) {
      console.warn('GPU 拾取异常，转 CPU 拾取:', e);
      id = -2;
    }
    if (id >= -1) { onPicked({ id, x: clientX, y: clientY }); return; }
    // CPU 拾取（Worker 优先）
    if (worker && !state.pickPending) {
      state.pickPending = true;
      state._pickXY = { x: clientX, y: clientY };
      worker.postMessage({
        type: 'pick', seq: ++state.pickSeq, mvp,
        x, y, width: rect.width, height: rect.height, radius: 8,
      });
    } else if (!worker) {
      const hit = PointCloudEngine.pick(state.positions, mvp, x, y, rect.width, rect.height, 8);
      onPicked({ id: hit, x: clientX, y: clientY });
    }
  }

  function onPicked(data) {
    state.pickPending = false;
    const cx = data.x != null ? data.x : (state._pickXY && state._pickXY.x) || 0;
    const cy = data.y != null ? data.y : (state._pickXY && state._pickXY.y) || 0;
    state.highlightId = data.id;
    state.dirty = true;
    if (data.id >= 0) {
      const p = state.positions, i = data.id * 3;
      tooltip.innerHTML =
        `<b>#${data.id}</b>  x: ${p[i].toFixed(2)}  y: ${p[i+1].toFixed(2)}  z: ${p[i+2].toFixed(2)}`;
      tooltip.style.left = cx + 'px';
      tooltip.style.top = cy + 'px';
      tooltip.hidden = false;
    } else {
      tooltip.hidden = true;
    }
  }

  /* ---------- 交互 ---------- */
  function bindEvents() {
    const pointers = new Map();
    let pinchDist = 0;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      state.dragging = true; state.moved = false;
      state.lastX = e.clientX; state.lastY = e.clientY;
      state.vyaw = state.vpitch = 0;
      canvas.classList.add('dragging');
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinchDist > 0) {
          state.dist = clamp(state.dist * pinchDist / d, 80, 900);
          state.dirty = true;
        }
        pinchDist = d;
        return;
      }
      const dx = e.clientX - state.lastX, dy = e.clientY - state.lastY;
      state.lastX = e.clientX; state.lastY = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 2) state.moved = true;
      const k = 0.005;
      state.yaw += dx * k;
      state.pitch = clamp(state.pitch + dy * k, -1.5, 1.5);
      state.vyaw = dx * k; state.vpitch = dy * k;
      state.dirty = true;
    });

    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        state.dragging = false;
        canvas.classList.remove('dragging');
        if (!state.moved) requestPick(e.clientX, e.clientY); // 点击 -> 拾取
      }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      state.dist = clamp(state.dist * (1 + Math.sign(e.deltaY) * 0.1), 80, 900);
      state.dirty = true;
    }, { passive: false });

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      statsEl.textContent = 'WebGL 上下文丢失，等待恢复…';
    });
    canvas.addEventListener('webglcontextrestored', () => {
      try {
        renderer = new ScatterRenderer(canvas);
        if (state.positions) renderer.setData(state.positions, state.colors);
        state.dirty = true;
      } catch (err) { switchTo2D(); }
    });

    window.addEventListener('resize', () => { state.dirty = true; });
  }

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  /* ---------- 渲染循环 + 性能自适应 ---------- */
  function frame(t) {
    requestAnimationFrame(frame);
    // 惯性
    if (!state.dragging && (Math.abs(state.vyaw) > 1e-4 || Math.abs(state.vpitch) > 1e-4)) {
      state.yaw += state.vyaw;
      state.pitch = clamp(state.pitch + state.vpitch, -1.5, 1.5);
      state.vyaw *= 0.95; state.vpitch *= 0.95;
      state.dirty = true;
    }
    // FPS 统计
    state.frames++;
    if (t - state.fpsTime >= 1000) {
      state.fps = state.frames * 1000 / (t - state.fpsTime);
      state.frames = 0; state.fpsTime = t;
      adaptQuality();
      updateStats();
    }
    if (!state.dirty) return;
    state.dirty = false;
    const w = Math.round(canvas.clientWidth * state.pixelRatio);
    const h = Math.round(canvas.clientHeight * state.pixelRatio);
    if (w === 0 || h === 0) return;
    renderer.resize(w, h);
    try {
      renderer.render(computeMVP(), state.pointSize * state.pixelRatio, state.highlightId);
    } catch (e) {
      console.error('渲染异常:', e);
      if (!using2D) switchTo2D();
    }
  }

  function adaptQuality() {
    if (state.fps < 30 && state.degraded === 0) {
      state.degraded = 1;
      state.pixelRatio = 1;
      state.dirty = true;
    } else if (state.fps < 24 && state.degraded === 1) {
      state.degraded = 2;
      state.pointSize = 2;
      state.dirty = true;
    }
  }

  function updateStats() {
    const mode = using2D ? 'Canvas2D(降级)' : (renderer.pickSupported ? 'WebGL+GPU拾取' : 'WebGL+CPU拾取');
    statsEl.textContent =
      `${mode} | ${state.positions ? state.positions.length / 3 : 0} 点 | ` +
      `${state.fps.toFixed(0)} FPS | DPR ${state.pixelRatio}` +
      (worker ? '' : ' | 无Worker');
  }

  function switchTo2D() {
    if (using2D) return;
    using2D = true;
    try { renderer && renderer.dispose(); } catch (_) {}
    try {
      renderer = new Fallback2DRenderer(canvas);
      if (state.positions) renderer.setData(state.positions, state.colors);
      state.dirty = true;
    } catch (e) {
      fatal('WebGL 与 Canvas 2D 均不可用：' + e.message);
    }
  }

  /* ---------- 启动 ---------- */
  async function start() {
    try {
      renderer = new ScatterRenderer(canvas);
    } catch (e) {
      console.warn('WebGL 初始化失败，降级 Canvas 2D:', e);
      switchTo2D();
    }
    if (!renderer) return;
    bindEvents();
    const w = await initWorker();
    if (w) worker = w;
    else await generateOnMainThread();
    updateStats();
    requestAnimationFrame((t) => { state.fpsTime = t; requestAnimationFrame(frame); });
  }

  start();
})();
