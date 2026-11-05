emscripten logo

Main project page: https://emscripten.org

Overview

Emscripten compiles C and C++ to WebAssembly using
LLVM and
Binaryen. Emscripten output can run
on the Web, in Node.js, and in
wasm runtimes.

Emscripten provides Web support for popular portable APIs such as OpenGL and
SDL2, allowing complex graphical native applications to be ported, such as
the Unity game engine
and Google Earth.
It can probably port your codebase, too!

While Emscripten mostly focuses on compiling C and C++ using
Clang, it can be integrated with other LLVM-using
compilers (for example, Rust has Emscripten integration, with the
wasm32-unknown-emscripten and asmjs-unknown-emscripten targets).

License

Emscripten is available under 2 licenses, the MIT license and the
University of Illinois/NCSA Open Source License.

Both are permissive open source licenses, with little if any
practical difference between them.

The reason for offering both is that (1) the MIT license is
well-known and suitable for a compiler toolchain, while
(2) LLVM's original license, the University of Illinois/NCSA Open Source
License, was also offered to allow Emscripten's code to be integrated
upstream into LLVM. The second reason became less important after
Emscripten switched to the LLVM wasm backend, at which point there
isn't any code we expect to move back and forth between the projects;
also, LLVM relicensed to Apache 2.0 + exceptions meanwhile. In practice you
can just consider Emscripten as MIT licensed (which allows
you to do pretty much anything you want with a compiler, including
commercial and non-commercial use).

See LICENSE for the full content of the licenses.
