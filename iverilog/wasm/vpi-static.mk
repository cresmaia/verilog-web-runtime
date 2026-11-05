# Extra make rules for building the VPI modules for static linking.
# Each module defines a table named vlog_startup_routines[]; when several
# modules are linked into one executable those names would collide, so
# compile each table under a module specific name. wasm/static_modules_*.c
# refers to these names.
sys_table.o:    CPPFLAGS += -Dvlog_startup_routines=vlog_startup_routines_system
vhdl_table.o:   CPPFLAGS += -Dvlog_startup_routines=vlog_startup_routines_vhdl_sys
vhdl_textio.o:  CPPFLAGS += -Dvlog_startup_routines=vlog_startup_routines_vhdl_textio
v2005_math.o:   CPPFLAGS += -Dvlog_startup_routines=vlog_startup_routines_v2005_math
va_math.o:      CPPFLAGS += -Dvlog_startup_routines=vlog_startup_routines_va_math
v2009_table.o:  CPPFLAGS += -Dvlog_startup_routines=vlog_startup_routines_v2009
vpi_debug.o:    CPPFLAGS += -Dvlog_startup_routines=vlog_startup_routines_vpi_debug

# Print a make variable, e.g. "make print-O"
print-%:
	@echo $($*)
