/*
 * dup() for Emscripten builds of vvp.
 *
 * The LXT, LXT2 and FST writers (vpi/lxt_write.c, vpi/lxt2_write.c,
 * vpi/fstapi.c) write compressed sections through gzdopen(dup(fd)) and
 * expect the new descriptor to start at the current file offset, as the
 * POSIX dup() does. Emscripten's dup() reopens the file instead, and in
 * some versions the new descriptor starts at offset 0, which overwrites
 * the start of the file. Linking this file makes dup() carry the offset
 * over. (The writers seek to the end again after gzclose(), so a copied
 * rather than shared offset is enough.)
 *
 * This file is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation; either version 2 of the License, or (at your
 * option) any later version.
 */
#include <fcntl.h>
#include <unistd.h>

int dup(int fd)
{
      int nfd = fcntl(fd, F_DUPFD, 0);
      if (nfd >= 0) {
	    off_t pos = lseek(fd, 0, SEEK_CUR);
	    if (pos >= 0)
		  lseek(nfd, pos, SEEK_SET);
      }
      return nfd;
}
