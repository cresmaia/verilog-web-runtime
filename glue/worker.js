/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * Web Worker that runs Icarus Verilog (ivlpp -> ivl -> vvp) in WebAssembly.
 * Running in a worker keeps the page responsive, and an endless simulation
 * can be stopped with worker.terminate().
 *
 * This is the worker.js of the WebAssembly kit (the same code as wasm/demo/worker.js in the iverilog/ tree),
 * with one change: the location of the runtime files is RUNTIME_BASE (see glue/sim-worker.js) instead of the
 * directory of this file, so that the file can be started from another origin (plan 1 and plan 2).
 *
 * message in:  { id, files: {name: text}, generation, top, args }
 * messages out: { id, type: 'line', stream, text }
 *               { id, type: 'done', ok, stage, rc, vcd, vcdName, ms }
 *               { id, type: 'error', message }
 */
'use strict';

function resolveRuntimeBase() {
  const given = self.RUNTIME_BASE;
  if (given !== undefined && given !== null && given !== '') {
    if (typeof given !== 'string' || !/^https?:\/\/[^/]/.test(given)) {
      throw new Error('RUNTIME_BASE must be an absolute http(s) URL string: ' + String(given));
    }
    return given.endsWith('/') ? given : given + '/';
  }
  try {
    return new URL('./', self.location.href).href;
  } catch (err) {
    throw new Error('RUNTIME_BASE is not set, and the directory of this Worker cannot be used as a base (self.location is '
      + self.location.href + '). Set self.RUNTIME_BASE before this file runs.');
  }
}

const BASE = resolveRuntimeBase();
importScripts(BASE + 'ivlpp.js', BASE + 'ivl.js', BASE + 'vvp.js', BASE + 'iverilog-wasm.js');

const iv = IverilogWasm.create({ createIvlpp, createIvl, createVvp, locateFile: (name) => BASE + name });

onmessage = async (e) => {
  const { id, files, generation, top, args } = e.data;
  const post = (type, data) => postMessage(Object.assign({ id, type }, data));
  const onLine = (stream, text) => post('line', { stream, text });
  const t0 = performance.now();
  try {
    const c = await iv.compile({ files, generation, top, onLine });
    if (!c.ok) return post('done', { ok: false, stage: c.stage, rc: c.rc, ms: performance.now() - t0 });
    const t1 = performance.now();
    const s = await iv.simulate({ vvp: c.vvp, args, onLine });
    const vcdName = Object.keys(s.files).find((n) => /\.vcd$/i.test(n));
    const vcd = vcdName ? new TextDecoder().decode(s.files[vcdName]) : null;
    post('done', { ok: s.rc === 0, stage: 'vvp', rc: s.rc, vcd, vcdName,
                   ms: performance.now() - t0, compileMs: t1 - t0 });
  } catch (err) {
    post('error', { message: String((err && err.stack) || err) });
  }
};
