/*
 * iverilog-wasm.js - a small driver for Icarus Verilog built to WebAssembly.
 *
 * The native "iverilog" command is a driver that writes a few config files
 * and then runs "ivlpp | ivl" as child processes; "vvp" then runs the
 * result. There are no child processes in a browser, so this file does the
 * driver's job in JavaScript: it writes the same config files into each
 * module's in-memory filesystem and runs ivlpp.wasm, ivl.wasm and vvp.wasm
 * one after the other, passing files between them.
 *
 * Works in Node (require) and in a browser page or Web Worker (global
 * IverilogWasm). A Web Worker is recommended in the browser, so that a
 * long or endless simulation does not freeze the page and can be stopped
 * with worker.terminate().
 *
 *   const iv = IverilogWasm.create({ createIvlpp, createIvl, createVvp });
 *   const c = await iv.compile({ files: { 'tb.v': src }, generation: '2012' });
 *   const s = await iv.simulate({ vvp: c.vvp });
 *   // c.log, s.stdout, s.files['dump.vcd']
 *
 * Copyright: this file is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.IverilogWasm = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const WORK = '/work';      // cwd of every module; user files live here
  const BASE = '/ivl';       // stands in for <prefix>/lib/ivl

  // The contents of tgt-vvp/vvp.conf (the "-C .../vvp.conf" the driver adds)
  const VVP_CONF = 'functor:cprop\nfunctor:nodangle\nflag:DLL=vvp.tgt\n';

  // -g flags, processed as in driver/main.c (process_generation).
  // opt.generation is one -g value or a list of them, e.g. ['2012', 'specify'].
  const GEN_VALUES = ['1995', '2001', '2001-noconfig', '2005', '2005-sv', '2009', '2012', '2017', '2023'];
  const GEN_FLAGS = {        // flag name -> config key (each takes "x" or "no-x")
    xtypes: 'xtypes', 'icarus-misc': 'icarus', specify: 'specify', interconnect: 'interconnect',
    'io-range-error': 'io_range_error', 'strict-ca-eval': 'strict_ca_eval',
    'strict-expr-width': 'strict_expr_width', 'shared-loop-index': 'shared_loop_index',
    'allow-real-arg-to-bits': 'allow_real_arg_to_bits', 'verilog-ams': 'verilog_ams',
    'strict-net-var-declaration': 'strict_net_var', 'strict-parameter-declaration': 'strict_parameter',
  };
  function generationLines(opt) {
    const gen = {
      generation: '2005', specify: 'no-specify', interconnect: 'no-interconnect',
      assertions: 'assertions', xtypes: 'xtypes', io_range_error: 'io-range-error',
      strict_ca_eval: 'no-strict-ca-eval', strict_expr_width: 'no-strict-expr-width',
      shared_loop_index: 'shared-loop-index', allow_real_arg_to_bits: 'no-allow-real-arg-to-bits',
      verilog_ams: 'no-verilog-ams', strict_net_var: 'strict-net-var-declaration',
      strict_parameter: 'strict-parameter-declaration', icarus: 'icarus-misc',
      std_include: true, relative_include: false,
    };
    const list = [].concat(opt.generation == null ? [] : opt.generation);
    if (opt.specify) list.push('specify');
    for (const g of list.map(String)) {
      const neg = g.startsWith('no-'), base = neg ? g.slice(3) : g;
      if (GEN_VALUES.includes(g)) gen.generation = g;
      else if (g === '1' || g === '2') Object.assign(gen, { generation: g === '1' ? '1995' : '2001', xtypes: 'no-xtypes', icarus: 'no-icarus-misc' });
      else if (g === '2x') Object.assign(gen, { generation: '2005', xtypes: 'xtypes', icarus: 'icarus-misc' });
      else if (GEN_FLAGS[base]) gen[GEN_FLAGS[base]] = g;
      else if (g === 'assertions' || g === 'supported-assertions' || g === 'no-assertions') gen.assertions = g;
      else if (base === 'strict-declaration') {
        gen.strict_net_var = (neg ? 'no-' : '') + 'strict-net-var-declaration';
        gen.strict_parameter = (neg ? 'no-' : '') + 'strict-parameter-declaration';
      } else if (base === 'std-include') gen.std_include = !neg;
      else if (base === 'relative-include') gen.relative_include = !neg;
      else throw new Error('Unknown/Unsupported Language generation ' + g);
    }
    return gen;
  }

  function iconfigText(opt, outPath) {
    const g = generationLines(opt);
    const gen = g.generation;
    const lines = [];
    lines.push('basedir:' + BASE);
    lines.push('module:' + BASE + '/system.vpi');
    lines.push('module:' + BASE + '/vhdl_sys.vpi');
    lines.push('module:' + BASE + '/vhdl_textio.vpi');
    const newer = ['2005', '2009', '2012', '2017', '2023'];
    if (newer.includes(gen) || g.icarus === 'icarus-misc' || g.verilog_ams === 'verilog-ams')
      lines.push('module:' + BASE + '/v2005_math.vpi');
    if (g.verilog_ams === 'verilog-ams' || g.icarus === 'icarus-misc')
      lines.push('module:' + BASE + '/va_math.vpi');
    if (['2005-sv', '2009', '2012', '2017', '2023'].includes(gen))
      lines.push('module:' + BASE + '/v2009.vpi');
    for (const key of ['generation', 'specify', 'interconnect', 'assertions', 'xtypes',
      'io_range_error', 'strict_ca_eval', 'strict_expr_width', 'shared_loop_index',
      'allow_real_arg_to_bits', 'verilog_ams', 'strict_net_var', 'strict_parameter', 'icarus'])
      lines.push('generation:' + g[key]);
    lines.push('warnings:' + (opt.warnings != null ? opt.warnings : 'nu'));
    lines.push('ignore_missing_modules:false');
    lines.push('out:' + outPath);
    for (const top of [].concat(opt.top || [])) lines.push('root:' + top);
    for (const lib of [].concat(opt.libraryFiles || [])) lines.push('library_file:' + lib);
    for (const [k, v] of Object.entries(opt.parameters || {})) lines.push('defparam:' + k + '=' + v);
    if (opt.timescale) lines.push('timescale:' + opt.timescale);
    lines.push('iwidth:32');
    lines.push('widthcap:65536');
    // No "ivlpp:" line: ivl cannot start ivlpp as a child process here, so
    // everything is preprocessed up front (library -y/-v search is not
    // supported).
    return lines.join('\n') + '\n';
  }

  function definesText(opt) {
    const g = generationLines(opt);
    const lines = ['D:__ICARUS__=1'];
    if (g.verilog_ams === 'verilog-ams') lines.push('D:__VAMS_ENABLE__=1');
    for (const [k, v] of Object.entries(opt.defines || {}))
      lines.push('D:' + k + (v === true || v == null ? '' : '=' + v));
    for (const dir of [].concat(opt.includeDirs || [])) lines.push('I:' + dir);
    if (g.std_include) lines.push('I:' + BASE + '/include');
    lines.push('relative include:' + (g.relative_include || opt.relativeInclude ? 'true' : 'false'));
    return lines.join('\n') + '\n';
  }

  function mkdirp(FS, path) {
    let cur = '';
    for (const part of path.split('/').filter(Boolean)) {
      cur += '/' + part;
      try { FS.mkdir(cur); } catch (e) { /* exists */ }
    }
  }

  function writeFiles(FS, files) {
    for (const [name, data] of Object.entries(files || {})) {
      const full = name.startsWith('/') ? name : WORK + '/' + name;
      mkdirp(FS, full.slice(0, full.lastIndexOf('/')));
      FS.writeFile(full, data);
    }
  }

  function readTree(FS, dir, skip) {
    const out = {};
    const walk = (d, rel) => {
      for (const n of FS.readdir(d)) {
        if (n === '.' || n === '..') continue;
        const p = d + '/' + n, r = rel ? rel + '/' + n : n;
        const st = FS.stat(p);
        if (FS.isDir(st.mode)) walk(p, r);
        else if (!skip || !skip(r)) out[r] = FS.readFile(p);
      }
    };
    walk(dir, '');
    return out;
  }

  function create(cfg) {
    const factories = { ivlpp: cfg.createIvlpp, ivl: cfg.createIvl, vvp: cfg.createVvp };
    const compiled = {};   // name -> Promise<WebAssembly.Module>, compiled once

    function getCompiled(name) {
      if (!compiled[name]) {
        const file = name + '.wasm';
        const url = cfg.locateFile ? cfg.locateFile(file) : file;
        compiled[name] = (async () => {
          if (typeof process === 'object' && process.versions && process.versions.node &&
              typeof window === 'undefined' && typeof importScripts === 'undefined') {
            const bytes = require('fs').readFileSync(url);
            return WebAssembly.compile(bytes);
          }
          const resp = fetch(url);
          if (WebAssembly.compileStreaming) {
            try { return await WebAssembly.compileStreaming(resp); } catch (e) { /* bad MIME type */ }
          }
          return WebAssembly.compile(await (await fetch(url)).arrayBuffer());
        })();
      }
      return compiled[name];
    }

    // stdout/stderr are taken byte by byte and split into lines here, so that
    // bytes that are not UTF-8 (e.g. Shift_JIS text in a $display) are kept
    // as they are in stdoutBytes and decoded with cfg.encoding for the lines.
    const encoding = cfg.encoding || 'utf-8';
    function lineSplitter(stream, out, raw, onLine) {
      let buf = [];
      const decoder = new TextDecoder(encoding);
      const flush = () => {
        const bytes = new Uint8Array(buf);
        const text = decoder.decode(bytes);
        buf = [];
        out.push(text);
        if (onLine) onLine(stream, text, bytes);     // bytes: the line without "\n"
      };
      return {
        put(byte) {
          if (byte === null || byte === undefined) return;
          byte &= 0xff;
          if (raw) raw.push(byte);
          if (byte === 10) flush(); else buf.push(byte);
        },
        end() { if (buf.length) flush(); },
      };
    }

    // Run one program to completion in a fresh instance (C globals are not
    // re-initialised between runs, so instances are never reused).
    async function runProgram(name, args, setup, onLine) {
      const out = [], raw = [];
      const so = lineSplitter('stdout', out, raw, onLine);
      const se = lineSplitter('stderr', out, null, onLine);
      const wasmModule = await getCompiled(name);
      const mod = await factories[name]({
        noInitialRun: true,
        thisProgram: name,                       // argv[0], used in some messages
        // stdin gives EOF (interactive input after $stop); stdout/stderr bytes
        // go to the line splitters. Marking the streams as terminals keeps C
        // stdout line buffered, so output arrives line by line while running.
        preRun: [(m) => {
          m.FS.init(() => null, so.put, se.put);
          for (const fd of [1, 2]) {
            const st = m.FS.getStream(fd);
            if (st && !st.tty) st.tty = { ops: {} };
          }
        }],
        quit: (status, toThrow) => { throw toThrow; },  // never process.exit() in Node
        instantiateWasm(imports, receive) {
          WebAssembly.instantiate(wasmModule, imports).then(
            (inst) => receive(inst, wasmModule),
            (err) => { out.push(String(err)); if (onLine) onLine('stderr', String(err)); });
          return {};
        },
      });
      const FS = mod.FS;
      mkdirp(FS, WORK);
      mkdirp(FS, BASE + '/include');
      FS.chdir(WORK);
      if (setup) setup(FS);
      let rc;
      try { rc = mod.callMain(args); } catch (e) {
        if (e && typeof e.status === 'number') rc = e.status; else throw e;
      }
      so.end(); se.end();
      return { rc, out, FS, stdoutBytes: new Uint8Array(raw) };
    }

    // compile({ files, generation, defines, includeDirs, top, warnings, parameters })
    //   files: { 'name.v': 'source text', 'inc/defs.vh': '...' }
    //   generation: '2005' (default, as iverilog), '2009', '2012', ... or a
    //     list of -g values, e.g. ['2012', 'specify']
    //   warnings: the driver's flag letters, default 'nu'; -Wall is 'nuidRpsta'
    //   sourceOrder: names to compile, in order (default: every *.v/*.sv file)
    //   libraryFiles: names in files to use like "iverilog -v": only the
    //     modules that are instantiated are elaborated.
    //   libraryDirs / libraryExts: like "iverilog -y dir -Y .v". ivl cannot
    //     run ivlpp on a library file itself here, so when it reports missing
    //     modules, <dir>/<module><ext> is added as a library file and the
    //     compile is repeated.
    //   separateUnits: like "iverilog -u": each file is its own compilation unit
    //   findFile(path): optional, returns the contents of a file that is not
    //     in `files` (or null). Used for library files and for `include files
    //     the preprocessor could not find, then the compile is repeated.
    // -> { ok, vvp (Uint8Array), log (string), preprocessed (string) }
    async function compile(opt) {
      const dirs = [].concat(opt.libraryDirs || []);
      const findFile = opt.findFile || opt.findLibraryFile;
      if (!dirs.length && !findFile) return compileOnce(opt, opt.onLine);
      const exts = [].concat(opt.libraryExts || ['.v']);
      const files = Object.assign({}, opt.files);
      let libs = [].concat(opt.libraryFiles || []);
      const tried = new Set();
      const have = async (f) => {
        if (f in files) return true;
        if (!findFile || tried.has(f)) return false;
        tried.add(f);
        const data = await findFile(f);
        if (data == null) return false;
        files[f] = data;
        return true;
      };
      for (let round = 0; ; round += 1) {
        const res = await compileOnce(Object.assign({}, opt, { files, libraryFiles: libs }), null);
        let progress = false;
        if (!res.ok && round < 100) {
          // `include files that the preprocessor did not find
          for (const m of res.log.matchAll(/Include file (\S+) not found/g))
            if (!tried.has(m[1]) && await have(m[1])) progress = true;
          // modules missing after elaboration: look in the library directories
          const missing = [...res.log.matchAll(/^\s+(\S+) referenced \d+ times?\.$/gm)].map((m) => m[1]);
          for (const mod of missing) {
            search: for (const d of dirs) for (const ext of exts) {
              const f = (d === '.' || d === '' ? '' : d.replace(/\/+$/, '') + '/') + mod + ext;
              if (libs.includes(f)) continue;
              if (await have(f)) { libs = libs.concat(f); progress = true; break search; }
            }
          }
        }
        if (!progress) {               // final result: now show its output
          if (opt.onLine) for (const l of res.lines) opt.onLine(l[0], l[1], l[2]);
          return res;
        }
      }
    }

    async function compileOnce(opt, onLineCb) {
      const files = opt.files || {};
      const libs = [].concat(opt.libraryFiles || []);
      const sources = (opt.sourceOrder ||
        Object.keys(files).filter((n) => /\.(v|sv|vl|vlg|verilog)$/i.test(n) && !libs.includes(n)))
        .filter((n) => !libs.includes(n)).concat(libs);
      const log = [], lines = [];
      const onLine = (stream, s, bytes) => {
        // With -o, ivlpp also reports its error count on stderr; when it is
        // piped into ivl (as the iverilog driver does it) only ivl reports
        // it ("Preprocessor failed with N error(s)."), so drop this line.
        if (stream === 'stderr' && /^ivlpp: had \(\d+\) errors\.$/.test(s)) return;
        lines.push([stream, s, bytes]);
        if (onLineCb) onLineCb(stream, s, bytes);
      };

      // 1. ivlpp. Normally all sources go through one pass (so a `define in
      //    one file is seen by the next), like "ivlpp ... | ivl -- -". With
      //    separateUnits (iverilog -u) each file is preprocessed on its own
      //    and becomes its own compilation unit in ivl.
      const units = opt.separateUnits ? sources.map((f) => [f]) : [sources];
      const pre = [];                  // [name for ivl, preprocessed text]
      for (let u = 0; u < units.length; u += 1) {
        const pp = await runProgram('ivlpp',
          ['-L', '-F' + WORK + '/.ivl_defines', '-f' + WORK + '/.ivl_sources',
           '-p' + WORK + '/.ivl_cdefines', '-o' + WORK + '/.ivl_pp.v'],
          (FS) => {
            writeFiles(FS, files);
            writeFiles(FS, opt.includeFiles || {});
            FS.writeFile(WORK + '/.ivl_defines', definesText(opt));
            FS.writeFile(WORK + '/.ivl_sources', units[u].join('\n') + '\n');
          }, onLine);
        log.push(...pp.out.filter((l) => !/^ivlpp: had \(\d+\) errors\.$/.test(l)));
        let text = null;
        try { text = pp.FS.readFile(WORK + '/.ivl_pp.v'); } catch (e) { /* none */ }
        // On preprocessor errors the output ends with a "// Icarus preprocessor
        // had (N) errors." line, which ivl reports; so go on to ivl unless
        // there is no output at all.
        if (text == null)
          return { ok: false, stage: 'ivlpp', rc: pp.rc || 1, vvp: null, log: log.join('\n'), lines };
        // In ivl's file system the preprocessed text takes the source's name,
        // so that each unit is reported under its own file name.
        pre.push([opt.separateUnits ? units[u][0] : '.ivl_pp.v', text]);
      }

      // 2. ivl: parse + elaborate + tgt-vvp code generation
      const ivl = await runProgram('ivl',
        ['-C' + WORK + '/.ivl_iconfig', '-C' + BASE + '/vvp.conf', '--'].concat(pre.map((p) => p[0])),
        (FS) => {
          FS.writeFile(BASE + '/vvp.conf', VVP_CONF);
          FS.writeFile(WORK + '/.ivl_iconfig', iconfigText(opt, WORK + '/a.vvp'));
          writeFiles(FS, Object.fromEntries(pre));
        }, onLine);
      log.push(...ivl.out);
      let vvp = null;
      try { vvp = ivl.FS.readFile(WORK + '/a.vvp'); } catch (e) { /* none */ }
      const ok = ivl.rc === 0 && vvp != null;
      return { ok, stage: ok ? 'done' : 'ivl', rc: ok ? 0 : (ivl.rc || 1), vvp: ok ? vvp : null,
               log: log.join('\n'), lines,
               preprocessed: pre.map((p) => new TextDecoder().decode(p[1])).join('') };
    }

    // simulate({ vvp, files, dirs, args }) -> { rc, stdout, stdoutBytes, files }
    //   files: data files for $readmemh/$fopen
    //   args: what follows the .vvp file on the vvp command line: plusargs
    //     and extended arguments such as '-fst' (FST instead of VCD output)
    //   vvpFlags: vvp options that go before the file (e.g. '-n')
    //   dirs: extra (empty) directories to create, e.g. for $dumpfile("out/x.vcd")
    //   result.files: every file present in the work dir afterwards
    //   (e.g. 'dump.vcd'), as Uint8Array
    async function simulate(opt) {
      const inputNames = new Set(Object.keys(opt.files || {}));
      const res = await runProgram('vvp', [].concat(opt.vvpFlags || [], [WORK + '/a.vvp'], opt.args || []),
        (FS) => {
          for (const d of opt.dirs || []) mkdirp(FS, d.startsWith('/') ? d : WORK + '/' + d);
          writeFiles(FS, opt.files || {});
          FS.writeFile(WORK + '/a.vvp', opt.vvp);
        }, opt.onLine);
      const outFiles = readTree(res.FS, WORK, (r) => r === 'a.vvp' || (!opt.keepInputs && inputNames.has(r)));
      return { rc: res.rc, stdout: res.out.join('\n'), stdoutBytes: res.stdoutBytes, files: outFiles };
    }

    return { compile, simulate, iconfigText, definesText };
  }

  return { create, VVP_CONF, iconfigText, definesText };
});
