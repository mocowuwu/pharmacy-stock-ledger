#!/bin/sh
# Renders the legacy launcher PNGs from the SVGs here. Needs rsvg-convert
# (brew install librsvg).
set -e
cd "$(dirname "$0")"
res=../android/app/src/main/res
for pair in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  d=${pair%%:*}; px=${pair##*:}
  rsvg-convert -w "$px" -h "$px" icon-square.svg -o "$res/mipmap-$d/ic_launcher.png"
  rsvg-convert -w "$px" -h "$px" icon-round.svg -o "$res/mipmap-$d/ic_launcher_round.png"
done
rsvg-convert -w 512 -h 512 icon-fullbleed.svg -o icon-512.png
