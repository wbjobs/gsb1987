# 手写 WebGL 3D 散点图

零第三方依赖，纯手写 WebGL1 + Canvas + Web Worker 的 3D 散点可视化，支持轨迹球旋转、GPU 拾取、大规模点渲染与多级降级。

## 运行

ES Module 与 Web Worker 需通过 HTTP 访问（不要直接双击 `file://`）：

```bash
npm run serve        # 等价于 python3 -m http.server 8080
# 打开 http://localhost:8080
```

手动验证 Canvas 2D 降级：`http://localhost:8080/?force2d=1`

## 测试

```bash
npm test
```

- `test/unit.mjs`：矩阵 / 四元数 / 轨迹球 / 相机 / CPU 拾取 / GPU 拾取 RGBA 编解码往返 / Mock GL 渲染流程
- `test/worker-test.mjs`：Worker 消息协议、Transferable 传输、点数钳制

## 交互

- 拖拽：轨迹球四元数旋转，松手带惯性
- 滚轮 / 双指捏合：缩放（带钳制与缓动）
- 悬停：显示点 ID 与 x/y/z
- 单击：选中（白色放大高亮）
- 双击 / 按钮：重置视角

## 关键设计

**渲染（`src/gl-scatter.js`）**
- WebGL1（`webgl` → `experimental-webgl` 两级回退），手写点精灵 shader，圆形软边（`discard` + `smoothstep`），深度测试保证遮挡正确
- 单次 `gl.drawArrays(POINTS)` 提交全部点；位置 / 颜色 / 大小 / ID 四个独立 `STATIC_DRAW` VBO；50k 点仅约 2.1 MB 显存
- 点大小按透视距离衰减，钳制到设备 `ALIASED_POINT_SIZE_RANGE`；DPR 上限 2
- RGB 三轴辅助线（独立线 shader）

**拾取（GPU 编码，CPU 射线降级）**
- 拾取 pass：点 ID（+1，0 留给背景）编码为 `R*65536 + G*256 + B` 写入离屏 FBO；深度缓冲保证遮挡点不会误选
- 点在拾取 pass 中略微放大（+3px），更容易点中；仅 `readPixels` 回读 1 个像素，开销极低
- 检测 fragment shader `highp` 支持；不支持 / FBO 不完整 / 任何拾取异常时自动切换 CPU 射线投影比对（容差按 CSS 像素换算）

**数据管线（`src/worker.js` + `src/data.js`）**
- Worker 后台生成数据，三个 `ArrayBuffer` 以 Transferable 零拷贝移交主线程
- Worker 构造失败 / 报错 / 超时无响应时有状态提示，并在主线程用同一套 `data.js` 降级生成

**数学（`src/math.js`）**
- 手写列主序 4x4：透视投影、lookAt、矩阵乘法、四元数→旋转矩阵、向量→旋转四元数

**兼容与异常降级**

| 异常 | 处理 |
| --- | --- |
| 无 WebGL / shader 编译链接失败 | 替换 canvas 节点，切 Canvas 2D 渲染器（最多绘制 1.2 万点，深度排序） |
| 不支持 fragment highp | GPU 拾取关闭，CPU 射线拾取 |
| 拾取 FBO 不完整 / readPixels 异常 | 当帧降级 CPU 拾取 |
| `webglcontextlost` | 顶部横幅提示，替换 canvas 切 2D（同一 canvas 不能同时拥有两种上下文） |
| Worker 不可用 / 报错 | 主线程同步降级生成，状态栏提示 |
| 超大点数 | Worker 钳制到 200 万；2D 后端跨步采样 |
| 窗口缩放 | 防抖重建绘图缓冲与 FBO |
| 触屏 | Pointer Events + 双指捏合，`touch-action: none` |

## 文件结构

```
index.html               页面与控制面板
styles.css
src/math.js              矩阵 / 四元数
src/arcball.js           轨迹球 + 惯性
src/camera.js            透视相机
src/gl-scatter.js        WebGL 渲染 + GPU 拾取
src/canvas2d-renderer.js 2D 降级渲染
src/cpu-pick.js          CPU 射线拾取（共享降级路径）
src/data.js              数据生成（Worker / 主线程共用）
src/worker.js            Worker 入口
src/main.js              应用调度 / 交互 / 降级
test/                    Node 测试
```
