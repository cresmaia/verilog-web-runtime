/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * Start-up Worker for the schematic Worker (plan 2, classic Worker). A template.
 * The page's origin has to serve this Worker (a Worker can only be made from a URL of its own origin).
 * Replace the placeholder in the string below (the only place it appears) with the absolute URL of the runtime directory, ending with "/"
 * (for example https://verilog-runtime.example/<version>/), and serve the result from the page's origin.
 * This file does the two things below and nothing else; all other work is done by schematic-worker.js of the runtime.
 *
 * The response that serves the filled file needs 'unsafe-eval' in its script-src. No other start-up Worker needs it.
 */
self.RUNTIME_BASE = '__RUNTIME_BASE__';
importScripts(self.RUNTIME_BASE + 'schematic-worker.js');
