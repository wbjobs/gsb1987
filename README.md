# WebGL 3D 散点图

纯手写 WebGL + Canvas + Web Worker 实现的 3D 散点图，零依赖、无构建步骤。

## 运行

```bash
# 需要通过 HTTP 访问（Web Worker 在 file:// 下会被浏览器拦截）
python3 -m http.server 8000
# 打开 http://localhost:8000
```

## 功能

- **渲染**：WebGL1 单次 draw call 绘制 10 万点，圆形点精灵 + 深度测试 + 边缘抗锯齿
- **旋转**：拖拽旋转（带惯性）、滚轮/双指缩放，Pointer Events 统一鼠标与触摸
- **拾取**：点击拾取，三级策略
  1. GPU 拾取：离屏 FBO 颜色编码渲染，readPixels 精确命中（含深度遮挡）
  2. FBO 不可用 → Web Worker 内 CPU 投影拾取（不阻塞主线程）
  3. Worker 不可用 → 主线程 CPU 拾取
- **性能**：按需渲染（dirty 标记）、DPR 上限 2、FPS 监控自动降级（降 DPR → 降点尺寸）
- **兼容**：WebGL1 优先（覆盖远多于 WebGL2），`experimental-webgl` 兜底；片元 highp 按 `GL_FRAGMENT_PRECISION_HIGH` 自适应；id→颜色编码在顶点着色器完成，规避移动端 fp16 片元溢出
- **异常降级**：
  - WebGL 不可用 → Canvas 2D 渲染（仍可旋转/拾取）
  - `webglcontextlost/restored` 自动恢复
  - 渲染异常 → 自动切换 2D；2D 也不可用 → 友好错误页

## 文件结构

```
index.html        入口
css/style.css     样式
js/mat4.js        矩阵数学库（透视投影 / 轨道相机）
js/renderer.js    WebGL 渲染器 + GPU 拾取 FBO
js/worker.js      点云生成 + CPU 拾取（Worker / 主线程双模式）
js/fallback2d.js  Canvas 2D 兜底渲染器
js/main.js        主控：交互、拾取调度、性能自适应、异常降级
```

## 已验证

- 点云生成 10 万点 ~14ms；CPU 拾取全量扫描 ~1ms/次
- 投影→拾取往返测试：命中误差 < 2px
- id 编解码 0–99999 往返无损
