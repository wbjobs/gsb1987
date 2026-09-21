/* 手写 WebGL 3D 散点渲染器（WebGL1 兼容，含 GPU 编码拾取） */

const POINT_VS = [
  'attribute vec3 aPosition;',
  'attribute vec3 aColor;',
  'attribute float aSize;',
  'attribute float aId;',
  'uniform mat4 uMVP;',
  'uniform float uPointScale;',
  'uniform float uSizeBoost;',
  'uniform float uMaxSize;',
  'uniform float uSelectedId;',
  'varying vec3 vColor;',
  'varying float vSelected;',
  'void main() {',
  '  vec4 clip = uMVP * vec4(aPosition, 1.0);',
  '  gl_Position = clip;',
  '  float s = aSize * uPointScale * (1.0 / clamp(clip.w, 0.05, 100.0)) + uSizeBoost;',
  '  if (abs(aId - uSelectedId) < 0.5) { s *= 1.8; vSelected = 1.0; } else { vSelected = 0.0; }',
  '  gl_PointSize = clamp(s, 1.0, uMaxSize);',
  '  vColor = aColor;',
  '}'
].join('\n');

const POINT_FS = [
  'precision highp float;',
  'varying vec3 vColor;',
  'varying float vSelected;',
  'void main() {',
  '  vec2 uv = gl_PointCoord - vec2(0.5);',
  '  float d2 = dot(uv, uv);',
  '  float alpha = 1.0 - smoothstep(0.10, 0.25, d2);',
  '  if (alpha <= 0.01) discard;',
  '  vec3 col = mix(vColor, vec3(1.0), vSelected * 0.65);',
  '  gl_FragColor = vec4(col, alpha);',
  '}'
].join('\n');

const PICK_VS = [
  'attribute vec3 aPosition;',
  'attribute float aSize;',
  'attribute float aId;',
  'uniform mat4 uMVP;',
  'uniform float uPointScale;',
  'uniform float uSizeBoost;',
  'uniform float uMaxSize;',
  'varying float vId;',
  'void main() {',
  '  vec4 clip = uMVP * vec4(aPosition, 1.0);',
  '  gl_Position = clip;',
  '  float s = aSize * uPointScale * (1.0 / clamp(clip.w, 0.05, 100.0)) + uSizeBoost;',
  '  gl_PointSize = clamp(s + 3.0, 1.0, uMaxSize);',
  '  vId = aId;',
  '}'
].join('\n');

const PICK_FS = [
  'precision highp float;',
  'varying highp float vId;',
  'void main() {',
  '  vec2 uv = gl_PointCoord - vec2(0.5);',
  '  if (dot(uv, uv) > 0.25) discard;',
  '  float id = vId + 1.0;',
  '  float r = floor(id / 65536.0);',
  '  float g = floor((id - r * 65536.0) / 256.0);',
  '  float b = id - r * 65536.0 - g * 256.0;',
  '  gl_FragColor = vec4(r / 255.0, g / 255.0, b / 255.0, 1.0);',
  '}'
].join('\n');

const LINE_VS = [
  'attribute vec3 aPosition;',
  'attribute vec3 aColor;',
  'uniform mat4 uMVP;',
  'varying vec3 vColor;',
  'void main() {',
  '  gl_Position = uMVP * vec4(aPosition, 1.0);',
  '  vColor = aColor;',
  '}'
].join('\n');

const LINE_FS = [
  'precision mediump float;',
  'varying vec3 vColor;',
  'void main() { gl_FragColor = vec4(vColor, 1.0); }'
].join('\n');

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const err = new Error('着色器编译失败: ' + log);
    err.glLog = log;
    throw err;
  }
  return shader;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    const err = new Error('着色器链接失败: ' + log);
    err.glLog = log;
    throw err;
  }
  return program;
}

function getContext(canvas) {
  const options = {
    antialias: true,
    alpha: false,
    depth: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance'
  };
  let gl = canvas.getContext('webgl', options) ||
    canvas.getContext('experimental-webgl', options);
  if (!gl) {
    gl = canvas.getContext('webgl', { antialias: false, depth: true }) ||
      canvas.getContext('experimental-webgl', { antialias: false, depth: true });
  }
  return gl;
}

function isHighpSupported(gl) {
  try {
    const test = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    return !!(test && test.precision > 0);
  } catch (e) {
    return false;
  }
}

