# תבליט

A browser app for designing parametric 3D-printable wall panels and exporting a print kit (3MF/STL plates, frame tiles, assembly map, fit test). It is tuned for a Prusa MK4.

- `src/`: the app source (engine.js, kit.js, ui.js, presets.js, style.css)
- `build.py`: bundles `src/` into `dist/index.html` (a single static page)
- `dist/`: the built site that Vercel serves (committed, so no build step is needed on Vercel)
- `test/`: node and Playwright checks (`npm install` first)

To update: edit `src/`, run `python3 build.py`, then commit and push. Vercel redeploys automatically.
