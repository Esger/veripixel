#!/usr/bin/env bash
set -e

EXTENSION_NAME="veripixel"
VERSION=$(node -p "require('./manifest.json').version")
OUTPUT="${EXTENSION_NAME}-v${VERSION}.zip"

echo "Building production bundle..."
npm run build

echo "Packaging $OUTPUT..."
rm -f "$OUTPUT"
export COPYFILE_DISABLE=1
(cd dist && zip -r -X "../$OUTPUT" . -x "*.DS_Store" -x "*__MACOSX*" -x "*/__MACOSX/*" -x "._*")

echo "Successfully packaged: $OUTPUT ($(du -h "$OUTPUT" | cut -f1 | tr -d ' '))"
