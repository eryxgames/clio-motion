# Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
CC ?= cc
CFLAGS ?= -std=c99 -O2 -Wall -Wextra -pedantic
# -ffp-contract=off: no fused multiply-add, so every platform rounds the way the JavaScript reference does
override CFLAGS += -ffp-contract=off
OBJ = clio_motion.o clio_motion_ground.o clio_motion_body.o clio_motion_characters.o clio_motion_rig.o clio_motion_rigs.o clio_motion_api.o
SRC = $(OBJ:.o=.c)

# The library for programs that load it at run time (Python, C#, an engine's extension): make shared
UNAME := $(shell uname -s 2>/dev/null)
ifeq ($(OS),Windows_NT)
  SHLIB := build/clio_motion.dll
  SHARED := -shared
else ifeq ($(UNAME),Darwin)
  SHLIB := build/libclio_motion.dylib
  SHARED := -dynamiclib -install_name @rpath/libclio_motion.dylib
else
  SHLIB := build/libclio_motion.so
  SHARED := -shared
endif

all: libclio_motion.a test

libclio_motion.a: $(OBJ)
	$(AR) rcs $@ $^

%.o: %.c clio_motion.h clio_motion_internal.h
	$(CC) $(CFLAGS) -DCM_STATIC -c $< -o $@

shared: $(SHLIB)

$(SHLIB): $(SRC) clio_motion.h clio_motion_internal.h
	@mkdir -p build
	$(CC) $(CFLAGS) -fPIC -fvisibility=hidden -DCM_BUILD $(SHARED) -o $@ $(SRC) $(LDFLAGS) -lm

test_kernel: test_kernel.c libclio_motion.a
	$(CC) $(CFLAGS) -DCM_STATIC test_kernel.c libclio_motion.a -lm -o $@

test_ground: test_ground.c libclio_motion.a
	$(CC) $(CFLAGS) -DCM_STATIC test_ground.c libclio_motion.a -lm -o $@

test_body: test_body.c libclio_motion.a
	$(CC) $(CFLAGS) -DCM_STATIC test_body.c libclio_motion.a -lm -o $@

examples/live2d_svg: examples/live2d_svg.c libclio_motion.a
	$(CC) $(CFLAGS) -DCM_STATIC -I. examples/live2d_svg.c libclio_motion.a -lm -o $@

test_api: test_api.c libclio_motion.a
	$(CC) $(CFLAGS) -DCM_STATIC test_api.c libclio_motion.a -lm -o $@

test: test_kernel test_ground test_body test_api examples/live2d_svg
	./test_kernel ../spec/kernel_vectors.txt
	./test_ground ../spec/ground/*.txt
	./test_body ../spec/body/*.txt
	./test_api

clean:
	rm -f *.o *.a test_kernel test_ground test_body test_api examples/live2d_svg
	rm -rf build

.PHONY: all test clean shared