export class GLScatterRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = getContext(canvas);
    if (!this.gl) {
      throw new Error('WEBGL_UNAVAILABLE');
    }
    const gl = this.gl;
    this.highp = isHighpSupported(gl);
    this.gpuPickSupported = this.highp;

    this.pointProgram = createProgram(gl, POINT_VS, POINT_FS);
    this.pickProgram = createProgram(gl, PICK_VS, PICK_FS);
    this.lineProgram = createProgram(gl, LINE_VS, LINE_FS);

    this.pointLoc = this._collectLocations(this.pointProgram,
      ['aPosition', 'aColor', 'aSize', 'aId'],
      ['uMVP', 'uPointScale', 'uSizeBoost', 'uMaxSize', 'uSelectedId']);
    this.pickLoc = this._collectLocations(this.pickProgram,
      ['aPosition', 'aSize', 'aId'],
      ['uMVP', 'uPointScale', 'uSizeBoost', 'uMaxSize']);
    this.lineLoc = this._collectLocations(this.lineProgram,
      ['aPosition', 'aColor'], ['uMVP']);

    this.buffers = {};
    this.axisBuffer = null;
    this.axisCount = 0;
    this.pickFBO = null;
    this.count = 0;

    const sizeRange = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    this.maxPointSize = sizeRange ? sizeRange[1] : 64;

    gl.clearColor(0.055, 0.067, 0.09, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    this._lost = false;
    this._lostHandler = (e) => {
      this._lost = true;
      e.preventDefault();
      if (this.onContextLost) this.onContextLost();
    };
    canvas.addEventListener('webglcontextlost', this._lostHandler, false);

    this._initAxes();
  }

  static isSupported(canvas) {
    const probe = canvas || document.createElement('canvas');
    return !!(probe.getContext('webgl') || probe.getContext('experimental-webgl'));
  }

  _collectLocations(program, attribs, uniforms) {
    const gl = this.gl;
    const loc = { attribs: {}, uniforms: {} };
    attribs.forEach((name) => { loc.attribs[name] = gl.getAttribLocation(program, name); });
    uniforms.forEach((name) => { loc.uniforms[name] = gl.getUniformLocation(program, name); });
    return loc;
  }

  _makeBuffer(data, target) {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    gl.bindBuffer(target || gl.ARRAY_BUFFER, buffer);
    gl.bufferData(target || gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  _initAxes() {
    const gl = this.gl;
    const L = 1.25;
    const dark = 0.35;
    const vertices = new Float32Array([
      0, 0, 0, 0.95, 0.35, 0.35,  L, 0, 0, 0.95, 0.35, 0.35,
      0, 0, 0, 0.95 * dark, 0.35 * dark, 0.35 * dark, -L, 0, 0, 0.95 * dark, 0.35 * dark, 0.35 * dark,
      0, 0, 0, 0.35, 0.85, 0.45,  0, L, 0, 0.35, 0.85, 0.45,
      0, 0, 0, 0.35 * dark, 0.85 * dark, 0.45 * dark, 0, -L, 0, 0.35 * dark, 0.85 * dark, 0.45 * dark,
      0, 0, 0, 0.4,  0.6,  0.98,  0, 0, L, 0.4, 0.6, 0.98,
      0, 0, 0, 0.4 * dark, 0.6 * dark, 0.98 * dark,  0, 0, -L, 0.4 * dark, 0.6 * dark, 0.98 * dark
    ]);
    this.axisBuffer = this._makeBuffer(vertices);
    this.axisCount = 12;
  }

  setData(data) {
    const gl = this.gl;
    Object.keys(this.buffers).forEach((key) => {
      gl.deleteBuffer(this.buffers[key]);
    });
    this.buffers = {};
    this.count = data.count;
    this.buffers.position = this._makeBuffer(data.positions);
    this.buffers.color = this._makeBuffer(data.colors);
    this.buffers.size = this._makeBuffer(data.sizes);
    const ids = new Float32Array(data.count);
    for (let i = 0; i < data.count; i++) ids[i] = i;
    this.buffers.id = this._makeBuffer(ids);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  resize(width, height) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.max(1, Math.round(width * dpr));
    const ph = Math.max(1, Math.round(height * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
    this._destroyFBO();
  }

  _bindPointAttribs(loc) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.enableVertexAttribArray(loc.attribs.aPosition);
    gl.vertexAttribPointer(loc.attribs.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.color);
    gl.enableVertexAttribArray(loc.attribs.aColor);
    gl.vertexAttribPointer(loc.attribs.aColor, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
    gl.enableVertexAttribArray(loc.attribs.aSize);
    gl.vertexAttribPointer(loc.attribs.aSize, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.id);
    gl.enableVertexAttribArray(loc.attribs.aId);
    gl.vertexAttribPointer(loc.attribs.aId, 1, gl.FLOAT, false, 0, 0);
  }

  _drawAxes(mvp) {
    const gl = this.gl;
    gl.useProgram(this.lineProgram);
    gl.uniformMatrix4fv(this.lineLoc.uniforms.uMVP, false, mvp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.axisBuffer);
    const ap = this.lineLoc.attribs.aPosition;
    const ac = this.lineLoc.attribs.aColor;
    gl.enableVertexAttribArray(ap);
    gl.vertexAttribPointer(ap, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(ac);
    gl.vertexAttribPointer(ac, 3, gl.FLOAT, false, 24, 12);
    gl.disable(gl.BLEND);
    gl.drawArrays(gl.LINES, 0, this.axisCount);
    gl.enable(gl.BLEND);
  }

  render(camera) {
    if (this._lost || this.count === 0) return;
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const pointScale = this.dpr * camera.refDist;

    this._drawAxes(camera.mvp);

    gl.useProgram(this.pointProgram);
    const u = this.pointLoc.uniforms;
    gl.uniformMatrix4fv(u.uMVP, false, camera.mvp);
    gl.uniform1f(u.uPointScale, pointScale);
    gl.uniform1f(u.uSizeBoost, 0);
    gl.uniform1f(u.uMaxSize, this.maxPointSize);
    gl.uniform1f(u.uSelectedId, camera.selectedId == null ? -1 : camera.selectedId);
    this._bindPointAttribs(this.pointLoc);
    gl.depthMask(true);
    gl.drawArrays(gl.POINTS, 0, this.count);
  }

  _ensureFBO() {
    const gl = this.gl;
    const w = this.canvas.width;
    const h = this.canvas.height;
    if (this.pickFBO && this.pickFBO.width === w && this.pickFBO.height === h) {
      return this.pickFBO;
    }
    this._destroyFBO();
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const color = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, color);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);

    let depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteTexture(color);
      gl.deleteRenderbuffer(depth);
      gl.deleteFramebuffer(fb);
      throw new Error('PICK_FBO_UNSUPPORTED');
    }
    this.pickFBO = { fb: fb, color: color, depth: depth, width: w, height: h };
    return this.pickFBO;
  }

  _destroyFBO() {
    const gl = this.gl;
    if (!this.pickFBO) return;
    gl.deleteTexture(this.pickFBO.color);
    gl.deleteRenderbuffer(this.pickFBO.depth);
    gl.deleteFramebuffer(this.pickFBO.fb);
    this.pickFBO = null;
  }

  /* GPU 编码拾取：离屏帧缓冲把 id 编码进 RGBA，仅回读 1 个像素 */
  pick(camera, cssX, cssY) {
    if (this._lost || this.count === 0 || !this.gpuPickSupported) return -1;
    const gl = this.gl;
    let fbo;
    try {
      fbo = this._ensureFBO();
    } catch (e) {
      this.gpuPickSupported = false;
      return -1;
    }

    const px = Math.max(0, Math.min(fbo.width - 1, Math.round(cssX * this.dpr)));
    const py = Math.max(0, Math.min(fbo.height - 1, Math.round((fbo.height / this.dpr - cssY) * this.dpr)));

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
    gl.viewport(0, 0, fbo.width, fbo.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);

    gl.useProgram(this.pickProgram);
    const u = this.pickLoc.uniforms;
    const pointScale = this.dpr * camera.refDist;
    gl.uniformMatrix4fv(u.uMVP, false, camera.mvp);
    gl.uniform1f(u.uPointScale, pointScale);
    gl.uniform1f(u.uSizeBoost, 2.0);
    gl.uniform1f(u.uMaxSize, this.maxPointSize);

    const loc = this.pickLoc.attribs;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.position);
    gl.enableVertexAttribArray(loc.aPosition);
    gl.vertexAttribPointer(loc.aPosition, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.size);
    gl.enableVertexAttribArray(loc.aSize);
    gl.vertexAttribPointer(loc.aSize, 1, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.id);
    gl.enableVertexAttribArray(loc.aId);
    gl.vertexAttribPointer(loc.aId, 1, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, this.count);

    const pixel = new Uint8Array(4);
    gl.readPixels(px, py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.BLEND);
    gl.clearColor(0.055, 0.067, 0.09, 1);

    const id = pixel[0] * 65536 + pixel[1] * 256 + pixel[2] - 1;
    return id >= 0 && id < this.count ? id : -1;
  }

  dispose() {
    const gl = this.gl;
    this.canvas.removeEventListener('webglcontextlost', this._lostHandler);
    this._destroyFBO();
    Object.keys(this.buffers).forEach((key) => gl.deleteBuffer(this.buffers[key]));
    gl.deleteBuffer(this.axisBuffer);
    gl.deleteProgram(this.pointProgram);
    gl.deleteProgram(this.pickProgram);
    gl.deleteProgram(this.lineProgram);
  }
}
