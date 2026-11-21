#!/usr/bin/env bash
# Builds docs/, the folder GitHub Pages serves at bradcowdrey.com/golden-hour, from web/.
# docs/ is web/ with the version stamped into app.js and sw.js; never edit docs/ by hand.
# docs/SPEC.md (the plan and spec) lives beside it and is left alone.
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(tr -d ' \n' < VERSION)"
mkdir -p docs
rm -rf docs/vendor docs/fonts
cp -R web/vendor web/fonts docs/
cp web/index.html web/app.css web/core.js web/manifest.webmanifest web/icon.svg web/icon.png web/cities.tsv docs/
sed "s/__VERSION__/$VERSION/g" web/app.js > docs/app.js
sed "s/__VERSION__/$VERSION/g" web/sw.js > docs/sw.js
touch docs/.nojekyll
echo "Built docs/ at version $VERSION"
