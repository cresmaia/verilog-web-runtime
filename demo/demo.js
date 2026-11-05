/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * The demo page of the runtime. It uses only the public message format (docs/protocol.md) and nothing of the inside
 * of Icarus Verilog. It needs no course, no account and no other server: the page and the runtime come from the same
 * release directory.
 */
import { showRuntimeNotice } from '../runtime-notice.js';

const SAMPLE = `module tb;
  reg [3:0] a, b;
  wire [4:0] s;
  assign s = a + b;
  initial begin
    a = 3; b = 4;
    #1 $display("sum=%0d", s);
    $finish;
  end
endmodule
`;

const $ = (id) => document.getElementById(id);
showRuntimeNotice($('notice'));
$('src').value = SAMPLE;

let worker = null;
function newWorker() {
  if (worker) worker.terminate();
  // The Worker is made from the file of the release directory. RUNTIME_BASE is then the directory of the file.
  worker = new Worker(new URL('../sim-worker.js', import.meta.url));
  return worker;
}

function show(msg) {
  const lines = [];
  if (!msg.ok) {
    lines.push('error: ' + msg.error.name + ': ' + msg.error.message);
  } else {
    for (const [stream, text] of msg.compile.lines) lines.push('[compile ' + stream + '] ' + text);
    lines.push('compile: ok=' + msg.compile.ok + ' stage=' + msg.compile.stage + ' rc=' + msg.compile.rc);
    if (msg.sim) {
      for (const [stream, text] of msg.sim.lines) lines.push('[' + stream + '] ' + text);
      lines.push('vvp: rc=' + msg.sim.rc);
    }
    lines.push('time: compile ' + msg.ms.compile.toFixed(0) + ' ms, simulate ' + msg.ms.simulate.toFixed(0) + ' ms');
  }
  $('out').textContent = lines.join('\n');
  document.body.dataset.done = msg.ok && msg.compile.ok && msg.sim && msg.sim.rc === 0 ? 'ok' : 'failed';
}

$('run').addEventListener('click', () => {
  document.body.dataset.done = '';
  $('out').textContent = 'running...';
  const w = newWorker();
  w.onmessage = (e) => show(e.data);
  w.onerror = (e) => { $('out').textContent = 'worker error: ' + (e.message || '(no message)'); document.body.dataset.done = 'failed'; };
  const bytes = new TextEncoder().encode($('src').value);
  w.postMessage({
    files: [{ vfsPath: 'tb.v', bytes }],
    sourceOrder: ['tb.v'],
    includeDirs: [],
    generation: '2012',
  }, [bytes.buffer]);
});

$('stop').addEventListener('click', () => {
  if (worker) { worker.terminate(); worker = null; }
  $('out').textContent = 'stopped (the Worker was terminated)';
});
