import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = new URL('../src/', import.meta.url).pathname;
const dataSrc = fs.readFileSync(path.join(root, 'data.js'), 'utf8');
const workerSrc = fs.readFileSync(path.join(root, 'worker.js'), 'utf8');

const sandbox = {};
sandbox.globalThis = sandbox;
sandbox.console = console;
sandbox.performance = { now: () => Number(process.hrtime.bigint() / 1000000n) };
sandbox.location = { href: 'http://test/src/worker.js' };
const posted = [];
sandbox.postMessage = (msg, transfer) => {
  posted.push({ msg, transfer });
};
const ctx = vm.createContext(sandbox);
sandbox.importScripts = () => { vm.runInContext(dataSrc, ctx, { filename: 'data.js' }); };
sandbox.self = sandbox;
vm.runInContext(workerSrc, ctx, { filename: 'worker.js' });

sandbox.onmessage({ data: { type: 'generate', count: 30000, seed: 42 } });
const reply = posted[0].msg;
assert.equal(reply.type, 'data');
assert.equal(reply.count, 30000);
assert.equal(Object.prototype.toString.call(reply.positions), "[object ArrayBuffer]");
assert.equal(reply.positions.byteLength, 30000 * 3 * 4);
assert.equal(reply.sizes.byteLength, 30000 * 4);
assert.equal(reply.colors.byteLength, 30000 * 3 * 4);
assert.ok(reply.elapsed >= 0);
assert.equal(posted[0].transfer.length, 3, '三个 buffer 应作为 Transferable 转移');
for (const b of posted[0].transfer) {
  assert.ok(Object.prototype.toString.call(b) === '[object ArrayBuffer]');
  assert.ok(b.byteLength > 0);
}

const positions = new Float32Array(reply.positions);
let inRange = true;
for (let i = 0; i < positions.length; i++) {
  if (!(positions[i] >= -2 && positions[i] <= 2)) { inRange = false; break; }
}
assert.ok(inRange, '坐标应落在约 [-1,1] 范围');

posted.length = 0;
sandbox.onmessage({ data: { type: 'other' } });
assert.equal(posted.length, 0, '未知消息应被忽略');

sandbox.onmessage({ data: { type: 'generate', count: 2000001, seed: 1 } });
const reply2 = posted[0].msg;
assert.equal(reply2.type, 'data');
assert.ok(reply2.count <= 2000000, '点数应被钳制到 200 万');
console.log('PASS  Worker 生成/协议/Transferable/钳制（count=' + reply2.count + '）');
