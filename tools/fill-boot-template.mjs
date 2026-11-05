#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Cresmaia Inc. See LICENSES/MIT-cresmaia-glue.txt.
//
// Fills the placeholder of a start-up Worker template of a release with the URL of the runtime directory.
// It reads one file and writes one file. It uses no network. It stops (exit code 1, nothing written) on anything that is not as expected.
//
//   node tools/fill-boot-template.mjs --template <file> --sha256 <hex> --base <https URL of /<version>/> --out <file>
//        [--placeholder __RUNTIME_BASE__] [--occurrences 1] [--version <version>]
//
//   --sha256       the sha256 that the caller has pinned for this template (from the release's runtime.json). The template has to match it.
//   --base         the runtime directory: https, no user info, no query or fragment, and ends with "/<version>/".
//   --occurrences  how many times the placeholder has to appear in the template (runtime.json says: 1 for boot-classic.js).
//   --version      if given, the last directory of --base has to be this version.
//
// On success it prints the sha256 of the written file.

import fs from 'node:fs';
import crypto from 'node:crypto';

function stop(msg) { console.error('stop: ' + msg); process.exit(1); }
const args = process.argv.slice(2);
const opt = {};
for (let i = 0; i < args.length; i += 2) {
  if (!args[i].startsWith('--') || args[i + 1] === undefined) stop('bad arguments near ' + args[i]);
  const key = args[i].slice(2);
  if (key in opt) stop('the option --' + key + ' is given twice');
  opt[key] = args[i + 1];
}
for (const k of Object.keys(opt)) if (!['template', 'sha256', 'base', 'out', 'placeholder', 'occurrences', 'version'].includes(k)) stop('unknown option --' + k);
for (const k of ['template', 'sha256', 'base', 'out']) if (!opt[k]) stop('--' + k + ' is required');
const placeholder = opt.placeholder || '__RUNTIME_BASE__';
const occurrences = Number(opt.occurrences || 1);
if (!/^__[A-Z0-9_]+__$/.test(placeholder)) stop('the placeholder has to look like __NAME__: ' + placeholder);
if (!Number.isInteger(occurrences) || occurrences < 1) stop('--occurrences has to be a positive integer');

// --- the base URL
const base = opt.base;
if (!/^https:\/\/[A-Za-z0-9.-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~%/-]*)?\/$/.test(base)) {
  stop('--base has to be an https URL of a directory (host, optional port and path of [A-Za-z0-9._~%/-], ending with "/"), without user info, query, fragment, quotes or spaces: ' + base);
}
const basePath = base.replace(/^https:\/\/[^/]+/, '');
// Percent-encoding is decoded before the path is looked at, so that "%2e%2e" (any case) is seen as "..", and "%2f" as "/".
let decoded;
try { decoded = decodeURIComponent(basePath); } catch { stop('--base has a bad percent-encoding: ' + base); }
if (!/^[A-Za-z0-9._~/-]*$/.test(decoded)) stop('--base has, after decoding, a character that is not allowed in the path: ' + base);
if (/(^|\/)\.\.?(\/|$)/.test(decoded) || /\/\//.test(decoded)) stop('--base must not contain "." or ".." segments (also when percent-encoded) or an empty segment: ' + base);
const m = /\/([A-Za-z0-9._-]+)\/$/.exec(decoded);
if (!m) stop('--base has to end with the version directory "/<version>/": ' + base);
if (opt.version && m[1] !== opt.version) stop(`the last directory of --base is "${m[1]}", not the version "${opt.version}"`);

// --- the template
const buf = fs.readFileSync(opt.template);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
if (!/^[0-9a-f]{64}$/.test(opt.sha256)) stop('--sha256 has to be 64 hex digits');
if (sha !== opt.sha256) stop(`the template's sha256 is ${sha}, not the pinned ${opt.sha256}`);
const text = buf.toString('utf8');
const count = text.split(placeholder).length - 1;
if (count !== occurrences) stop(`the placeholder ${placeholder} appears ${count} times in the template, expected ${occurrences}`);

// --- fill, and look for what is left
const out = text.split(placeholder).join(base);
if (out.includes(placeholder)) stop('the placeholder is still in the output');
const left = out.match(/__[A-Z][A-Z0-9_]*__/g);
if (left) stop('another mark of the form __NAME__ is left in the output: ' + [...new Set(left)].join(', '));
// written to a temporary file in the same directory and renamed, so that a stop or a crash never leaves a half-written output
const tmpOut = opt.out + '.tmp-' + process.pid;
try { fs.writeFileSync(tmpOut, out); fs.renameSync(tmpOut, opt.out); } catch (e) { fs.rmSync(tmpOut, { force: true }); stop('cannot write the output: ' + e.message); }
console.log(crypto.createHash('sha256').update(out).digest('hex') + '  ' + opt.out);
