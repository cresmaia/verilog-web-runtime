/* Emscripten 3.1.6 + LLVM 15 workaround: clang names main(argc, argv)
   "__main_argc_argv", but this old Emscripten's callMain() looks for an
   export named "main". Re-export it under that name. */
extern int __main_argc_argv(int argc, char**argv);
__attribute__((export_name("main"), used))
int ivl_wasm_main_shim(int argc, char**argv) { return __main_argc_argv(argc, argv); }
