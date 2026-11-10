#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
unset ELECTRON_RUN_AS_NODE
exec ./node_modules/.bin/electron .
