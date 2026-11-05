# Public specification of the runtime: the messages

This is the public form of the exchange between a page and the runtime (decision W1, three points; see
`README.md`, "The three points that keep a course apart from the inside of Icarus Verilog"). A page, such as a course, may rely on **this document and nothing else** of the runtime. It must not rely on the
inside of Icarus Verilog: the functions inside `iverilog-wasm.js`, the exports and the memory of the `.wasm` files, the names
`createIvlpp`, `createIvl` and `createVvp`, the files that `ivlpp`, `ivl` and `vvp` write inside the virtual file system,
or the order of the steps. Those may change with any version.

The runtime has no knowledge of any course. The demo page (`demo/`) uses only what is written here.

## 1. What a page loads

A page does not load or run a file of the runtime as a script of its own. It starts a Web Worker and talks to it with
`postMessage()`. (A page never calls `importScripts()` or `import` for the GPL-licensed files.)

| Worker file | Kind | What it does | Status in this repository |
|---|---|---|---|
| `sim-worker.js` | classic | Icarus Verilog: compile and run a testbench | built and checked in Chromium |
| `worker.js` | classic | the same Icarus Verilog, in the message format of the WebAssembly kit (section 5) | built and checked |
| `yosys-worker.js` | module | Yosys | in a release built with the Yosys bundle; checked in Chromium (cases Y1 to Y4, M1 to M4); section 4 |
| `schematic-worker.js` | classic | netlistsvg and elkjs: a circuit diagram | in the release since `0.1.0-pre.3`, with `elkjs/` and `netlistsvg/`; run in Chromium in R8 P7 c5; checked in Chromium, cases G1 to G3 (run on 2026-11-03 by the coordinator); section 4 |

The Workers of GPL-licensed parts and the Worker of the EPL-licensed part (`schematic-worker.js`) are separate Workers.
A Worker holds either, never both.

## 2. Where the runtime is: `RUNTIME_BASE`

`RUNTIME_BASE` is the absolute URL of the release directory, ending with `/`, for example
`https://verilog-runtime.example/0.1.0-pre.5/`. The Worker files fetch the runtime files from it. How it reaches the Worker:

1. **Directly.** The page makes the Worker from the file of the release (`new Worker(new URL('sim-worker.js', releaseUrl))`).
   This is possible only for a page of the same origin as the release. The directory of the file is the base (`demo/` does this).
2. **Plan 1, blob URL.** The page fetches the Worker file from the release, puts `self.RUNTIME_BASE = "<url>";` in front of it,
   and makes the Worker from a `blob:` URL. `glue/boot-blob.js` (`createRuntimeWorker(runtimeBase, workerFile)`) does this.
3. **Plan 2, a start-up Worker.** A small classic Worker of the page's origin sets `self.RUNTIME_BASE` and calls `importScripts()` on the
   Worker file of the release. `glue/boot-classic.js` is the template of its text (four lines).

Both plans are the same for the runtime; the runtime does not know which is used. Which one a page uses is its decision.
A relative `RUNTIME_BASE` is refused with an error that names `RUNTIME_BASE`. A missing one is an error in a blob Worker.
(A module-Worker form of plan 2 is a template, `glue/boot-module.js`, for `yosys-worker.js`; section 4. A module form of `sim-worker.js` would need the runtime files wrapped as ES modules; it is not in this release.)

## 3. `sim-worker.js`

### Input (page to Worker): one message per run

