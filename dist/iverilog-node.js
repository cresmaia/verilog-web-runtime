#!/usr/bin/env node
/*
 * Command line front end for the WebAssembly build, for testing in Node:
 *
 *   node iverilog-node.js [-g2012] [-DNAME[=V]] [-Idir] [-s top] [-y libdir] [-v lib.v]
 *                         [-u] [-Wall] [-o a.vvp] file.v ...
 *   node iverilog-node.js --run [same options] [+plusarg ...] [-fst|-lxt2|-none] file.v ...
 *
 * Without --run it only compiles (like iverilog). With --run it also
 * simulates (like vvp) and writes the files the simulation created
 * (dump.vcd, ...) to the current directory.
 *
 * Needs ivlpp.js/.wasm, ivl.js/.wasm, vvp.js/.wasm next to this file (or
 * in the directory given by IVERILOG_WASM_DIR).
 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.env.IVERILOG_WASM_DIR || __dirname);
const IverilogWasm = require('./iverilog-wasm.js');
const iv = IverilogWasm.create({
  createIvlpp: require(path.join(dir, 'ivlpp.js')),
  createIvl: require(path.join(dir, 'ivl.js')),
  createVvp: require(path.join(dir, 'vvp.js')),
  locateFile: (f) => path.join(dir, f),
});

async function main(argv) {
  const opt = { files: {}, sourceOrder: [], defines: {}, includeDirs: [], top: [] };
  let out = 'a.out', run = false;
  const plusargs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (a.length > 2 ? a.slice(2) : argv[++i]);
    if (a === '--run') run = true;
    else if (a.startsWith('-g')) (opt.generation = [].concat(opt.generation || [])).push(a.slice(2));
    else if (a.startsWith('-D')) { const [k, v] = val().split('='); opt.defines[k] = v === undefined ? true : v; }
    else if (a.startsWith('-I')) opt.includeDirs.push(val());
    else if (a.startsWith('-s')) opt.top.push(val());
    else if (a.startsWith('-o')) out = val();
    else if (a.startsWith('-v') && a.length > 2 || a === '-v' && argv[i + 1] && !argv[i + 1].startsWith('-')) {
      const f = val(); opt.files[f] = fs.readFileSync(f); (opt.libraryFiles = opt.libraryFiles || []).push(f);
    }
    else if (a.startsWith('-y')) (opt.libraryDirs = opt.libraryDirs || []).push(val());
    else if (a.startsWith('-Y')) (opt.libraryExts = opt.libraryExts || []).push(val());
    else if (a === '-Wall') opt.warnings = 'nuidRpsta';   // same letters as the iverilog driver
    else if (a === '-u') opt.separateUnits = true;
    else if (a.startsWith('+')) plusargs.push(a);
    // vvp "extended" arguments go after the .vvp file: -fst, -lxt2, -none, ...
    else if (/^-(vcd|fst|lxt|lxt2)(-.*)?$|^-none$|^-sdf-/.test(a) || a.startsWith('--vvp-arg='))
      plusargs.push(a.replace(/^--vvp-arg=/, ''));
    else { opt.files[a] = fs.readFileSync(a); opt.sourceOrder.push(a); }
  }
  // The wasm modules only see the files handed to them, so find the
  // `include files the sources need (relative to the current directory, the
  // including file's directory, or a -I directory) and pass those along too.
  const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch (e) { return false; } };
  const queue = Object.keys(opt.files);
  while (queue.length) {
    const f = queue.shift();
    const text = String(opt.files[f]);
    for (const m of text.matchAll(/`include\s+"([^"]+)"/g)) {
      for (const cand of [m[1], path.join(path.dirname(f), m[1])].concat(opt.includeDirs.map((d) => path.join(d, m[1])))) {
        const key = path.normalize(cand);
        if (!opt.files[key] && isFile(key)) { opt.files[key] = fs.readFileSync(key); queue.push(key); }
      }
    }
  }
  // Write the bytes exactly as the program wrote them (not re-encoded text).
  const echo = (stream, s, bytes) => {
    const to = stream === 'stderr' ? process.stderr : process.stdout;
    to.write(bytes ? Buffer.concat([Buffer.from(bytes), Buffer.from('\n')]) : s + '\n');
  };
  opt.onLine = echo;
  opt.findFile = (f) => (isFile(f) ? fs.readFileSync(f) : null);

  const c = await iv.compile(opt);
  if (!c.ok) return c.rc || 1;
  if (!run) { fs.writeFileSync(out, c.vvp); return 0; }

  // Data files for $readmemh, $fopen("r"), $sdf_annotate, ...: every
  // non-Verilog file (< 4 MB) in the current directory and in the
  // directories of the source files.
  const data = {};
  const dirs = new Set(['.'].concat(opt.sourceOrder.map((f) => path.dirname(f))));
  for (const d of dirs)
    for (const n of fs.readdirSync(d)) {
      const p = d === '.' ? n : path.join(d, n);
      if (/\.(v|sv|vh|svh|vhd|vhdl|vvp)$/i.test(n) || data[p]) continue;
      const st = fs.statSync(p);
      if (st.isFile() && st.size < 4 << 20) data[p] = fs.readFileSync(p);
    }

  const subdirs = fs.readdirSync('.').filter((n) => { try { return fs.statSync(n).isDirectory(); } catch (e) { return false; } });
  const s = await iv.simulate({ vvp: c.vvp, files: data, dirs: subdirs, args: plusargs,
    onLine: echo });
  for (const [name, bytes] of Object.entries(s.files)) {
    fs.mkdirSync(path.dirname(name), { recursive: true });
    fs.writeFileSync(name, bytes);
  }
  return s.rc;
}

main(process.argv.slice(2)).then((rc) => { process.exitCode = rc; },
  (e) => { console.error(e); process.exitCode = 99; });
