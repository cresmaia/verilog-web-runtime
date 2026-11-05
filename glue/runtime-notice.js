/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Cresmaia Inc.
 * See LICENSES/MIT-cresmaia-glue.txt.
 *
 * The start-up notice component (GPL-2.0 section 2(c) is the reason).
 * A page that uses the runtime calls showRuntimeNotice() when the screen that uses the runtime is opened.
 * It puts a short notice in the page: the license of the WebAssembly part, the absence of a warranty,
 * and links to NOTICE, LICENSES/ and the source of the release.
 *
 *   import { showRuntimeNotice } from 'https://verilog-runtime.example/<version>/runtime-notice.js';
 *   showRuntimeNotice(document.getElementById('runtime-notice'));
 *
 * The links are relative to the place of this file (the release directory), so the notice points to the release
 * that the page loads the runtime from. options.base overrides that. Only text nodes and <a> are made
 * (no innerHTML), and the page's CSP does not need anything for this module beyond script-src.
 * The text in NOTICE_LINES is the text of the notice. Do not shorten it in a page; style it with CSS instead.
 */

export const NOTICE_LINES = [
  'This page runs a WebAssembly build of Icarus Verilog (ivlpp, ivl and vvp).',
  'Icarus Verilog is Copyright (c) Stephen Williams and others, and is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 2 of the License, or (at your option) any later version.',
  'This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.',
  'The WebAssembly files have been changed from the upstream source (see the notices in the source).',
];

/**
 * @param {Element} container where the notice is put (its old content is replaced)
 * @param {{ base?: string, document?: Document }} [options]
 * @returns {Element} the element that was made
 */
export function showRuntimeNotice(container, options = {}) {
  const doc = options.document || container.ownerDocument;
  const base = options.base || new URL('./', import.meta.url).href;
  const link = (href, text) => {
    const a = doc.createElement('a');
    a.href = new URL(href, base).href;
    a.textContent = text;
    a.rel = 'noopener';
    return a;
  };
  const box = doc.createElement('section');
  box.className = 'runtime-notice';
  box.setAttribute('role', 'note');
  box.setAttribute('aria-label', 'License notice for the runtime');
  for (const line of NOTICE_LINES) {
    const p = doc.createElement('p');
    p.textContent = line;
    box.appendChild(p);
  }
  const p = doc.createElement('p');
  p.appendChild(doc.createTextNode('Notices and licenses: '));
  p.appendChild(link('NOTICE', 'NOTICE'));
  p.appendChild(doc.createTextNode(' | '));
  p.appendChild(link('LICENSES/', 'LICENSES'));
  p.appendChild(doc.createTextNode(' | Source code: '));
  p.appendChild(link('source/', 'source'));
  p.appendChild(doc.createTextNode(' | '));
  p.appendChild(link('./', 'index of this release'));
  box.appendChild(p);
  container.replaceChildren(box);
  return box;
}
