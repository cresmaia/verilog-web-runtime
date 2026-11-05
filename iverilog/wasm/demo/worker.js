/*
 * Web Worker that runs Icarus Verilog (ivlpp -> ivl -> vvp) in WebAssembly.
 * Running in a worker keeps the page responsive, and an endless simulation
 * can be stopped with worker.terminate().
 *
 * message in:  { id, files: {name: text}, generation, top, args }
 * messages out: { id, type: 'line', stream, text }
 *               { id, type: 'done', ok, stage, rc, vcd, vcdName, ms }
 *               { id, type: 'error', message }
 */
importScripts('ivlpp.js', 'ivl.js', 'vvp.js', 'iverilog-wasm.js');

const iv = IverilogWasm.create({ createIvlpp, createIvl, createVvp });

onmessage = async (e) => {
  const { id, files, generation, top, args } = e.data;
  const post = (type, data) => postMessage(Object.assign({ id, type }, data));
  const onLine = (stream, text) => post('line', { stream, text });
  const t0 = performance.now();
  try {
    const c = await iv.compile({ files, generation, top, onLine });
    if (!c.ok) return post('done', { ok: false, stage: c.stage, rc: c.rc, ms: performance.now() - t0 });
    const t1 = performance.now();
    const s = await iv.simulate({ vvp: c.vvp, args, onLine });
    const vcdName = Object.keys(s.files).find((n) => /\.vcd$/i.test(n));
    const vcd = vcdName ? new TextDecoder().decode(s.files[vcdName]) : null;
    post('done', { ok: s.rc === 0, stage: 'vvp', rc: s.rc, vcd, vcdName,
                   ms: performance.now() - t0, compileMs: t1 - t0 });
  } catch (err) {
    post('error', { message: String((err && err.stack) || err) });
  }
};
