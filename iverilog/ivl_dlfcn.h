/*
 * NOTICE OF CHANGES (GNU General Public License version 2, section 2(a))
 *
 * This file differs from the file of the same name in upstream Icarus Verilog
 * (https://github.com/steveicarus/iverilog, commit 1a23d1ffdbff2192b5d43c57711a0e9e67b7bbbc).
 *
 * What was changed: Added a static-module mode (IVL_STATIC_MODULES, selected automatically for
 *   Emscripten and WASI) in which ivl_dlopen()/ivl_dlsym()/ivl_dlclose()/dlerror()
 *   look names up in a table (ivl_static_modules[]) instead of loading shared objects.
 *
 * Date of the change: on or before 2026-09-22. The change is the one in patches/iverilog-wasm.patch
 *   of the repository cresmaia/verilog-web-runtime (the WebAssembly patch).
 * This notice was added on 2026-10-19 by Cresmaia Inc.
 * The next line, #line 1, makes the compiler number the lines of the rest of this file
 * as it did before this notice was added, so that __LINE__ and assert messages do not change.
 */
#line 1
#ifndef IVL_ivl_dlfcn_H
#define IVL_ivl_dlfcn_H
/*
 * Copyright (c) 2001-2026 Stephen Williams (steve@icarus.com)
 *
 *    This source code is free software; you can redistribute it
 *    and/or modify it in source code form under the terms of the GNU
 *    General Public License as published by the Free Software
 *    Foundation; either version 2 of the License, or (at your option)
 *    any later version.
 *
 *    This program is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU General Public License for more details.
 *
 *    You should have received a copy of the GNU General Public License
 *    along with this program; if not, write to the Free Software
 *    Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.
 */

/*
 * Static module builds (WebAssembly: Emscripten or WASI) have no dynamic
 * loader. The code generator (vvp.tgt) and the VPI modules (system.vpi,
 * ...) are linked into the executable instead, and each program provides
 * a table, ivl_static_modules[], that maps a module name to its entry
 * points. ivl_dlopen()/ivl_dlsym() below look the names up in that table.
 */
#if !defined(IVL_STATIC_MODULES) && (defined(__EMSCRIPTEN__) || defined(__wasi__))
# define IVL_STATIC_MODULES 1
#endif

#if defined(IVL_STATIC_MODULES)
# include  <string.h>
struct ivl_static_symbol {
      const char*name;
      void*addr;
};
struct ivl_static_module {
      const char*name;
      const struct ivl_static_symbol*symbols;
};
#if defined(__cplusplus)
extern "C" {
#endif
extern const struct ivl_static_module ivl_static_modules[];
#if defined(__cplusplus)
}
#endif
typedef const struct ivl_static_module* ivl_dll_t;

#elif defined(__MINGW32__)
# include <windows.h>
#if defined(__cplusplus)
# include <cstdio>
#else
# include <stdio.h>
#endif
typedef void * ivl_dll_t;
#elif defined(HAVE_DLFCN_H)
# include  <dlfcn.h>
typedef void* ivl_dll_t;
#elif defined(HAVE_DL_H)
# include  <dl.h>
typedef shl_t ivl_dll_t;
#endif

#if defined(IVL_STATIC_MODULES)
/*
 * Match on the base name without directory or suffix, so that
 * "/some/dir/system.vpi", "system.vpi" and "system" all find the
 * "system" module, and "vvp.tgt" finds the "vvp" code generator.
 */
static inline ivl_dll_t ivl_dlopen(const char*name, bool global_flag)
{
      (void)global_flag;
      const char*base = name;
      for (const char*cp = name ;  *cp ;  cp += 1) {
	    if (*cp == '/' || *cp == '\\') base = cp + 1;
      }
      size_t len = strlen(base);
      const char*dot = strrchr(base, '.');
      if (dot && (strcmp(dot, ".vpi") == 0 || strcmp(dot, ".vpl") == 0 ||
                  strcmp(dot, ".tgt") == 0))
	    len = dot - base;

      for (ivl_dll_t mod = ivl_static_modules ;  mod->name ;  mod += 1) {
	    if (strlen(mod->name) == len && strncmp(mod->name, base, len) == 0)
		  return mod;
      }
      return 0;
}

static inline void* ivl_dlsym(ivl_dll_t dll, const char*nm)
{
      if (dll == 0) return 0;
      for (const struct ivl_static_symbol*sym = dll->symbols ;  sym->name ;  sym += 1) {
	    if (strcmp(sym->name, nm) == 0) return sym->addr;
      }
	/* Not found? try without the leading _ */
      if (nm[0] == '_') return ivl_dlsym(dll, nm+1);
      return 0;
}

static inline void ivl_dlclose(ivl_dll_t dll)
{ (void)dll; }

static inline const char*dlerror(void)
{ return "module is not linked into this static (WebAssembly) build"; }

#elif defined(__MINGW32__)
static inline ivl_dll_t ivl_dlopen(const char *name, bool global_flag)
{
      static char full_name[4096];
      unsigned long length = GetFullPathName(name, sizeof(full_name),
                                             full_name, NULL);
      if ((length == 0) || (length > sizeof(full_name)))
            return 0;

      (void)global_flag;

      return (void *)LoadLibrary(full_name);
}

static inline void *ivl_dlsym(ivl_dll_t dll, const char *nm)
{ return (void *)GetProcAddress((HINSTANCE)dll,nm);}

static inline void ivl_dlclose(ivl_dll_t dll)
{ (void)FreeLibrary((HINSTANCE)dll);}

static inline const char *dlerror(void)
{
  static char msg[256];
  unsigned long err = GetLastError();
  FormatMessage(
		FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
		NULL,
		err,
		MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT), // Default language
		(LPTSTR) &msg,
		sizeof(msg) - 1,
		NULL
		);
  return msg;
}

#elif defined(HAVE_DLFCN_H)
static inline ivl_dll_t ivl_dlopen(const char*name, bool global_flag)
{ return dlopen(name,RTLD_LAZY|(global_flag?RTLD_GLOBAL:0)); }

static inline void* ivl_dlsym(ivl_dll_t dll, const char*nm)
{
      void*sym = dlsym(dll, nm);
	/* Not found? try without the leading _ */
      if (sym == 0 && nm[0] == '_')
	    sym = dlsym(dll, nm+1);
      return sym;
}

static inline void ivl_dlclose(ivl_dll_t dll)
{ dlclose(dll); }

#elif defined(HAVE_DL_H)
static inline ivl_dll_t ivl_dlopen(const char*name, bool global_flag)
{
      (void)global_flag;

      return shl_load(name, BIND_IMMEDIATE, 0);
}

static inline void* ivl_dlsym(ivl_dll_t dll, const char*nm)
{
      void*sym;
      int rc = shl_findsym(&dll, nm, TYPE_PROCEDURE, &sym);
      return (rc == 0) ? sym : 0;
}

static inline void ivl_dlclose(ivl_dll_t dll)
{ shl_unload(dll); }

static inline const char*dlerror(void)
{ return strerror( errno ); }
#endif

#endif /* IVL_ivl_dlfcn_H */
