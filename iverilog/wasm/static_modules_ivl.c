/*
 * Static module table for ivl (the compiler) in a WebAssembly build.
 *
 * ivl normally dlopen()s the code generator (vvp.tgt) and also the VPI
 * modules, whose vlog_startup_routines[] it runs against stub VPI
 * functions to learn the return types of system functions ($random is
 * signed, $realtime/$sqrt are real, ...). With no dlopen() in the
 * browser, all of them are linked into ivl and listed here.
 *
 * This file is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 */
# include  "config.h"
# include  <stdbool.h>
# include  "ivl_target.h"
# include  "ivl_dlfcn.h"

/* tgt-vvp entry points */
extern int target_design(ivl_design_t des);
extern const char* target_query(const char*key);

static const struct ivl_static_symbol vvp_tgt_symbols[] = {
      { "target_design", (void*)target_design },
      { "target_query",  (void*)target_query },
      { 0, 0 }
};

typedef void (*startup_routine_t)(void);

extern startup_routine_t vlog_startup_routines_system[];
extern startup_routine_t vlog_startup_routines_vhdl_sys[];
extern startup_routine_t vlog_startup_routines_vhdl_textio[];
extern startup_routine_t vlog_startup_routines_v2005_math[];
extern startup_routine_t vlog_startup_routines_va_math[];
extern startup_routine_t vlog_startup_routines_v2009[];

#define VPI_MODULE(n) \
      static const struct ivl_static_symbol n##_symbols[] = { \
	    { "vlog_startup_routines", (void*)vlog_startup_routines_##n }, \
	    { 0, 0 } \
      };

VPI_MODULE(system)
VPI_MODULE(vhdl_sys)
VPI_MODULE(vhdl_textio)
VPI_MODULE(v2005_math)
VPI_MODULE(va_math)
VPI_MODULE(v2009)

const struct ivl_static_module ivl_static_modules[] = {
      { "vvp",         vvp_tgt_symbols },
      { "system",      system_symbols },
      { "vhdl_sys",    vhdl_sys_symbols },
      { "vhdl_textio", vhdl_textio_symbols },
      { "v2005_math",  v2005_math_symbols },
      { "va_math",     va_math_symbols },
      { "v2009",       v2009_symbols },
      { 0, 0 }
};
