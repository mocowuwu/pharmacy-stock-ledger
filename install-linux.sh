#!/bin/sh
# Run from inside the pharmacy folder:
#
#   sh install-linux.sh
#
# No sudo. Everything goes in ~/pharmacy, including PostgreSQL, so nothing on
# the machine outside your home directory is touched. Override the location
# with PHARMACY_DIR=/srv/pharmacy sh install-linux.sh
#
# NOTE: written carefully but not run on Linux -- it was developed on a Mac.
# The macOS path is the tested one. Expect to fix something here; the installer
# stops with a sentence rather than half-finishing.

cd "$(dirname "$0")" || exit 1
. ./installer/bootstrap.sh
bootstrap "$@"
