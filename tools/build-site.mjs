#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Cresmaia Inc. See LICENSES/MIT-cresmaia-glue.txt.
//
// Builds a static output directory of one release: site-out/<version>/
//   - the WebAssembly files and the JS of the runtime (from dist/, checked against records/),
//   - the Worker files and the notice component (glue/), the demo page (demo/),
//   - NOTICE, LICENSES/ and an index page,
//   - source/: the complete corresponding source (a tar.gz), its SHA256SUMS and the patches.
// It only reads the files of this repository and writes under site-out/. It does not upload or deploy anything.
//
//   node tools/build-site.mjs --schematic-src <dir> [--version <v>] [--out <dir>] [--with-yosys <dir>]
//
//   --schematic-src <dir>  (or the environment variable SCHEMATIC_SRC; there is no default) the place of the fetched archives of the circuit diagram parts (R8). It has to hold, at these paths
//                       (the layout below): npm/elkjs-0.12.0.tgz, npm/netlistsvg-1.0.2.tgz, github/kieler__elkjs__0.12.0.tar.gz,
//                       github/eclipse-elk__elk__v0.12.0.tar.gz, maven/com/genmymodel/emf/gwt/emf-{common,ecore}/2.12.4/emf-{common,ecore}-2.12.4-sources.jar,
//                       maven/org/eclipse/xtend/org.eclipse.xtend.lib/2.36.0/org.eclipse.xtend.lib-2.36.0-sources.jar and
//                       maven/org/eclipse/xtext/org.eclipse.xtext.xbase.lib/2.36.0/org.eclipse.xtext.xbase.lib-2.36.0-sources.jar.
//                       Their sha256 are checked against records/schematic-archives.sha256. Four files are taken out of the two npm tarballs with `tar` (named members only)
//                       and their sha256 are checked against records/schematic.sha256; they are placed as elkjs/lib/elk.bundled.js, elkjs/LICENSE.md,
//                       netlistsvg/built/netlistsvg.bundle.js and netlistsvg/LICENSE. The six source archives are placed unchanged under source/third-party/ (EPL-2.0 3.1(a), EPL-1.0 3 (iv)).
//                       The build stops on any difference. Nothing is fetched, and nothing taken out of an archive is run.
//
//   --with-yosys <dir>  also places the Yosys bundle (@yowasp/yosys 0.68.1207-cresmaia.noabc.1, built by Cresmaia Inc. without ABC) under <version>/yosys-wasm/gen/, the cell models simcells.v and
//                       simlib.v (taken out of the resource tar) under <version>/yosys-wasm/share/, the Workers yosys-worker.js and
//                       boot-module.js, and the notice (notices/NOTICE-yosys-bundle.txt -> yosys-wasm/NOTICE) and license texts (LICENSES/yosys/ ->
//                       yosys-wasm/LICENSES/) of the Yosys bundle. <dir> has to hold the six files of the bundle
//                       (bundle.js, yosys.core.wasm .. yosys.core4.wasm, yosys-resources.0.tar). Their sha256 are checked against
//                       records/yosys-wasm.sha256 and the build stops on any difference. The bundle itself is not in git.
//                       The bundle.js of the Cresmaia build (without ABC) is placed unchanged, but the resource tar that is placed is cut down to the files in
//                       records/p5/resources-used/union-final.txt (R8b); its sha256 is pinned in records/yosys-resources-pruned.sha256.
//                       The build stops if a listed file is not "checked" in records/p5/resources.tsv in both readings.
//   It also writes <out>/vercel.json for a static host that reads it.
//
// Needs: Node.js 18 or later, and `tar` and `gzip` on the PATH (GNU tar).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const VERSION = opt('--version', fs.readFileSync(path.join(ROOT, 'VERSION'), 'utf8').trim());
if (!/^[A-Za-z0-9._-]+$/.test(VERSION)) die('the version has to match [A-Za-z0-9._-]+: ' + VERSION);
const OUT_BASE = path.resolve(ROOT, opt('--out', 'site-out'));
const OUT = path.join(OUT_BASE, VERSION);
const WITH_YOSYS = opt('--with-yosys', null);
if (args.includes('--with-yosys') && !WITH_YOSYS) die('--with-yosys needs a directory');
const SCHEM_SRC = opt('--schematic-src', process.env.SCHEMATIC_SRC || null);
if (!SCHEM_SRC) die('--schematic-src <dir> (or SCHEMATIC_SRC) is needed: the directory with the fetched archives of elkjs, netlistsvg and the sources (see the head of this file)');
const TREE_NAME = 'iverilog-wasm-1a23d1ffd'; // the name of the tree in the source tar.gz (the name used in the recorded builds)
const TAR_MTIME = '2026-10-19T00:00:00Z';     // fixed, so that the tar.gz does not depend on the time of the build

function die(msg) { console.error('error: ' + msg); process.exit(1); }
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rel = (...p) => path.join(ROOT, ...p);

