# Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
CC ?= cc
CFLAGS ?= -std=c99 -O2 -Wall -Wextra -pedantic
# -ffp-contract=off: no fused multiply-add, so every platform rounds the way the JavaScript reference does
CFLAGS += -ffp-contract=off
OBJ = clio_motion.o clio_motion_ground.o clio_motion_body.o clio_motion_characters.o clio_motion_rig.o clio_motion_rigs.o

all: libclio_motion.a test

libclio_motion.a: $(OBJ)
	$(AR) rcs $@ $^

%.o: %.c clio_motion.h clio_motion_internal.h
	$(CC) $(CFLAGS) -c $< -o $@

test_kernel: test_kernel.c libclio_motion.a
	$(CC) $(CFLAGS) test_kernel.c libclio_motion.a -lm -o $@

test_ground: test_ground.c libclio_motion.a
	$(CC) $(CFLAGS) test_ground.c libclio_motion.a -lm -o $@

test_body: test_body.c libclio_motion.a
	$(CC) $(CFLAGS) test_body.c libclio_motion.a -lm -o $@

examples/live2d_svg: examples/live2d_svg.c libclio_motion.a
	$(CC) $(CFLAGS) -I. examples/live2d_svg.c libclio_motion.a -lm -o $@

test: test_kernel test_ground test_body examples/live2d_svg
	./test_kernel ../spec/kernel_vectors.txt
	./test_ground ../spec/ground/*.txt
	./test_body ../spec/body/*.txt

clean:
	rm -f *.o *.a test_kernel test_ground test_body examples/live2d_svg

.PHONY: all test clean
