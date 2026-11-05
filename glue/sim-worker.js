/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt. This file is glue code written by Cresmaia Inc. It is not part of Icarus Verilog.
 * It runs in the same Web Worker as the Icarus Verilog WebAssembly modules (GPL-2.0-or-later), and is
 * published here, with the runtime, under the MIT license (docs/protocol.md).
 *
 * Runs Icarus Verilog (ivlpp -> ivl -> vvp, WebAssembly) in a Web Worker.
 * ivlpp, ivl and vvp are called with the JS driver (iverilog-wasm.js) as it is.
 *
 * Where the runtime files are (RUNTIME_BASE)
 *   The runtime files (ivlpp.js, ivl.js, vvp.js, iverilog-wasm.js and the .wasm files) are fetched from
 *   RUNTIME_BASE, an absolute URL that ends with "/". It is set from outside, before this file runs:
 *     - plan 1 (blob URL): the page fetches this file, puts "self.RUNTIME_BASE = '<url>';\n" in front of it,
 *       and makes a Worker from the blob URL.
 *     - plan 2 (start-up Worker, classic): a small Worker on the page's origin sets self.RUNTIME_BASE and
 *       then calls importScripts('<url>sim-worker.js'). See glue/boot-classic.js.
 *   If RUNTIME_BASE is not set, the directory of this file is used. That is right only when the Worker is
 *   made directly from this file (as in demo/). In a blob Worker this file's own URL cannot be a base, so
 *   RUNTIME_BASE is required there and a missing one raises an error.
 *   A relative RUNTIME_BASE is refused: it would be resolved against the Worker's own URL (the start-up
 *   Worker's page origin in plan 2), not against the runtime.
 *
 * Input:  { files: [{ vfsPath, bytes }], sourceOrder, includeDirs, generation, top }
 *         vfsPath is a path in the virtual file system. A relative path is under /work, an absolute one is
 *         used as it is. top (optional) is the name of the root module, or an array of names (iverilog -s).
 * Output: { ok: true, compile, sim, vcd, ms } or { ok: false, error }
 *         sim.stdoutBytes is the byte string of vvp's standard output (fd 1 only; stderr is not mixed in).
 * The full description of the messages is docs/protocol.md.
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

const iv = IverilogWasm.create({
  createIvlpp, createIvl, createVvp,
  locateFile: (name) => BASE + name,
});

// top: absent (undefined or null) means no -s; otherwise a simple identifier or a non-empty array of them
const ROOT_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;
function rootModules(top) {
  if (top === undefined || top === null) return null;
  const list = Array.isArray(top) ? top : [top];
  let ok = list.length > 0;
  // an index loop, not every(): every() skips the holes of a sparse array
  for (let i = 0; ok && i < list.length; i++) ok = typeof list[i] === 'string' && ROOT_NAME.test(list[i]);
  if (!ok) {
    let shown;
    try { shown = JSON.stringify(top); } catch (e) { shown = '(' + typeof top + ')'; }
    throw new Error('top must be a module name or an array of module names: ' + shown);
  }
  return list;
}

self.onmessage = async (event) => {
  const { files, sourceOrder, includeDirs, generation, top } = event.data;
  const fileMap = {};
  for (const f of files) fileMap[f.vfsPath] = f.bytes;

  const compileLines = [];
  const simLines = [];
  const t0 = performance.now();
  try {
    const roots = rootModules(top);
    const c = await iv.compile({
      files: fileMap, sourceOrder, includeDirs, generation,
      ...(roots ? { top: roots } : {}),
      onLine: (stream, text) => compileLines.push([stream, text]),
    });
    const t1 = performance.now();
    let sim = null;
    let vcd = null;
    if (c.ok) {
      // vvp is run in the same directory as the sources: put the same files in the same place
      const s = await iv.simulate({
        vvp: c.vvp, files: fileMap,
        onLine: (stream, text) => simLines.push([stream, text]),
      });
      sim = { rc: s.rc, stdoutBytes: s.stdoutBytes, lines: simLines, outFiles: Object.keys(s.files) };
      vcd = s.files['dump.vcd'] || null;
    }
    const t2 = performance.now();
    const transfer = [];
    if (sim) transfer.push(sim.stdoutBytes.buffer);
    if (vcd) transfer.push(vcd.buffer);
    self.postMessage({
      ok: true,
      compile: { ok: c.ok, rc: c.rc, stage: c.stage, lines: compileLines },
      sim, vcd,
      ms: { compile: t1 - t0, simulate: t2 - t1 },
    }, transfer);
  } catch (err) {
    self.postMessage({
      ok: false,
      error: { name: (err && err.name) || typeof err, message: String((err && err.message) || err), stack: (err && err.stack) || null },
      compileLines, simLines,
    });
  }
};
