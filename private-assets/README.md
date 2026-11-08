# private-assets (gitignored)

Licensed or non-redistributable textures and packs go here. Vite serves this folder at `/` during development and excludes it from production builds.
Nothing in it is part of the library. Expected layouts (all optional, every module has a free fallback):

- `synty/vegetation/` — see SYNTY.md for the prepared pack layout.
- `water/` — the flipbook sheets named in OCEAN_SHEET_FILES (mist_sheet.webp, splashes_sheet.webp, …) and Droplet.png.
- `weather/` — optional override of the bundled free set: cirrus.png, moon.png, stars.png, galaxy.jpg, enviro-cloud-base-64.rgba, enviro-cloud-detail-32.rgba
  (the bench passes `assetBaseUrl: '/weather/'` when `weather/cirrus.png` is present).
