# Icarus Verilog の WebAssembly ビルド

Icarus Verilog の 3 つのプログラム（`ivlpp` プリプロセッサ、`ivl` コンパイラ、`vvp` ランタイム）を
Emscripten で WebAssembly にし、ブラウザ（Web Worker）と Node.js で動かすための一式です。

- 対象ソース: upstream `master` のコミット `1a23d1ffd`（2026-09-10、Icarus Verilog 14.0 devel）
- 本体への変更は小さく、移植のための 2 ファイル（`ivl_dlfcn.h`, `vvp/vpi_modules.cc`）と、
  WebAssembly で表に出た既存の問題の修正 4 ファイル（下記「本体で直したもの」）です。
  移植用の変更は `IVL_STATIC_MODULES`（Emscripten/WASI では自動で有効）のときだけ効くので、通常ビルドには影響しません。
- 残りは新規ディレクトリ `wasm/` にまとまっています。

## ビルド

必要なもの: Emscripten（emsdk）、autoconf、gperf、bison、flex、make、ホスト用 C コンパイラ（gcc/clang）、git、Node.js。
FST/LXT 波形出力用に zlib と bzip2 を GitHub から git clone して Emscripten でビルドします（`WITH_ZLIB=0` で省略、VCD だけになります）。

```sh
git clone https://github.com/steveicarus/iverilog.git
cd iverilog
git checkout 1a23d1ffd
git apply /path/to/iverilog-wasm.patch

source ~/emsdk/emsdk_env.sh     # emcc を PATH に入れる
wasm/build.sh                   # 出力: build-wasm/dist/
```

2 コアのマシンで 3〜5 分です。`dist/` の中身:

| ファイル | 内容 |
|---|---|
| `ivlpp.js/.wasm` | プリプロセッサ |
| `ivl.js/.wasm` | コンパイラ（`tgt-vvp` コード生成器と VPI モジュールを静的リンク） |
| `vvp.js/.wasm` | シミュレータ（VPI モジュール `system`, `v2005_math`, `v2009`, `va_math`, `vhdl_sys`, `vhdl_textio`, `vpi_debug` を静的リンク） |
| `iverilog-wasm.js` | `iverilog` ドライバの代わり（下記） |
| `iverilog-node.js` | Node 用のコマンドライン版（テスト用） |
| `index.html`, `worker.js` | ブラウザデモ |
| `SOURCE.patch` | 対応するソース（元のコミット番号＋全変更）。`dist/` を公開すればソースも一緒に公開されます |

ブラウザで試す:

```sh
cd build-wasm/dist && python3 -m http.server 8000
# http://localhost:8000/ を開く（file:// では wasm を読めません）
```

`NODE_CLI=1 wasm/build.sh` とすると、実ファイルシステムを使う Node 版（`build-wasm/node-cli/`）も作り、
ネイティブの `iverilog` ドライバから `-B` で呼べるようにします（回帰テスト用）。

## 何を変えたか

ネイティブの Icarus Verilog は「`iverilog` ドライバが設定ファイルを書き、`ivlpp | ivl` を子プロセスで起動し、
`ivl` はコード生成器 `vvp.tgt` を、`vvp` は `system.vpi` などを `dlopen()` で読み込む」という作りです。
ブラウザには子プロセスも `dlopen()` もないので、次の 3 点で置き換えています。

1. **dlopen → 静的リンク + 名前表**。`ivl_dlfcn.h` の `ivl_dlopen()/ivl_dlsym()` を、
   `wasm/static_modules_{ivl,vvp}.c` の表を引く実装に差し替えます（`"…/system.vpi"` も `"system"` も同じ扱い）。
   各 VPI モジュールの `vlog_startup_routines[]` は名前が衝突するので、`wasm/vpi-static.mk` で
   モジュールごとに `vlog_startup_routines_system` などへ改名してコンパイルします。
   `vvp/vpi_modules.cc` はファイルを `stat()` で探す部分を静的ビルドでは飛ばします。
2. **子プロセス → JS ドライバ**。`wasm/iverilog-wasm.js` が `iverilog` と同じ内容の設定ファイル
   （`-F` defines、`-f` ソース一覧、`-C` iconfig、`vvp.conf`）を各モジュールのメモリ上 FS に書き、
   `ivlpp → ivl → vvp` を順に実行します。
3. **ビルド時にホストで動かすツール**（`vvp/draw_tt` → `tables.cc`）は configure の
   `CC_FOR_BUILD` でホストのコンパイラを使います（iverilog のビルドに元からある仕組み）。

見落としやすい点: `ivl` はコンパイル時にも VPI モジュールを読み込み、システム関数の戻り値の型を
調べています。ここを省くと `$random` が符号なしに、`$realtime` や `$sqrt` が 32 ビット整数として
扱われ、結果が静かに変わります。このビルドでは VPI モジュールを `ivl` にもリンクしています。

## 本体で直したもの

WebAssembly は関数ポインタの型やファイル記述子の扱いがネイティブより厳密なので、波形出力（VPI）まわりで
既存コードの問題が 3 つ表に出ました。どれも hello world では出ず、回帰テストと出力ファイルの比較で見つかったものです。

- `vpi/sys_lxt.c`, `vpi/sys_lxt2.c`: `void *close_dumpfile(void)` を `(void(*)(void))` にキャストして `atexit()` に登録していた。
  WebAssembly では型の違う関数呼び出しはトラップになり、LXT 出力が終了時に落ちる。戻り値を `void` に。
