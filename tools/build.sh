#!/bin/sh
# Copies the shared business rules into the Apps Script project. Run after any change to assets/core.js.
set -e
cd "$(dirname "$0")/.."
{ echo "// GENERATED from assets/core.js by tools/build.sh. Do not edit here: edit assets/core.js and rebuild."; cat assets/core.js; } > apps-script/Core.gs
echo "apps-script/Core.gs updated"
