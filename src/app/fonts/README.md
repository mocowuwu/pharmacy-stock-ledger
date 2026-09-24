# Bundled fonts

Served from here rather than fetched from Google Fonts at build time. Every
install and every update runs `next build` on the pharmacy's own machine, and
with `next/font/google` that build failed outright whenever the clinic's
connection could not reach fonts.googleapis.com -- which, during testing on a
slow link, it could not.

Both are the upstream variable fonts from github.com/google/fonts, converted to
woff2 unchanged (no subsetting), under the SIL Open Font License 1.1 -- see the
OFL files beside them.

| File | Family | Axis |
| --- | --- | --- |
| `PlusJakartaSans-Variable.woff2` | Plus Jakarta Sans | wght 200–800 |
| `GeistMono-Variable.woff2` | Geist Mono | wght 100–900 |
