/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * STATUS: moved here from the course side in stage 2A (R3). In release 0.1.0-pre.3 (R8) the two libraries are
 *   placed next to it (tools/build-site.mjs), and it was run in Chromium (R8 P7 c5, case G1).
 *   The code is the code that was run in R8 P7 c5; only this header comment was changed when the libraries were placed.
 *
 * Turns a netlist after synthesis (Yosys write_json) into an SVG circuit diagram with netlistsvg.
 * This Worker holds netlistsvg (MIT) and elkjs (EPL-2.0). It must not hold any GPL part (docs/protocol.md).
 *
 * RUNTIME_BASE: see glue/sim-worker.js. The two libraries are at:
 *   <RUNTIME_BASE>elkjs/lib/elk.bundled.js
 *   <RUNTIME_BASE>netlistsvg/built/netlistsvg.bundle.js
 *
 * CSP: the netlistsvg bundle contains ajv, which builds its validators with `new Function` when the bundle is loaded. The response that serves this Worker
 * (or its start-up Worker, glue/boot-schematic.js) therefore needs 'unsafe-eval' in script-src.
 *
 * Input:  { netlistText }
 * Output: { results: [{ module, svg, cells, cellTypes, ms } | { module, skipped } | { module, error }] }
 *
 * It draws every module that is not a blackbox (Yosys makes a module with an empty body a blackbox).
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
    throw new Error('RUNTIME_BASE is not set (self.location is ' + self.location.href + ').');
  }
}
const BASE = resolveRuntimeBase();

// elkjs treats an environment with "self but no document" as its own Worker and does not expose the fake
// Worker for the layout (new ELK() fails with "_Worker is not a constructor").
// netlistsvg calls new ELK() at load time, so a document is put in place only while the libraries load.
// (The netlistsvg bundle has no runtime reference to document. Checked with grep on 2026-09-23.)
self.document = {};
try {
  importScripts(BASE + 'elkjs/lib/elk.bundled.js', BASE + 'netlistsvg/built/netlistsvg.bundle.js');
} finally {
  delete self.document;
}

// Yosys writes attributes as binary strings ("00...01")
function isSet(v) {
  return v !== undefined && v !== null && (v === 1 || v === true || (typeof v === 'string' && /^0*1$/.test(v)));
}

self.onmessage = async (event) => {
  const results = [];
  try {
    const netlist = JSON.parse(event.data.netlistText);
    for (const [name, mod] of Object.entries(netlist.modules || {})) {
      if (isSet(mod.attributes && mod.attributes.blackbox)) {
        results.push({ module: name, skipped: 'blackbox' });
        continue;
      }
      const cells = Object.values(mod.cells || {});
      const cellTypes = {};
      for (const c of cells) cellTypes[c.type] = (cellTypes[c.type] || 0) + 1;
      // The input check of netlistsvg 1.0.2 wants attributes.top to be the number 0 or 1. Make the one module top.
      const one = { modules: { [name]: Object.assign({}, mod, { attributes: Object.assign({}, mod.attributes, { top: 1 }) }) } };
      const t0 = performance.now();
      try {
        const svg = await netlistsvg.render(netlistsvg.digitalSkin, one);
        // netlistsvg reports a layout failure with console.error and returns undefined. Do not let it pass quietly.
        if (typeof svg !== 'string' || svg.length === 0) throw new Error('netlistsvg did not return an SVG (a layout failure may have been swallowed)');
        results.push({ module: name, svg, cells: cells.length, cellTypes, ms: performance.now() - t0 });
      } catch (err) {
        results.push({ module: name, cells: cells.length, cellTypes, error: { name: err.name, message: String(err.message), stack: err.stack || null }, ms: performance.now() - t0 });
      }
    }
    self.postMessage({ results });
  } catch (err) {
    self.postMessage({ results, error: { name: err.name, message: String(err.message), stack: err.stack || null } });
  }
};
