/*
 * Static module table for vvp in a WebAssembly build.
 *
 * There is no dlopen() in the browser, so the VPI modules are linked
 * into vvp. Each module's vlog_startup_routines[] table is compiled
 * under a module specific name (see build.sh) and listed here, so that
 * ivl_dlopen("system.vpi") / ivl_dlsym(..., "vlog_startup_routines")
 * in ivl_dlfcn.h find it.
 *
 * This file is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 */
# include  "config.h"
# include  <stdbool.h>
# include  "ivl_dlfcn.h"

typedef void (*startup_routine_t)(void);

extern startup_routine_t vlog_startup_routines_system[];
extern startup_routine_t vlog_startup_routines_vhdl_sys[];
extern startup_routine_t vlog_startup_routines_vhdl_textio[];
extern startup_routine_t vlog_startup_routines_v2005_math[];
extern startup_routine_t vlog_startup_routines_va_math[];
extern startup_routine_t vlog_startup_routines_v2009[];
extern startup_routine_t vlog_startup_routines_vpi_debug[];

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
VPI_MODULE(vpi_debug)

const struct ivl_static_module ivl_static_modules[] = {
      { "system",      system_symbols },
      { "vhdl_sys",    vhdl_sys_symbols },
      { "vhdl_textio", vhdl_textio_symbols },
      { "v2005_math",  v2005_math_symbols },
      { "va_math",     va_math_symbols },
      { "v2009",       v2009_symbols },
      { "vpi_debug",   vpi_debug_symbols },
      { 0, 0 }
};