// --- 0. the output has to be under site-out/ of this repository (it is removed before it is made again)
if (!(OUT + path.sep).startsWith(path.join(ROOT, 'site-out') + path.sep)) die('--out has to be under site-out/: ' + OUT);
// The output directory (site-out/) is what a host serves. A directory of ANOTHER version in it would be served too, with the bytes of whatever build made it
// (2026-10-25: a build of B1 under the old name 0.1.0-pre was found next to 0.1.0-pre.2). So the build stops if site-out/ holds a directory that is not this version
// (names that start with "." are the stage directories of this script). Move it away (mv) or give --out an empty directory under site-out/.
if (fs.existsSync(OUT_BASE)) {
  const others = fs.readdirSync(OUT_BASE, { withFileTypes: true }).filter((e) => e.isDirectory() && e.name !== VERSION && !e.name.startsWith('.')).map((e) => e.name);
  if (others.length) die(`${OUT_BASE} holds a directory of another version: ${others.join(', ')}. Move it away (mv) or use an empty --out under site-out/; one deployment must not carry bytes of two builds by accident.`);
}
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// --- 1. the WebAssembly files and the JS have to be the recorded ones
function checkSums(listFile, dir, what) {
  const lines = fs.readFileSync(listFile, 'utf8').split('\n').filter(Boolean);
  for (const line of lines) {
    const m = /^([0-9a-f]{64})\s+\*?(?:\.\/)?(\S+)$/.exec(line);
    if (!m) die('cannot read a line of ' + listFile + ': ' + line);
    const got = sha256(path.join(dir, m[2]));
    if (got !== m[1]) die(what + ': sha256 of ' + m[2] + ' is ' + got + ', the record says ' + m[1]);
  }
  return lines.length;
}
const nWasm = checkSums(rel('records', 'dist-wasm.sha256'), rel('dist'), 'dist-wasm.sha256');
const nJs = checkSums(rel('records', 'build1', 'js.sha256'), rel('dist'), 'build1/js.sha256');
const nAll = checkSums(rel('dist', 'SHA256SUMS'), rel('dist'), 'dist/SHA256SUMS');
if (nWasm !== 3) die('records/dist-wasm.sha256 has to list 3 files');
console.log(`checked: ${nWasm} wasm (records/dist-wasm.sha256), ${nJs} js (records/build1/js.sha256), ${nAll} files (dist/SHA256SUMS)`);

