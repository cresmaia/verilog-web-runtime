# 検証結果

対象: upstream `1a23d1ffd` ＋ このパッチ、Emscripten 3.1.6（Ubuntu パッケージ, LLVM 15）、Node.js 22、
ヘッドレス Chromium（Playwright 1.56）。比較対象は同じコミットのネイティブビルド（gcc, `-O2`）。

## 1. 公式回帰テスト ivtest（ネイティブのドライバ ＋ WebAssembly の ivlpp/ivl/vvp）

`NODE_CLI=1 wasm/build.sh` で作った Node 用ビルドを、ネイティブの `iverilog` から `-B` で呼び出し、
`ivtest` の 2 つのランナーをそのまま実行しました。

```sh
# PATH に置くラッパー
iverilog:  exec <native>/bin/iverilog -B<build>/node-cli/lib/ivl "$@"
vvp:       exec <build>/node-cli/vvp "$@"
cd ivtest && perl vvp_reg.pl && python3 vvp_reg.py
```

| ランナー | ネイティブ | WebAssembly |
|---|---|---|
| `vvp_reg.pl`（3024 件） | 成功 3019、失敗 0 | 成功 2879、失敗 140 |
| `vvp_reg.py`（721 件） | 失敗 0 | 失敗 3 |

WebAssembly 側の失敗の内訳（すべて「子プロセスを起動する機能」）:

| 原因 | 件数 |
|---|---|
| VHDL（`ivlpp` が `vhdlpp` を起動する。`vhdlpp` は未移植） | 133 |
| `-u`（`ivl` がファイルごとに `ivlpp` を起動する） | 6＋2 |
| `-y`（`ivl` がライブラリファイルに `ivlpp` を起動する） | 1＋1 |

（件数は `vvp_reg.pl`＋`vvp_reg.py`）`-u` と `-y` は JS ドライバ（`separateUnits`, `libraryDirs`）で対応しており、
この 10 件はすべて JS ドライバ経由でネイティブと同じ出力になることを確認しています（下の 2. に含まれるもの＋個別確認 3 件）。
これらを除くと、すべてネイティブと同じ結果でした（LXT/LXT2/FST 出力のテストを含む。ivtest は波形ファイルの中身までは
比べないので、中身は 3. で別に確認）。

## 2. ブラウザと同じ経路（`iverilog-wasm.js`、メモリ上 FS）

`ivtest` の通常・コンパイルエラー・コンパイルのみのテスト（`regress-vlg/sv/ivl1.list` のうち、ドライバが扱う
オプション `-g -D -I -s -y -Y -u -Wall` と plusarg だけを使うもの）を、ネイティブ（`iverilog` + `vvp`）と
`iverilog-node.js --run` の両方で実行し、標準出力・標準エラーをファイルパスの表記だけ揃えて比較しました。

- 対象 2785 件: 一致 2784 件、不一致 1 件
- 不一致の 1 件は `simparam`（`$simparam` で CPU のワード長と作業ディレクトリを表示するテスト）。
  WebAssembly は 32 ビットで作業ディレクトリは `/work` なので、違って当然の箇所です。
- 比較では、ネイティブのドライバだけが出す 1 行（`errors compiling Verilog program.`）と `VCD info:` の行を除いています。

## 3. 個別に確かめたこと

- 符号付き/実数のシステム関数（`$random`, `$sqrt`, `$realtime`）: ネイティブと同じ値
  （`ivl` にも VPI モジュールをリンクしてあるため）。
- 波形ファイル（ブラウザ経路、カウンタのテストベンチ）: VCD は日付行以外、LXT と LXT2 はバイト単位でネイティブと一致。
  FST はヘッダーの日時（3 バイト）以外一致し、fstapi のリーダーで読み戻した階層・値変化も一致。
  ※ 1. で使ったテスト用の NODERAWFS ビルドでは LXT/LXT2/FST のファイルの中身が壊れます（NODERAWFS の `dup()` が
  ファイルを切り詰めて開き直すため）。ivtest の判定には影響せず、ブラウザ用ビルドにも関係しません。
- Shift_JIS の文字列を含むソース: `$display` の出力がバイト単位でネイティブと一致。
- ブラウザ（ヘッドレス Chromium）: デモでコンパイル＋実行、コンパイルエラーの表示、無限ループの Stop を確認。
  初回（wasm のコンパイル込み）約 0.3 秒、2 回目以降は小さな例で約 35 ms。
- 速度: 8 レーンの LFSR を 30 万クロック回すテストベンチで、ネイティブ `vvp` 2.0 秒に対して WebAssembly 3.6 秒（約 1.8 倍）。
- パッチを新しい clone（`1a23d1ffd`）に `git apply` し、`wasm/build.sh` だけでビルドできることを確認（2 コアで約 5 分）。
