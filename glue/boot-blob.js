/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * Plan 1 (blob URL). A page function that makes a Worker from a Worker file of the runtime.
 *   const worker = await createRuntimeWorker('https://verilog-runtime.example/<version>/', 'sim-worker.js');
 * It fetches the Worker file from runtimeBase, puts "self.RUNTIME_BASE = ..." in front of it, and makes a
 * Worker from a blob URL. The page needs, in its Content-Security-Policy: worker-src blob:, connect-src and
 * script-src for runtimeBase's origin, and 'wasm-unsafe-eval' in script-src. The runtime's origin has to
 * answer with Access-Control-Allow-Origin.
 * Classic Worker files only (sim-worker.js, worker.js, schematic-worker.js).
 */
export async function createRuntimeWorker(runtimeBase, workerFile) {
  const base = runtimeBase.endsWith('/') ? runtimeBase : runtimeBase + '/';
  const res = await fetch(base + workerFile);
  if (!res.ok) throw new Error('fetch ' + base + workerFile + ' failed: ' + res.status);
  const text = await res.text();
  const blob = new Blob(['self.RUNTIME_BASE = ' + JSON.stringify(base) + ';\n', text], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  try {
    return new Worker(url);
  } finally {
    // The Worker has been given the URL; the blob can be released after it has started to load.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}
