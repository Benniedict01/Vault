# Fonts

Self-hosted variable fonts, originally from the `@fontsource-variable` packages:

- `space-grotesk-latin-wght-normal.woff2` — Space Grotesk (OFL 1.1)
- `dm-sans-latin-wght-normal.woff2` — DM Sans (OFL 1.1)
- `jetbrains-mono-latin-wght-normal.woff2` — JetBrains Mono (OFL 1.1)

Each file is the `latin` subset, `wght`-axis variable, normal style. They are
wired up in `app/layout.js` via `next/font/local`, so builds make no network
requests for fonts.
