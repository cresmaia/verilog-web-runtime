/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * STATUS: moved here from the course side in stage 2A (R3).
 *   Run in this repository from a page of another origin, with the YoWASP Yosys bundle placed by `tools/build-site.mjs --with-yosys`
 *   (checked in Chromium, cases Y1 to Y3 and M1 to M4). The bundle is placed in the release only when
 *   that option is given, with its notice (yosys-wasm/NOTICE; notices/NOTICE-yosys-bundle.txt in the source).
 *
 * Runs Yosys (the WebAssembly build of YoWASP) in a module worker.
 * How to start it (a Worker can only be made from a URL of its own origin):
 *   - On the runtime's own origin: new Worker(<runtime base> + 'yosys-worker.js?base=' + encodeURIComponent(<runtime base>), { type: 'module' }).
 *   - From a page of another origin (the case that matters for a course): the page's origin serves a start-up module Worker (glue/boot-module.js,
 *     a template), which imports this file with the base in the query. A direct `new Worker(<runtime URL>)` does not work across origins.
 * The bundle is expected at <base>yosys-wasm/gen/bundle.js. A static import cannot take a URL from outside, so the bundle
 * is loaded with a dynamic import(). The first message is held until the import has finished.
 * MEASURED (Chromium 153, cases M1 to M4): the dynamic import() of the bundle from a module Worker is checked against
 * script-src (script-src-elem), not worker-src, while the static import of this file by boot-module.js is checked against worker-src. The page's CSP has to name
 * the runtime's origin in both. If the import is blocked, this Worker stays silent (no message, no error event):
 * the page needs its own timeout. The same CSP was put on the page and on the response of the start-up Worker; which of the two checks the import was not separated.
 *
 * The message format is the course's original one with one addition: `outputs` can now hold 'out.v' as well as 'netlist.json'. Nothing else was changed.
 *
 * Input:  { files: [{ path, bytes }], args }
 * Output: { version, loadMs, runMs, stdout, stderr, result, outputs }
 *   outputs: { 'netlist.json'?: Uint8Array, 'out.v'?: Uint8Array } - of the files that Yosys left in the virtual file system, only these two names are
 *   returned (when they exist). 'out.v' is what a script's `write_verilog -noattr out.v` writes.
 *   result.kind
 *     'ok'                 normal exit (exit code 0)
 *     'yosys-exit'         Yosys exited with non-zero through its own error path (YoWASP's Exit)
 *     'exception'          an exception other than Exit came out of WebAssembly (a trap, an uncaught C++ exception, ...)
 *   stdout / stderr are the byte strings that Yosys wrote.
 *
 * What a classification means (a parse error, or a lack of resources) is decided by the course side. Only facts are returned here.
 */
function resolveBase() {
  const q = new URL(import.meta.url).searchParams.get('base');
  if (!q || !/^https?:\/\/[^/]/.test(q)) {
    throw new Error('the query "base" (an absolute http(s) URL of the runtime directory) is required: ' + import.meta.url);
  }
  return q.endsWith('/') ? q : q + '/';
}
const BASE = resolveBase();
const ready = import(BASE + 'yosys-wasm/gen/bundle.js');

function concat(chunks) {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function toTree(files) {
  const tree = {};
  for (const f of files) {
    const parts = f.path.split('/');
    let dir = tree;
    for (const p of parts.slice(0, -1)) dir = (dir[p] ??= {});
    dir[parts[parts.length - 1]] = f.bytes;
  }
  return tree;
}

self.onmessage = async (event) => {
  const { runYosys, Exit, version } = await ready;
  const { files, args } = event.data;
  const out = [];
  const err = [];
  const options = {
    // what is passed may be a reused buffer, so copy it
    stdout: (b) => { if (b) out.push(b.slice()); },
    stderr: (b) => { if (b) err.push(b.slice()); },
    fetchProgress: () => {},
    decodeASCII: false,
  };
  const t0 = performance.now();
  let loadError = null;
  try {
    await runYosys(null, {}, options);        // only fetch and compile the resources (wasm and share/) first
  } catch (e) {
    loadError = e;
  }
  const t1 = performance.now();
  let result;
  let outputs = {};
  if (loadError) {
    result = describeException(loadError, 'load');
  } else {
    try {
      const tree = await runYosys(args, toTree(files), options);
      outputs = collectOutputs(tree);
      result = { kind: 'ok', exitCode: 0 };
    } catch (e) {
      if (e instanceof Exit) {
        outputs = collectOutputs(e.files || {});
        result = { kind: 'yosys-exit', exitCode: e.code };
      } else {
        result = describeException(e, 'run');
      }
    }
  }
  const t2 = performance.now();
  const stdout = concat(out);
  const stderr = concat(err);
  self.postMessage({ version, loadMs: t1 - t0, runMs: t2 - t1, stdout, stderr, result, outputs },
    [stdout.buffer, stderr.buffer]);
};

function describeException(e, phase) {
  return {
    kind: 'exception',
    phase,
    constructorName: (e && e.constructor && e.constructor.name) || typeof e,
    isWasmException: typeof WebAssembly.Exception === 'function' && e instanceof WebAssembly.Exception,
    isRuntimeError: e instanceof WebAssembly.RuntimeError,
    isRangeError: e instanceof RangeError,
    name: (e && e.name) || null,
    message: e && e.message !== undefined ? String(e.message) : null,
    stack: (e && e.stack) || null,
  };
}

// Of the output, return only what the page uses (netlist.json for the diagram, out.v for the simulation of the synthesized netlist)
function collectOutputs(tree) {
  const picked = {};
  for (const name of ['netlist.json', 'out.v']) {
    if (tree && tree[name] instanceof Uint8Array) picked[name] = tree[name];
  }
  return picked;
}
