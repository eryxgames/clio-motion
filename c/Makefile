# Copyright 2026 Daniel Sandner. Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
CC ?= cc
CFLAGS ?= -std=c99 -O2 -Wall -Wextra -pedantic
# -ffp-contract=off: no fused multiply-add, so every platform rounds the way the JavaScript reference does
CFLAGS += -ffp-contract=off

all: libclio_motion.a test

libclio_motion.a: clio_motion.o
	$(AR) rcs $@ $^

clio_motion.o: clio_motion.c clio_motion.h
	$(CC) $(CFLAGS) -c clio_motion.c -o $@

test_kernel: test_kernel.c libclio_motion.a
	$(CC) $(CFLAGS) test_kernel.c libclio_motion.a -lm -o $@

test: test_kernel
	./test_kernel ../spec/kernel_vectors.txt

clean:
	rm -f *.o *.a test_kernel

.PHONY: all test clean
