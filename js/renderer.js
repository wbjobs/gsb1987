/* WebGL1 点云渲染器 + 离屏颜色编码 GPU 拾取 */
'use strict';

const RenderMode = { NORMAL: 0, PICK: 1 };

class ScatterRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const attrs = { antialias: true, depth: true, alpha: false, preserveDrawingBuffer: false };
    const gl = canvas.getContext('webgl', attrs)
            || canvas.getContext('experimental-webgl', attrs);
    if (!gl) throw new Error('WebGL 不可用');
    this.gl = gl;
    this.pointCount = 0;
    this._pickSupported = false;
    this._initPrograms();
    this._initBuffers();
    this._initPickFBO();
    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(0.051, 0.067, 0.09, 1);
  }

  _compile(type, src) {
    const gl = this.gl;
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error('Shader 编译失败: ' + gl.getShaderInfoLog(s));
    }
    return s;
  }

  _initPrograms() {
    const gl = this.gl;
    // 顶点着色器保证 highp，id->颜色编码必须在 VS 完成：
    // 部分移动 GPU 的片元 mediump 是真 fp16（最大 65504），id 可达 10 万会溢出。
    const head = `
      attribute vec3 aPos;
      attribute vec3 aColor;
      attribute float aId;
      uniform mat4 uMVP;
      uniform float uPointSize;
      uniform float uHighlightId;
      vec3 encodeId(float id) {
        float r = mod(id, 256.0);
        float g = mod(floor(id / 256.0), 256.0);
        float b = floor(id / 65536.0);
        return vec3(r, g, b) / 255.0;
      }
    `;
    const vs = head + `
      varying vec3 vColor;
      void main() {
        gl_Position = uMVP * vec4(aPos, 1.0);
        float hl = abs(aId - uHighlightId) < 0.5 ? 1.0 : 0.0;
        gl_PointSize = uPointSize * (1.0 + hl * 0.8) * (300.0 / max(gl_Position.w, 1.0));
        vColor = mix(aColor, vec3(1.0, 0.85, 0.2), hl);
      }`;
    const pickVs = head + `
      varying vec3 vPickColor;
      void main() {
        gl_Position = uMVP * vec4(aPos, 1.0);
        gl_PointSize = uPointSize * (300.0 / max(gl_Position.w, 1.0));
        vPickColor = encodeId(aId);
      }`;
    const fsHead = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
    `;
    const fs = fsHead + `
      varying vec3 vColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float r = dot(d, d);
        if (r > 0.25) discard;
        float edge = smoothstep(0.25, 0.18, r);
        gl_FragColor = vec4(vColor, edge);
      }`;
    const pickFs = fsHead + `
      varying vec3 vPickColor;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        if (dot(d, d) > 0.25) discard;
        gl_FragColor = vec4(vPickColor, 1.0);
      }`;
    const link = (vsSrc, fsSrc) => {
      const p = gl.createProgram();
      gl.attachShader(p, this._compile(gl.VERTEX_SHADER, vsSrc));
      gl.attachShader(p, this._compile(gl.FRAGMENT_SHADER, fsSrc));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error('Program 链接失败: ' + gl.getProgramInfoLog(p));
      }
      return p;
    };
    this._prog = link(vs, fs);
    this._pickProg = link(pickVs, pickFs);
    for (const p of [this._prog, this._pickProg]) {
      p.loc = {
        aPos: gl.getAttribLocation(p, 'aPos'),
        aColor: gl.getAttribLocation(p, 'aColor'),
        aId: gl.getAttribLocation(p, 'aId'),
        uMVP: gl.getUniformLocation(p, 'uMVP'),
        uPointSize: gl.getUniformLocation(p, 'uPointSize'),
        uHighlightId: gl.getUniformLocation(p, 'uHighlightId'),
      };
    }
  }

  _initBuffers() {
    const gl = this.gl;
    this._vboPos = gl.createBuffer();
    this._vboColor = gl.createBuffer();
    this._vboId = gl.createBuffer();
  }

  /* 拾取帧缓冲：颜色纹理 + 深度 renderbuffer。失败则标记不支持，走 CPU 拾取。 */
  _initPickFBO() {
    const gl = this.gl;
    try {
      this._pickFBO = gl.createFramebuffer();
      this._pickTex = gl.createTexture();
      this._pickDepth = gl.createRenderbuffer();
      this._pickSupported = true;
    } catch (e) {
      this._pickSupported = false;
    }
  }

  _allocPickFBO(w, h) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this._pickTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindRenderbuffer(gl.RENDERBUFFER, this._pickDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickFBO);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._pickTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this._pickDepth);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) this._pickSupported = false;
    this._pickSize = { w, h };
  }

  get pickSupported() { return this._pickSupported; }

  setData(positions, colors) {
    const gl = this.gl;
    const n = positions.length / 3;
    this.pointCount = n;
    const ids = new Float32Array(n);
    for (let i = 0; i < n; i++) ids[i] = i;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vboPos);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vboColor);
    gl.bufferData(gl.ARRAY_BUFFER, colors, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._vboId);
    gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
  }

  resize(w, h) {
    const gl = this.gl;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    if (this._pickSupported &&
        (!this._pickSize || this._pickSize.w !== w || this._pickSize.h !== h)) {
      this._allocPickFBO(w, h);
    }
  }

  _bind(prog, mvp, pointSize, highlightId) {
    const gl = this.gl, L = prog.loc;
    gl.useProgram(prog);
    gl.uniformMatrix4fv(L.uMVP, false, mvp);
    gl.uniform1f(L.uPointSize, pointSize);
    if (L.uHighlightId) gl.uniform1f(L.uHighlightId, highlightId);
    // 未使用的 attribute 会被编译器优化掉（loc = -1），必须跳过
    const bindAttr = (loc, vbo, size) => {
      if (loc < 0) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
    };
    bindAttr(L.aPos, this._vboPos, 3);
    bindAttr(L.aColor, this._vboColor, 3);
    bindAttr(L.aId, this._vboId, 1);
  }

  render(mvp, pointSize, highlightId) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._bind(this._prog, mvp, pointSize, highlightId == null ? -1 : highlightId);
    gl.drawArrays(gl.POINTS, 0, this.pointCount);
    gl.disable(gl.BLEND);
  }

  /* GPU 拾取：返回点 id 或 -1。x/y 为 CSS 像素坐标（相对 canvas 左上）。 */
  pick(mvp, pointSize, x, y, scale) {
    if (!this._pickSupported || !this._pickSize) return -2; // 调用方走 CPU 拾取
    const gl = this.gl;
    const px = Math.round(x * scale), py = Math.round(y * scale);
    if (px < 0 || py < 0 || px >= this._pickSize.w || py >= this._pickSize.h) return -1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._pickFBO);
    gl.viewport(0, 0, this._pickSize.w, this._pickSize.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    this._bind(this._pickProg, mvp, pointSize, -1);
    gl.drawArrays(gl.POINTS, 0, this.pointCount);
    const buf = new Uint8Array(4);
    gl.readPixels(px, this._pickSize.h - 1 - py, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (buf[3] === 0) return -1;
    return buf[0] + buf[1] * 256 + buf[2] * 65536;
  }

  dispose() {
    const gl = this.gl;
    [this._vboPos, this._vboColor, this._vboId].forEach(b => b && gl.deleteBuffer(b));
    if (this._pickTex) gl.deleteTexture(this._pickTex);
    if (this._pickDepth) gl.deleteRenderbuffer(this._pickDepth);
    if (this._pickFBO) gl.deleteFramebuffer(this._pickFBO);
    gl.deleteProgram(this._prog);
    gl.deleteProgram(this._pickProg);
  }
}