- LXT/LXT2/FST の各 writer: 圧縮データを `gzdopen(dup(fd))` で書き、新しい記述子が元と同じファイル位置から始まる前提。
  Emscripten の `dup()` はファイルを開き直すので位置が引き継がれず（3.1.6 では先頭から）、ファイルの先頭が上書きされて壊れる。
  位置を引き継ぐ `dup()`（`wasm/dup_offset.c`）を `vvp` にリンクし、`vpi/fstapi.c` の `fflush()` より前に `dup()` している
  箇所には位置合わせの `lseek()` を追加。
- `vpi/vcd_priv2.cc`: LXT2 出力は書き込み用スレッド（`std::thread`）を使う。スレッドなしの WebAssembly では起動できずに
  abort するので、スレッドがないときはバッチごとにその場で処理する経路を追加。

## 古い Emscripten について

古い Emscripten（Debian/Ubuntu パッケージの 3.1.6 など）は LLVM と組み合わせがずれていて
`main(argc, argv)` を見つけられないため、`wasm/main_export_shim.c` を自動で追加します
（新しい emsdk では追加されません）。

## JavaScript から使う

```js
// Web Worker の中（worker.js 参照）。Node では require() で同じ 4 ファイルを読み込む
importScripts('ivlpp.js', 'ivl.js', 'vvp.js', 'iverilog-wasm.js');
const iv = IverilogWasm.create({ createIvlpp, createIvl, createVvp });

async function run(designSrc, tbSrc, headerSrc, hex) {
  const c = await iv.compile({
    files: { 'design.v': designSrc, 'tb.v': tbSrc, 'defs.vh': headerSrc },
    generation: ['2012'],          // -g の値を並べる（'specify' なども可）
    defines: { WIDTH: 8 },          // -D
    top: 'tb',                      // -s（省略可）
    onLine: (stream, line) => postMessage({ stream, line }),
  });
  if (!c.ok) return null;
  const s = await iv.simulate({ vvp: c.vvp, args: ['+seed=1'], files: { 'rom.hex': hex },
                                onLine: (stream, line) => postMessage({ stream, line }) });
  return new TextDecoder().decode(s.files['dump.vcd']);   // $dumpfile で作られたファイル
}
```

- 実行ごとに新しいインスタンスを作ります（C のグローバル変数が初期化されないため）。wasm のコンパイル結果は使い回すので、
  2 回目以降はコンパイル＋実行で数十 ms です。
- ブラウザでは Web Worker で動かしてください。無限ループのシミュレーションも `worker.terminate()` で止められます。
- FST で出力するには `simulate({ ..., args: ['-fst'] })`（vvp のファイル名の後ろに付く引数）。
- `libraryDirs`（`-y`）は、`ivl` が不足モジュールを報告したら `<dir>/<module>.v` を足して再コンパイルする方式、
  `separateUnits`（`-u`）はファイルごとに `ivlpp` を実行して別々のコンパイル単位として `ivl` に渡す方式です。
- `findFile(path)` を渡すと、見つからない `` `include `` ファイルやライブラリファイルをその都度取りに行けます（サーバーから fetch するなど）。

Node のコマンドライン版:

```sh
node dist/iverilog-node.js --run -g2012 design.v tb.v     # コンパイル＋実行、dump.vcd などを書き出す
node dist/iverilog-node.js --run -fst design.v tb.v       # FST で出力
node dist/iverilog-node.js -o a.vvp design.v tb.v          # コンパイルだけ
```

## 確認したこと

詳細は `TEST-RESULTS.md`。

- 公式回帰テスト（`ivtest`）を、ネイティブの `iverilog` ドライバ＋ WebAssembly 版 `ivlpp/ivl/vvp`
  （Node, `NODE_CLI=1` のビルド）で実行。
- ブラウザと同じ経路（`iverilog-wasm.js` が設定を組み立て、メモリ上 FS で動かす）で `ivtest` のテストを実行し、ネイティブと出力を比較。
- 波形ファイル: VCD と LXT/LXT2 はネイティブとバイト単位で一致、FST はヘッダーの日時以外一致（fstapi のリーダーで読み戻した中身も一致）。
- ヘッドレス Chromium でデモを実行（コンパイル＋シミュレーション、コンパイルエラー表示、Stop）。
- 速度: CPU 負荷の高いテストベンチで、ネイティブ `vvp`（-O2）の約 1.8 倍の実行時間。

## できないこと

- VHDL 入力（`vhdlpp` を移植していないため。`ivlpp` が `vhdlpp` を子プロセスで起動する作りなので、JS ドライバ側で段を足す必要があります）。
- `-t vvp` 以外のコード生成器（`-t null`, `-t vlog95` など）。必要なら同じ方法で `ivl` にリンクできます。
- `$system()`、ユーザー作成の VPI モジュール（`-m`）の動的読み込み、対話モード（`$stop` 後の入力は EOF 扱い）。
- `-y`（ライブラリ検索）と `-u`（ファイルごとのコンパイル単位）は、ネイティブでは `ivl` が `ivlpp` を子プロセスで
  起動して実現しています。WebAssembly の `ivl` 単体ではできないので、JS ドライバ（`libraryDirs`, `separateUnits`）で同じことをしています。
- 極端に深い再帰（巨大な式など）はブラウザのスタック上限に当たる可能性があります。
- 動作確認は Emscripten 3.1.6（Ubuntu パッケージ）のみ。新しい emsdk 向けの分岐（`STACK_SIZE` 名など）は
  スクリプトに入れてありますが、そちらでは未確認です。

## ライセンス

Icarus Verilog は GNU GPL version 2 以降です。`wasm/` 以下の追加ファイルも同じ条件（GPL-2.0-or-later）です。
ビルドした `.wasm/.js` をウェブで公開・配布する場合、それはオブジェクトコードの頒布にあたるので、
対応するソースコード（このパッチとビルドスクリプトを含む）を同じ場所から入手できるようにしてください。
