/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * Start-up Worker for plan 2, module form (a template). It is the form that a cross-origin page can use for a module Worker such as
 * glue/yosys-worker.js. The page's origin has to serve this file (a Worker can only be made from a URL of its own origin), and the page starts it with
 *   new Worker('/boot-module.js', { type: 'module' })
 * Replace the placeholder in the import specifier below (it appears twice, in the same line) with the absolute URL of the runtime directory, ending with "/".
 * The module that is imported reads the same URL from its own query string (?base=...), because a module has no self.RUNTIME_BASE before it runs.
 *
 * What was measured: in stage 1 (Chromium 153 and Firefox 155) a static import of an absolute URL of another
 * origin from a module Worker was checked against the CSP directive worker-src (not script-src), so worker-src has to name the runtime's origin.
 * This file's import is a static import. The dynamic import() that yosys-worker.js does (for <base>yosys-wasm/gen/bundle.js) was measured here
 * (Chromium 153, cases M1 to M4): it is checked against script-src (script-src-elem), so script-src has to name the runtime's origin too.
 * Run with the Yosys bundle: checked in Chromium, case Y1. Firefox: not run.
 */
import '__RUNTIME_BASE__yosys-worker.js?base=__RUNTIME_BASE__';