```js
worker.postMessage({
  files: [ { vfsPath: 'tb.v', bytes: Uint8Array }, ... ],   // the source files, and any other file the run needs
  sourceOrder: [ 'tb.v', ... ],                             // the files to compile, in this order
  includeDirs: [ ... ],                                     // directories for `include (virtual paths)
  generation: '2012',                                       // the -g value (a string)
  top: 'tb',                                                // optional: the root module (iverilog -s), or an array of names
});
```

- `vfsPath` is a path in the Worker's virtual file system. A relative path is under `/work`; an absolute path is used as it is.
- The same files are also given to the simulation, which runs in the same directory (so that `$readmemh` and `$fopen` can read them).
- Each message starts a new compile and a new simulation in new instances. Nothing is kept between messages.
- `top` is optional. When it is given, only the named modules are elaborated as roots (the same as `iverilog -s`).
  It is a simple identifier (`[A-Za-z_][A-Za-z0-9_$]*`) or a non-empty array of them; anything else (including an
  array with holes) is refused with `{ ok: false, error }`. Escaped identifiers cannot be named. When it is absent
  (or `null`), the roots are the ones iverilog chooses without `-s` (in the main, the modules that no other module
  instantiates).

### Output (Worker to page): one message per run

Success of the Worker (it ran; the Verilog may still have failed):

```js
{
  ok: true,
  compile: { ok: boolean, rc: number, stage: string, lines: [ [stream, text], ... ] },
    // stream is 'stdout' or 'stderr'. stage is 'done', 'ivlpp' or 'ivl' (where a failure was).
  sim: null | { rc: number, stdoutBytes: Uint8Array, lines: [ [stream, text], ... ], outFiles: [ names ] },
    // sim is null when the compile failed. stdoutBytes is vvp's standard output (fd 1) as bytes. stderr is not in it.
  vcd: null | Uint8Array,       // the content of dump.vcd, if the run wrote /work/dump.vcd
  ms: { compile: number, simulate: number },
}
```

A failure that is not a Verilog error (an exception in the Worker):

```js
{ ok: false, error: { name, message, stack }, compileLines: [...], simLines: [...] }
```

`sim.stdoutBytes` and `vcd` are sent as transferred buffers (their `ArrayBuffer`s are moved to the page).

### Stopping

`worker.terminate()` stops a run, including an endless simulation. A page makes a new Worker for the next run
(checked in Chromium, case T1).

### What is not in the message

The Worker passes only the five input fields above to the driver. Other options of the driver (for example `defines`,
`libraryFiles`) are not part of this specification. (`top` was added on 2026-10-20; before that it was in this list.)

## 4. `yosys-worker.js` (Yosys) and `schematic-worker.js`

### `yosys-worker.js`: part of this specification

A module Worker that runs Yosys (a build of Yosys 0.68 by Cresmaia Inc. without ABC with the YoWASP build procedure, `@yowasp/yosys` 0.68.1207-cresmaia.noabc.1). It is in a release only if the release was built with the Yosys bundle
(`runtime.json` then has a `yosys` entry, and `yosys-wasm/gen/bundle.js` exists; `index.html` of the release says so). The message format is the course's original one with **one addition**:
`outputs` can now hold `out.v` as well as `netlist.json`. The existing fields were not changed; the header comment of `glue/yosys-worker.js` says the same.

**Starting it.** A Worker can only be made from a URL of its own origin. From a page of another origin, the page's origin serves a start-up module Worker made
from the template `boot-module.js` of the release (the placeholder `__RUNTIME_BASE__` appears **twice** in it; `runtime.json` `templates[]` says so, with the sha256;
`tools/fill-boot-template.mjs --occurrences 2` fills it), and the page starts it with `new Worker('/boot-module.js', { type: 'module' })`.
The template statically imports `<RUNTIME_BASE>yosys-worker.js?base=<RUNTIME_BASE>`, and that module does a dynamic `import()` of
`<RUNTIME_BASE>yosys-wasm/gen/bundle.js`. The bundle fetches the `.wasm` files and `yosys-resources.0.tar` that lie next to it. On the runtime's own origin
a page may start `<RUNTIME_BASE>yosys-worker.js?base=<RUNTIME_BASE>` directly. The query `base` is required (an absolute `http(s)` URL; a trailing `/` is added if missing).

**Input (page to Worker): one message per run.**

```js
worker.postMessage({
  files: [ { path: 'in.sv', bytes: Uint8Array }, ... ],   // the files put into Yosys's virtual file system; a path with '/' makes directories
  args:  [ '-p', 'read_slang ...; synth -top top; write_verilog -noattr out.v' ],   // the arguments of the yosys command line
});
```

**Output (Worker to page): one message per input message.**

```js
{
  version: string,            // the version of the bundle
  loadMs: number, runMs: number,
  stdout: Uint8Array, stderr: Uint8Array,    // the bytes that Yosys wrote (transferred to the page)
  result: { kind: 'ok', exitCode: 0 }
        | { kind: 'yosys-exit', exitCode: number }    // Yosys exited with a non-zero code through its own error path
        | { kind: 'exception', phase: 'load' | 'run', constructorName, isWasmException, isRuntimeError, isRangeError, name, message, stack },
  outputs: { 'netlist.json'?: Uint8Array, 'out.v'?: Uint8Array },
}
```

- Of the files that Yosys leaves in the virtual file system, **only `netlist.json` and `out.v`** are returned, and only if they exist (also with `yosys-exit`).
  A script that wants a file back has to write it with one of these two names.
- The Worker returns facts only. What a failure means (a parse error, a lack of resources) is decided by the page.
- If the import of the bundle fails (a CSP that does not name the runtime's origin in `script-src`, a missing file), the Worker sends **no reply and raises no error event**:
  a page has to have its own time limit. The Worker does not queue messages: a page sends the next message only after it has received the reply to the previous one.
  The bundle is loaded once; each run starts Yosys again with the files of its own message.
- `worker.terminate()` stops a run.
- The cell models that a page needs to simulate a synthesized netlist with `sim-worker.js` are served by the release as plain files:
  `yosys-wasm/share/simcells.v` and `yosys-wasm/share/simlib.v` (the same files that `yosys-resources.0.tar` holds; their sha256 are in `runtime.json` `yosys.sha256`).
  They are not messages; a page fetches them and passes them to `sim-worker.js` as `files`.
- Checked in Chromium, cases Y1 to Y4 (two scripts: `read_slang ...; proc; flatten; memory; opt_clean; check` and `read_slang ...; synth -top top; write_verilog -noattr out.v`).

The Yosys part is not Icarus Verilog. Yosys itself is under the ISC license. The notice of the bundle and its license texts are `yosys-wasm/NOTICE` and `yosys-wasm/LICENSES/` of the release (`notices/NOTICE-yosys-bundle.txt` and `LICENSES/yosys/` in the source).

### `schematic-worker.js`

In the release since `0.1.0-pre.3`, with `elkjs/lib/elk.bundled.js` and `netlistsvg/built/netlistsvg.bundle.js` (EPL-2.0 and MIT; `NOTICE`, sections 3.6 and 3.7). Start it from the start-up template `boot-schematic.js`;
the response that serves it needs `'unsafe-eval'` in `script-src`, which no other Worker of the runtime needs.

- Input (page to Worker): `{ netlistText }`, the text of the `write_json` output of Yosys. One message per drawing.
- Output (Worker to page): `{ results: [ { module, svg, cells, cellTypes, ms } | { module, skipped: 'blackbox' } | { module, error: { name, message, stack } } ] }`, one entry for each module of the netlist, in the order of the netlist.
  A module is drawn with itself as the top. When the whole message fails (for example the text is not JSON), `{ results, error: { name, message, stack } }`. `svg` is a string; a page must not trust it.
- The Worker sets `attributes.top` of the module it draws (netlistsvg 1.0.2 reads a number). The skin is netlistsvg's `digitalSkin`.
- This part of the specification is as the file was run in R8 P7 c5. It may change with a version, like the rest of this document.

## 5. `worker.js` (the kit's format)

The Worker of the WebAssembly kit, with `RUNTIME_BASE`. Messages:

```
page to Worker:  { id, files: { 'name.v': 'text', ... }, generation, top, args }
Worker to page:  { id, type: 'line', stream, text }
                 { id, type: 'done', ok, stage, rc, vcd, vcdName, ms, compileMs }
                 { id, type: 'error', message }
```

`vcd` is the text of the first `*.vcd` file the run wrote. This format is the kit's; `sim-worker.js` is the one a course should use.

## 6. The start-up notice

A page that opens a screen using the runtime calls `showRuntimeNotice(element)` from `runtime-notice.js` of the same release
(`NOTICE_LINES` is the text). It shows the license of the WebAssembly part, that there is no warranty, and links to `NOTICE`,
`LICENSES/` and `source/` of the release.

## 7. Versions

The release directory is `/<version>/`. A file of a release does not change after it is published (a new version gets a new
directory). `runtime.json` of a release lists the files with sha256.
This specification may change between versions.
