#!/bin/sh
# Double-click this in Finder.
#
# macOS will refuse the first time, because the file was downloaded rather than
# written here: right-click it and choose Open, or run
#   xattr -d com.apple.quarantine install-macos.command
# once. That warning is Gatekeeper doing its job; it says nothing about whether
# this script is safe, only that Apple has not been paid to vouch for it.
#
# Installs into ~/pharmacy unless PHARMACY_DIR says otherwise.

cd "$(dirname "$0")" || exit 1
. ./installer/bootstrap.sh
bootstrap "$@"