// --- 2. copy
function copy(from, to) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
const RUNTIME_FILES = ['ivlpp.js', 'ivl.js', 'vvp.js', 'iverilog-wasm.js', 'ivlpp.wasm', 'ivl.wasm', 'vvp.wasm']; // the files that are served
for (const f of RUNTIME_FILES) copy(rel('dist', f), path.join(OUT, f));
// Worker files and the notice component. schematic-worker.js and its start-up template are served together with the parts it needs (step 2c, R8).
// yosys-worker.js and boot-module.js are served only with --with-yosys (step 2b).
const GLUE_FILES = ['sim-worker.js', 'worker.js', 'boot-classic.js', 'boot-blob.js', 'runtime-notice.js', 'schematic-worker.js', 'boot-schematic.js'];
for (const f of GLUE_FILES) copy(rel('glue', f), path.join(OUT, f));
copy(rel('demo', 'index.html'), path.join(OUT, 'demo', 'index.html'));
copy(rel('demo', 'demo.js'), path.join(OUT, 'demo', 'demo.js'));
copy(rel('NOTICE'), path.join(OUT, 'NOTICE'));
const licenseFiles = fs.readdirSync(rel('LICENSES'), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort();
for (const f of licenseFiles) copy(rel('LICENSES', f), path.join(OUT, 'LICENSES', f));

// --- 2b. the Yosys bundle (only with --with-yosys): checked against records/yosys-wasm.sha256
// The resource tar that is served is NOT the full tar of the build: it is cut down to the files that the verifier and the schematic commands read
// (records/p5/resources-used/union-final.txt, pinned by sha256 in union-final.sha256; R8b). bundle.js is the one of the build, unchanged.
// The build stops if a listed file is not a file that R8b P5-1 named "checked" in both readings (records/p5/resources.tsv).
const YOSYS_GEN = ['bundle.js', 'yosys.core.wasm', 'yosys.core2.wasm', 'yosys.core3.wasm', 'yosys.core4.wasm', 'yosys-resources.0.tar'];
const YOSYS_SHARE = ['simcells.v', 'simlib.v'];
const CHECKED = '確かめた'; // the name that records/p5/resources.tsv gives to a file whose source and license are identified (R8b P5-1)
let yosysRecord = null;
let yosysServed = null;   // sha256 of what is placed under yosys-wasm/gen/ and yosys-wasm/share/ (the pruned tar replaces the full tar of the build)
let yosysResources = null;
if (WITH_YOSYS) {
  const srcDir = path.resolve(WITH_YOSYS);
  yosysRecord = Object.fromEntries(fs.readFileSync(rel('records', 'yosys-wasm.sha256'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const m = /^([0-9a-f]{64})  (\S+)$/.exec(l);
    if (!m) die('cannot read a line of records/yosys-wasm.sha256: ' + l);
    return [m[2], m[1]];
  }));
  const wanted = [...YOSYS_GEN.map((f) => 'gen/' + f), ...YOSYS_SHARE.map((f) => 'share/' + f)].sort();
  if (JSON.stringify(Object.keys(yosysRecord).sort()) !== JSON.stringify(wanted)) die('records/yosys-wasm.sha256 has to list exactly: ' + wanted.join(', '));
  // (a) the six files of the build are the recorded ones
  for (const f of YOSYS_GEN) {
    const file = path.join(srcDir, f);
    if (!fs.existsSync(file)) die('--with-yosys: the file is missing: ' + file);
    const got = sha256(file);
    if (got !== yosysRecord['gen/' + f]) die(`--with-yosys: sha256 of ${f} is ${got}, records/yosys-wasm.sha256 says ${yosysRecord['gen/' + f]}`);
  }
  // (b) the list of resource files to serve: the list and its sha256 file say the same, and every file is one that was checked
  const resDir = rel('records', 'p5', 'resources-used');
  const resListed = fs.readFileSync(path.join(resDir, 'union-final.txt'), 'utf8').split('\n').filter(Boolean);
  const resSums = Object.fromEntries(fs.readFileSync(path.join(resDir, 'union-final.sha256'), 'utf8').split('\n').filter(Boolean).map((l) => {
    const m = /^([0-9a-f]{64})  (share\/\S+)$/.exec(l);
    if (!m) die('cannot read a line of union-final.sha256: ' + l);
    return [m[2], m[1]];
  }));
  if (JSON.stringify([...resListed].sort()) !== JSON.stringify(Object.keys(resSums).sort())) die('union-final.txt and union-final.sha256 list different files');
  if (resListed.length === 0) die('union-final.txt is empty');
  for (const f of YOSYS_SHARE) if (!resListed.includes('share/' + f)) die(`union-final.txt does not list share/${f}, which the course page fetches`);
  const tsv = fs.readFileSync(rel('records', 'p5', 'resources.tsv'), 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t'));
  const col = (name) => { const i = tsv[0].findIndex((h) => h.startsWith(name)); if (i < 0) die('records/p5/resources.tsv has no column ' + name); return i; };
  const cName = col('name_result(main'); const cWide = col('name_result_wide_reading'); const cFile = col('name');
  const byName = new Map(tsv.slice(1).map((r) => [r[cFile], r]));
  for (const p of resListed) {
    const r = byName.get(p.slice('share/'.length));
    if (!r) die('a listed resource file is not in records/p5/resources.tsv: ' + p);
    if (r[cName] !== CHECKED || r[cWide] !== CHECKED) die(`a listed resource file is not "${CHECKED}" in both readings of R8b P5-1 (main: ${r[cName]}, wide: ${r[cWide]}): ${p}. Stopping: the owner has to decide.`);
    if (!/^share\/[^/]+$/.test(p)) die('this build serves files at the top level of the resource tree only: ' + p);
  }
  // (c) the files in the full tar of the build are the listed ones, byte for byte; the pruned tar is made from them in a fixed way and is pinned
  const stage = path.join(OUT_BASE, '.stage-yosys-res');
  fs.rmSync(stage, { recursive: true, force: true });
  process.on('exit', () => fs.rmSync(stage, { recursive: true, force: true })); // die() calls process.exit: the stage directory must not stay when the build stops
  fs.mkdirSync(stage, { recursive: true });
  const names = resListed.map((p) => p.slice('share/'.length)).sort();
  const ex0 = spawnSync('tar', ['-xf', path.join(srcDir, 'yosys-resources.0.tar'), '-C', stage, ...names]);
  if (ex0.status !== 0) die('tar could not take the listed files out of the full yosys-resources.0.tar of the build: ' + ex0.stderr.toString());
  for (const p of resListed) {
    const got = sha256(path.join(stage, p.slice('share/'.length)));
    if (got !== resSums[p]) die(`${p} in the full tar of the build has sha256 ${got}, union-final.sha256 says ${resSums[p]}`);
  }
  const listFile = path.join(stage, '.list');
  fs.writeFileSync(listFile, names.join('\n') + '\n');
  const prunedTar = path.join(stage, '.pruned.tar');
  const mk = spawnSync('tar', ['--no-recursion', '--format=ustar', '--owner=0', '--group=0', '--numeric-owner', '--mode=0644', `--mtime=${TAR_MTIME}`, '-cf', prunedTar, '-C', stage, '-T', listFile], { env: { ...process.env, LC_ALL: 'C' } });
  if (mk.status !== 0) die('tar could not make the pruned resource tar: ' + mk.stderr.toString());
  const prunedSha = sha256(prunedTar);
  const prunedRecord = fs.readFileSync(rel('records', 'yosys-resources-pruned.sha256'), 'utf8').trim();
  const pm = /^([0-9a-f]{64})  gen\/yosys-resources\.0\.tar$/.exec(prunedRecord);
  if (!pm) die('cannot read records/yosys-resources-pruned.sha256');
  if (pm[1] !== prunedSha) die(`the pruned resource tar has sha256 ${prunedSha}, records/yosys-resources-pruned.sha256 says ${pm[1]}`);
  for (const f of YOSYS_GEN) copy(f === 'yosys-resources.0.tar' ? prunedTar : path.join(srcDir, f), path.join(OUT, 'yosys-wasm', 'gen', f));
  // the cell models are taken out of the pruned tar that was just placed (the copy in the output, hashed again)
  const shareDir = path.join(OUT, 'yosys-wasm', 'share');
  fs.mkdirSync(shareDir, { recursive: true });
  const placedTar = path.join(OUT, 'yosys-wasm', 'gen', 'yosys-resources.0.tar');
  if (sha256(placedTar) !== prunedSha) die('the copy of yosys-resources.0.tar in the output differs from the pruned tar');
  const ex = spawnSync('tar', ['-xf', placedTar, '-C', shareDir, ...YOSYS_SHARE]);
  if (ex.status !== 0) die('tar could not take simcells.v and simlib.v out of yosys-resources.0.tar: ' + ex.stderr.toString());
  for (const f of YOSYS_SHARE) {
    const got = sha256(path.join(shareDir, f));
    if (got !== yosysRecord['share/' + f]) die(`the ${f} in yosys-resources.0.tar has sha256 ${got}, records/yosys-wasm.sha256 says ${yosysRecord['share/' + f]}`);
  }
  fs.rmSync(stage, { recursive: true, force: true });
  yosysServed = { ...yosysRecord, 'gen/yosys-resources.0.tar': prunedSha };
  yosysResources = { upstreamTarSha256: yosysRecord['gen/yosys-resources.0.tar'], servedTarSha256: prunedSha, list: 'records/p5/resources-used/union-final.txt', files: resListed.map((p) => ({ path: p, sha256: resSums[p] })) };
  for (const f of ['yosys-worker.js', 'boot-module.js']) copy(rel('glue', f), path.join(OUT, f));
  // the notice of the Yosys bundle and the license texts it names (R8b P5). They are placed under yosys-wasm/, next to the files they cover.
  copy(rel('notices', 'NOTICE-yosys-bundle.txt'), path.join(OUT, 'yosys-wasm', 'NOTICE'));
  for (const e of fs.readdirSync(rel('LICENSES', 'yosys'), { withFileTypes: true }).filter((e) => e.isFile()).sort((x, y) => x.name < y.name ? -1 : 1)) copy(rel('LICENSES', 'yosys', e.name), path.join(OUT, 'yosys-wasm', 'LICENSES', e.name));
  console.log(`checked: ${Object.keys(yosysRecord).length} files of the Yosys bundle and cell models (records/yosys-wasm.sha256); resource tar pruned to ${names.length} files (${prunedSha})`);
}

// --- 2c. the circuit diagram parts (R8): elkjs 0.12.0 (EPL-2.0) and netlistsvg 1.0.2 (MIT), taken out of the fetched npm tarballs, and the sources that go with them
// The archives are in --schematic-src <dir> (nothing is fetched here); every archive and every file taken out is checked against records/. The build stops on any difference.
const readSums = (file) => Object.fromEntries(fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
  const m = /^([0-9a-f]{64})  (\S+)$/.exec(l);
  if (!m) die('cannot read a line of ' + file + ': ' + l);
  return [m[2], m[1]];
}));
const SCHEM_ARCHIVES = {
  'npm/elkjs-0.12.0.tgz': null, 'npm/netlistsvg-1.0.2.tgz': null,
  'github/kieler__elkjs__0.12.0.tar.gz': 'source/third-party/elkjs-0.12.0-github-tag.tar.gz',
  'github/eclipse-elk__elk__v0.12.0.tar.gz': 'source/third-party/elk-v0.12.0-github-tag.tar.gz',
  'maven/com/genmymodel/emf/gwt/emf-common/2.12.4/emf-common-2.12.4-sources.jar': 'source/third-party/emf-common-2.12.4-sources.jar',
  'maven/com/genmymodel/emf/gwt/emf-ecore/2.12.4/emf-ecore-2.12.4-sources.jar': 'source/third-party/emf-ecore-2.12.4-sources.jar',
  // Xtend lib and Xbase lib 2.36.0 (EPL-2.0 3.1(a)); the signature of each was checked before they were pinned: records/r8-xtext-sources/verify.txt
  'maven/org/eclipse/xtend/org.eclipse.xtend.lib/2.36.0/org.eclipse.xtend.lib-2.36.0-sources.jar': 'source/third-party/org.eclipse.xtend.lib-2.36.0-sources.jar',
  'maven/org/eclipse/xtext/org.eclipse.xtext.xbase.lib/2.36.0/org.eclipse.xtext.xbase.lib-2.36.0-sources.jar': 'source/third-party/org.eclipse.xtext.xbase.lib-2.36.0-sources.jar',
};
// [published path, archive, member of the archive]
const SCHEM_PLACED = [
  ['elkjs/lib/elk.bundled.js', 'npm/elkjs-0.12.0.tgz', 'package/lib/elk.bundled.js'],
  ['elkjs/LICENSE.md', 'npm/elkjs-0.12.0.tgz', 'package/LICENSE.md'],
  ['netlistsvg/built/netlistsvg.bundle.js', 'npm/netlistsvg-1.0.2.tgz', 'package/built/netlistsvg.bundle.js'],
  ['netlistsvg/LICENSE', 'npm/netlistsvg-1.0.2.tgz', 'package/LICENSE'],
];
const schemSrc = path.resolve(SCHEM_SRC);
const archSums = readSums(rel('records', 'schematic-archives.sha256'));
if (JSON.stringify(Object.keys(archSums).sort()) !== JSON.stringify(Object.keys(SCHEM_ARCHIVES).sort())) die('records/schematic-archives.sha256 has to list exactly: ' + Object.keys(SCHEM_ARCHIVES).join(', '));
for (const [a, want] of Object.entries(archSums)) {
  const file = path.join(schemSrc, a);
  if (!fs.existsSync(file)) die('--schematic-src: the file is missing: ' + file);
  const got = sha256(file);
  if (got !== want) die(`--schematic-src: sha256 of ${a} is ${got}, records/schematic-archives.sha256 says ${want}`);
}
const placedSums = readSums(rel('records', 'schematic.sha256'));
if (JSON.stringify(Object.keys(placedSums).sort()) !== JSON.stringify(SCHEM_PLACED.map((p) => p[0]).sort())) die('records/schematic.sha256 has to list exactly: ' + SCHEM_PLACED.map((p) => p[0]).join(', '));
const schemStage = path.join(OUT_BASE, '.stage-schematic');
fs.rmSync(schemStage, { recursive: true, force: true });
process.on('exit', () => fs.rmSync(schemStage, { recursive: true, force: true }));
fs.mkdirSync(schemStage, { recursive: true });
const schemPlacedSha = {};
for (const [pub, archive, member] of SCHEM_PLACED) {
  const dir = path.join(schemStage, archive.replace(/[^A-Za-z0-9.]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  const ex = spawnSync('tar', ['-xzf', path.join(schemSrc, archive), '-C', dir, '--no-same-owner', member]);
  if (ex.status !== 0) die(`tar could not take ${member} out of ${archive}: ` + ex.stderr.toString());
  const file = path.join(dir, member);
  const got = sha256(file);
  if (got !== placedSums[pub]) die(`${member} of ${archive} has sha256 ${got}, records/schematic.sha256 says ${placedSums[pub]} (${pub})`);
  copy(file, path.join(OUT, pub));
  schemPlacedSha[pub] = got;
}
fs.rmSync(schemStage, { recursive: true, force: true });
for (const [a, pub] of Object.entries(SCHEM_ARCHIVES)) if (pub) copy(path.join(schemSrc, a), path.join(OUT, pub)); // the sources: unchanged, under source/third-party/
const SCHEM_THIRD_PARTY = Object.values(SCHEM_ARCHIVES).filter(Boolean).map((p) => p.slice('source/'.length)).sort();
console.log(`checked: ${Object.keys(archSums).length} archives (records/schematic-archives.sha256), ${SCHEM_PLACED.length} files taken out of them (records/schematic.sha256)`);

// --- 3. source/
const SRC = path.join(OUT, 'source');
fs.mkdirSync(SRC, { recursive: true });
const tarName = `runtime-source-${VERSION}.tar.gz`;
// What goes in the source: the files named in tools/publish-list.txt, and nothing that is built here.
// dist/ (the built files) and site-out/ are not in it; dist/SHA256SUMS is.
// tools/publish-list.txt is the list of the files of the public repository: one path per line (a file, or a directory), "!path" excludes a path, "#" starts a comment.
const LIST = fs.readFileSync(rel('tools', 'publish-list.txt'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const listIncluded = LIST.filter((l) => !l.startsWith('!'));
const listExcluded = LIST.filter((l) => l.startsWith('!')).map((l) => l.slice(1));
const isDist = (m) => m === 'dist' || m.startsWith('dist/');
const members = listIncluded.filter((m) => !isDist(m));
const exclusions = listExcluded.map((x) => ':(exclude)' + x);
// Only the included paths must exist: an excluded path (such as LICENSES/pending) is not in the public repository, where the list is used too.
for (const m of listIncluded) if (!fs.existsSync(rel(m))) die('a path of tools/publish-list.txt is missing: ' + m);
const PATCH_FILES = listIncluded.filter((m) => m.startsWith('patches/')).map((m) => m.slice('patches/'.length)).sort(); // the patches that go to source/patches/
const distSums = 'dist/SHA256SUMS';
// The source tar.gz is made from the git commit (HEAD), not from the working tree, so that untracked or ignored files cannot get in.
// The tree is exported by `git archive` into a temporary directory under site-out/ and renamed (iverilog -> TREE_NAME) by tar.
const git = (...a) => spawnSync('git', ['-C', ROOT, ...a], { maxBuffer: 1 << 30 });
const gitHead = git('rev-parse', 'HEAD');
if (gitHead.status !== 0) die('git rev-parse HEAD failed: ' + gitHead.stderr.toString());
const COMMIT = gitHead.stdout.toString().trim();
const dirty = git('status', '--porcelain', '--', ...members, ...exclusions, distSums).stdout.toString().trim();
if (dirty) console.warn('warning: the working tree differs from HEAD in the source members; the source tar.gz is made from the commit ' + COMMIT + ', not from these changes:\n' + dirty.split('\n').slice(0, 20).join('\n'));
const STAGE = path.join(OUT_BASE, '.stage-' + VERSION);
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
const exp = spawnSync('bash', ['-c', 'set -o pipefail; git -C "$1" archive --format=tar HEAD "${@:3}" | tar -x -C "$2"', 'bash', ROOT, STAGE, ...members, ...exclusions, distSums], { maxBuffer: 1 << 30 });
if (exp.status !== 0) die('git archive failed: ' + exp.stderr.toString());
const tarArgs = ['--sort=name', `--mtime=${TAR_MTIME}`, '--owner=0', '--group=0', '--numeric-owner', '--format=gnu',
  '--transform', `s,^iverilog\\(/\\|$\\),${TREE_NAME}\\1,`, '-cf', '-', '-C', STAGE, ...members, distSums];
const tar = spawnSync('tar', tarArgs, { maxBuffer: 1 << 30, env: { ...process.env, LC_ALL: 'C' } });
if (tar.status !== 0) die('tar failed: ' + tar.stderr.toString());
const gz = spawnSync('gzip', ['-n', '-9'], { input: tar.stdout, maxBuffer: 1 << 30 });
if (gz.status !== 0) die('gzip failed: ' + gz.stderr.toString());
fs.rmSync(STAGE, { recursive: true, force: true });
fs.writeFileSync(path.join(SRC, tarName), gz.stdout);
for (const f of PATCH_FILES) copy(rel('patches', f), path.join(SRC, 'patches', f));
for (const f of ['NOTICE', 'README.md']) copy(rel(f), path.join(SRC, f));
fs.writeFileSync(path.join(SRC, 'SHA256SUMS'), [tarName, ...PATCH_FILES.map((f) => 'patches/' + f), ...SCHEM_THIRD_PARTY]
  .map((f) => `${sha256(path.join(SRC, f))}  ${f}`).join('\n') + '\n');

// --- 4. index pages (static HTML: the notices must not need JavaScript)
const head = (title) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--muted:#555;--line:#ccc}
@media (prefers-color-scheme: dark){:root{--bg:#151515;--fg:#eee;--muted:#aaa;--line:#444}}
body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif;margin:0 auto;padding:16px;max-width:60rem}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:left;vertical-align:top}
code{font-family:ui-monospace,monospace;font-size:14px;word-break:break-all}
a{color:inherit}.muted{color:var(--muted)}
</style></head><body>`;
const rows = (dir, names) => names.map((n) => `<tr><td><a href="${esc(n)}">${esc(n)}</a></td><td><code>${sha256(path.join(dir, n))}</code></td><td>${fs.statSync(path.join(dir, n)).size}</td></tr>`).join('\n');

fs.writeFileSync(path.join(OUT, 'LICENSES', 'index.html'), head('LICENSES') + `
<h1>LICENSES</h1><p>License texts of the components of this release. See <a href="../NOTICE">NOTICE</a>. <a href="../">Index of this release</a>.</p>
<table><tr><th>file</th><th>sha256</th><th>bytes</th></tr>
${rows(path.join(OUT, 'LICENSES'), licenseFiles)}
</table></body></html>
`);
if (WITH_YOSYS) {
  const yl = fs.readdirSync(path.join(OUT, 'yosys-wasm', 'LICENSES')).sort();
  fs.writeFileSync(path.join(OUT, 'yosys-wasm', 'LICENSES', 'index.html'), head('LICENSES of the Yosys bundle') + `
<h1>LICENSES of the Yosys bundle</h1><p>License texts named in <a href="../NOTICE">../NOTICE</a>. <code>MANIFEST.tsv</code> says where each text comes from. <a href="../../">Index of this release</a>.</p>
<table><tr><th>file</th><th>sha256</th><th>bytes</th></tr>
${rows(path.join(OUT, 'yosys-wasm', 'LICENSES'), yl)}
</table></body></html>
`);
}
const srcFiles = ['SHA256SUMS', tarName, 'NOTICE', 'README.md', ...PATCH_FILES.map((f) => 'patches/' + f), ...SCHEM_THIRD_PARTY];
fs.writeFileSync(path.join(SRC, 'index.html'), head('Source') + `
<h1>Source (version ${esc(VERSION)})</h1>
<p>The complete corresponding source of the WebAssembly files in this release, as GPL-2.0 section 3 asks for it. This is the
same place that serves the WebAssembly files (<a href="../">index of this release</a>).
How to build: <a href="README.md">README.md</a>, section "Reproducing the build".</p>
<table><tr><th>file</th><th>sha256</th><th>bytes</th></tr>
${rows(SRC, srcFiles)}
</table>
<p class="muted">The tar.gz holds the source tree of Icarus Verilog (directory <code>${TREE_NAME}/</code>), the patches, the build scripts and
records, the files of Emscripten that were read (without the pre-built libraries), NOTICE and LICENSES/.</p>
<h2>Sources of the circuit diagram parts (<code>third-party/</code>)</h2>
<p>These are not Icarus Verilog. They are the Source Code that goes with <code>elkjs/lib/elk.bundled.js</code> (elkjs 0.12.0, Eclipse Public License 2.0:
Section 3.1(a) of that license), with the Eclipse Modeling Framework classes inside it (emf-gwt 2.12.4, Eclipse Public License 1.0: Section 3 (iv) of that license),
and with the Xtext library classes inside it (org.eclipse.xtext.xbase.lib 2.36.0, Eclipse Public License 2.0: Section 3.1(a) of that license; the sources jar of org.eclipse.xtend.lib 2.36.0 is placed with it).
They are the files as they were fetched, unchanged; their sha256 is in <code>SHA256SUMS</code>.
A copy of the Agreements comes with them: <a href="../LICENSES/EPL-2.0-elkjs-0.12.0-LICENSE.md">the Eclipse Public License 2.0 (EPL-2.0-elkjs-0.12.0-LICENSE.md)</a> and
<a href="../LICENSES/EPL-1.0-eclipse-epl-v10.txt">the Eclipse Public License 1.0 (EPL-1.0-eclipse-epl-v10.txt)</a>. Where else they can be had, and which part of <a href="../NOTICE">NOTICE</a> they belong to, is written in NOTICE, section 3.7.</p>
</body></html>
`);

// --- 5. runtime.json and the index of the release
const walk = (d, base = d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name))]).sort();
const all = walk(OUT).filter((f) => !['index.html', 'runtime.json'].includes(f) && !f.endsWith('/index.html'));
const distRecord = Object.fromEntries(fs.readFileSync(rel('records', 'dist-wasm.sha256'), 'utf8').split('\n').filter(Boolean).map((l) => { const [h, n] = l.split(/\s+/); return [n, h]; }));
const manifest = {
  version: VERSION,
  upstream: { name: 'Icarus Verilog', url: 'https://github.com/steveicarus/iverilog', commit: '1a23d1ffdbff2192b5d43c57711a0e9e67b7bbbc', describe: 's20260301-476-g1a23d1ffd' },
  sourceCommit: COMMIT,
  // start-up Worker templates: a course pins the sha256 and fills the placeholder with tools/fill-boot-template.mjs
  templates: [['boot-classic.js', 1], ['boot-schematic.js', 1], ...(WITH_YOSYS ? [['boot-module.js', 2]] : [])].map(([f, expected]) => {
    const occurrences = fs.readFileSync(path.join(OUT, f), 'utf8').split('__RUNTIME_BASE__').length - 1;
    if (occurrences !== expected) die(`${f} has the placeholder __RUNTIME_BASE__ ${occurrences} times; a template of this release has to have it exactly ${expected} times`);
    return { path: f, sha256: sha256(path.join(OUT, f)), placeholder: '__RUNTIME_BASE__', occurrences };
  }),
  versionString: 's20260301-476-g1a23d1ffd-wasm1',
  // the circuit diagram parts (R8). Not Icarus Verilog: elkjs is under the EPL-2.0 (chosen from "EPL-2.0 OR GPL-3.0-or-later"), netlistsvg under the MIT license.
  schematic: {
    worker: 'schematic-worker.js', template: 'boot-schematic.js',
    cspNote: "the response that serves the schematic Worker (or its start-up Worker) needs 'unsafe-eval' in script-src",
    elkjs: { version: '0.12.0', license: 'EPL-2.0 (chosen)', bundle: 'elkjs/lib/elk.bundled.js', licenseFile: 'elkjs/LICENSE.md', sha256: schemPlacedSha['elkjs/lib/elk.bundled.js'], tarballSha256: archSums['npm/elkjs-0.12.0.tgz'] },
    netlistsvg: { version: '1.0.2', license: 'MIT', bundle: 'netlistsvg/built/netlistsvg.bundle.js', licenseFile: 'netlistsvg/LICENSE', sha256: schemPlacedSha['netlistsvg/built/netlistsvg.bundle.js'], tarballSha256: archSums['npm/netlistsvg-1.0.2.tgz'] },
    sources: Object.fromEntries(Object.entries(SCHEM_ARCHIVES).filter(([, pub]) => pub).map(([a, pub]) => [pub, archSums[a]])),
    pins: 'records/schematic.sha256 and records/schematic-archives.sha256; where they come from: records/schematic-sources.tsv',
  },
  wasm: distRecord,
  // present only when the release was built with --with-yosys: the Yosys bundle (not Icarus Verilog), its sha256 and its notices
  ...(WITH_YOSYS ? { yosys: {
    package: '@yowasp/yosys', version: '0.68.1207-cresmaia.noabc.1', bundle: 'yosys-wasm/gen/bundle.js', worker: 'yosys-worker.js', template: 'boot-module.js',
    cellModels: ['yosys-wasm/share/simcells.v', 'yosys-wasm/share/simlib.v'],
    // what is served: the six files of the build except yosys-resources.0.tar, which is the pruned tar (resources.upstreamTarSha256 is the full tar of the build; the field keeps its old name)
    sha256: Object.fromEntries(Object.entries(yosysServed).map(([k, v]) => ['yosys-wasm/' + k, v])),
    resources: yosysResources,
    notices: 'yosys-wasm/NOTICE (the notice of the Yosys bundle) and yosys-wasm/LICENSES/ (the license texts); see yosys-wasm/LICENSES/MANIFEST.tsv for where each text comes from',
  } } : {}),
  files: all.map((f) => ({ path: f, bytes: fs.statSync(path.join(OUT, f)).size, sha256: sha256(path.join(OUT, f)) })),
};
fs.writeFileSync(path.join(OUT, 'runtime.json'), JSON.stringify(manifest, null, 2) + '\n');

fs.writeFileSync(path.join(OUT, 'index.html'), head('Verilog runtime ' + VERSION) + `
<h1>Verilog runtime, version ${esc(VERSION)}</h1>
<p>A WebAssembly build of Icarus Verilog (ivlpp, ivl, vvp) with a JavaScript driver and Web Worker files, published by Cresmaia Inc.
Icarus Verilog is free software under the GNU General Public License, version 2 or (at your option) any later version, and comes
with <strong>no warranty</strong>. The WebAssembly files have been changed from upstream.
This is a pre-release version; the files of a version do not change.</p>
<ul>
<li><a href="NOTICE">NOTICE</a>: copyrights, licenses and changes of every component of this release</li>
<li><a href="LICENSES/">LICENSES/</a>: the license texts</li>
<li><a href="source/">source/</a>: the complete corresponding source of the WebAssembly files, and how to build them</li>
<li><a href="demo/">demo/</a>: the demo page (needs nothing but this release)</li>
<li><a href="runtime.json">runtime.json</a>: the list of the files with sha256</li>${WITH_YOSYS ? `
<li><a href="yosys-wasm/NOTICE">yosys-wasm/NOTICE</a> and <a href="yosys-wasm/LICENSES/">yosys-wasm/LICENSES/</a>: the notice and the license texts of the Yosys bundle</li>` : ''}
</ul>${WITH_YOSYS ? `
<p><strong>This release also contains a build of Yosys 0.68 (<code>@yowasp/yosys</code> 0.68.1207-cresmaia.noabc.1)</strong> in <code>yosys-wasm/</code>, made by Cresmaia Inc. with the YoWASP build procedure and without ABC,
with the Worker <code>yosys-worker.js</code> and the start-up template <code>boot-module.js</code>. It is not Icarus Verilog: Yosys is under the ISC license
and the components inside it are under the licenses named in <a href="yosys-wasm/NOTICE">yosys-wasm/NOTICE</a>, whose texts are in <a href="yosys-wasm/LICENSES/">yosys-wasm/LICENSES/</a>.
The notice is a reading of the files that were read; it is not a legal opinion, and it lists what was not checked. <strong>ABC is not compiled in.</strong> The resource tar is cut down to the three files that the course reads
(<code>runtime.json</code> <code>yosys.resources</code>); <code>bundle.js</code> and the WebAssembly files are the output of that build, unchanged.</p>` : ''}
<h2>Files</h2>
<table><tr><th>file</th><th>sha256</th><th>bytes</th></tr>
${rows(OUT, all.filter((f) => !f.includes('/')))}
</table>${WITH_YOSYS ? `
<h2>Yosys (yosys-wasm/)</h2>
<table><tr><th>file</th><th>sha256</th><th>bytes</th></tr>
${rows(OUT, all.filter((f) => /^yosys-wasm\/(gen|share)\//.test(f)))}
</table>` : ''}
<h2>Circuit diagram parts (<code>elkjs/</code>, <code>netlistsvg/</code>)</h2>
<p><strong>This release also contains elkjs 0.12.0 and netlistsvg 1.0.2</strong>, which <code>schematic-worker.js</code> (start-up template: <code>boot-schematic.js</code>) loads to draw a circuit diagram.
They are not Icarus Verilog. netlistsvg is under the MIT license. elkjs is offered under "EPL-2.0 OR GPL-3.0-or-later" and is used here under the <strong>Eclipse Public License 2.0</strong>;
it contains classes of the Eclipse Modeling Framework under the Eclipse Public License 1.0 and other parts, all named in <a href="NOTICE">NOTICE</a> (section 3.6 and 3.7).
<strong>Source Code of elkjs and of the Eclipse Layout Kernel, of the EMF classes, and of the Xtext library classes, is available from Cresmaia Inc. here: <a href="source/">source/third-party/</a></strong>
(with the places where it can also be had, in <a href="NOTICE">NOTICE</a>). These files come with no warranty from Cresmaia Inc.
The response that serves the schematic Worker needs <code>'unsafe-eval'</code> in <code>script-src</code>.</p>
<table><tr><th>file</th><th>sha256</th><th>bytes</th></tr>
${rows(OUT, all.filter((f) => /^(elkjs|netlistsvg)\//.test(f)))}
</table>
<p class="muted">Upstream: <a href="https://github.com/steveicarus/iverilog">steveicarus/iverilog</a> commit <code>1a23d1ffd</code>.
The WebAssembly files are the ones recorded as <code>records/dist-wasm.sha256</code> in the source.</p>
</body></html>
`);

// --- 6. vercel.json for a static host: the response headers of a release. It is written next to the version directory (<out>/vercel.json),
// because the host serves <out> as its root and the files of a release are under /<version>/.
const hdr = (key, value) => ({ key, value });
const vercel = {
  cleanUrls: false,
  headers: [
    { source: '/(.*)', headers: [hdr('Access-Control-Allow-Origin', '*'), hdr('X-Content-Type-Options', 'nosniff')] },
    { source: '/(.*)\\.js', headers: [hdr('Content-Type', 'text/javascript; charset=utf-8')] },
    { source: '/(.*)\\.wasm', headers: [hdr('Content-Type', 'application/wasm')] },
    { source: '/(.*)\\.tar', headers: [hdr('Content-Type', 'application/x-tar')] },
    { source: '/(.*)\\.v', headers: [hdr('Content-Type', 'text/plain; charset=utf-8')] },
    // The scripts, WebAssembly files, tar and cell models of a version are cached for a long time. The index pages, runtime.json and the other files keep the host's
    // default (revalidate).
    { source: `/${VERSION}/(.*)\\.(js|wasm|tar|v)`, headers: [hdr('Cache-Control', 'public, max-age=31536000, immutable')] },
  ],
};
fs.writeFileSync(path.join(OUT_BASE, 'vercel.json'), JSON.stringify(vercel, null, 2) + '\n');

console.log('built:', OUT);
console.log('files:', all.length + ' (+ index pages, runtime.json)');
console.log('source tar.gz sha256:', sha256(path.join(SRC, tarName)), fs.statSync(path.join(SRC, tarName)).size, 'bytes');
