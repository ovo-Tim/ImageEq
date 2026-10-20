# Image EQ

**Live:** https://ovo-tim.github.io/ImageEq/

A pure-frontend spectral equalizer for images. It runs a 2D FFT on the picture, maps spatial frequencies onto a GarageBand-style EQ curve, and lets you drag eight bands to shape which image structures survive. Everything runs in the browser; there is no build step, backend, or dependency.


Levels are linear percentages: **100% = unchanged, 0% = remove, 150% = maximum boost**.

## Base planes

The control points follow one of two base planes, selected with the **Base: Zero / Flat** switch in the EQ footer:

- **Flat (100%)** — the curve starts at 100%. Each point is a local deviation from 100%:
  `curve(f) = 100 + Σ (levelᵢ − 100) × shapeᵢ(f)`.
  All bands at 100% reproduce the original image. A point resting at 100% contributes nothing, so it cannot pull on a neighbouring band's bell.
- **Zero (0%)** — the curve starts at 0%. Each point adds its own local contribution:
  `curve(f) = Σ levelᵢ × shapeᵢ(f)`.
  All bands at 0% produce black. Raise a single point to isolate just that frequency band.

`shapeᵢ(f)` is the band's own 0…1 bell/shelf response. Points sitting on the base plane are neutral by definition, which is why the selected green band keeps a clean curve even when other points are nearby.

The app opens on **Flat** with the original image.

## Frequency range

The footer **Range** button opens a small panel with `From` / `To` inputs (20–20 000 Hz). The eight control points are redistributed across the chosen span while keeping their relative positions; the axis labels, ticks, and frequency readouts follow. Drag range is clamped to the chosen span. `Full 20–20k` restores the full range.

The range is a control/display span, not a hard band-pass: band shapes can still have small tails just outside it. It persists across presets and images during the session, and resets to 20–20k on reload.

## Presets

| Preset | What it does |
| --- | --- |
| **Flat** | Base 100%, all bands at 100%. Original image (default). |
| **Zero** | Base 0%, all bands at 0%. Black output; ideal for isolating one band. |
| Clarity | Subtle high-frequency lift and detail. |
| Warm | Low-frequency lift with a softer top end. |
| Crisp | Stronger upper-mid/high texture. |
| Punch | Boosted lows and highs, scooped mids. |
| Dreamy | Softened highs and a gentler low end. |
| Faded | A reversed, muted curve. |
| Custom | Shown after any manual edit. |

## Controls

- **Drag a node** — vertical changes level, horizontal changes center frequency.
- **⌘/Ctrl + drag** — constrain the drag to one axis.
- **Scroll** over the graph — change the selected band's Q (width).
- **Drag the shaded band's side lines** — change Q only.
- **Click a band icon** — select that band.
- **Click empty graph space** — deselect.
- **Base: Zero / Flat** — switch control-point logic and reset the bands to that plane.
- **Range** — set the custom EQ frequency span.
- **Power / B** — bypass, showing the original image.
- **Drag the divider** in the preview — compare original (left) with processed (right).
- **Open Image / drop / paste** — load another image.
- **Export PNG** — render the current curve at up to 2048 px, preserving alpha.

## Run locally

Browsers block Web Workers on `file://`, so serve the folder over HTTP:

```bash
cd ImageEq
python3 -m http.server 8000
# open http://localhost:8000
```

Any static server works (`npx serve`, VS Code Live Server, etc.).

## How it works

- Each RGB channel is FFT'd independently, with three Web Workers running in parallel.
- The image is fitted into a 512×512 square using mirrored edge padding, avoiding hard seams at the FFT boundary.
- The mean is removed before the forward transform. The complex spectrum is cached; changing the curve only re-applies the radial gain table and runs the inverse FFT.
- DC (the mean) is scaled by the lowest-frequency gain, so a 0% Zero plane produces true black instead of a flat average color. The gain table stores linear amplitude multipliers from 0 to 1.5.
- Eight bands cover the log frequency axis: a low shelf, six bells, and a high shelf. The displayed/control range is independent of the full FFT radial mapping; changing it recalculates the eight absolute frequencies while keeping their relative positions.
- The frequency labels are a logarithmic mapping of spatial frequency, not real audio frequencies. Radial distance from DC to Nyquist is normalized to 0–1 and labelled `f = 20 × 1000^r`; "1 kHz" therefore means roughly 57% of the Nyquist radius.
- The live preview is 512². PNG export picks 512/1024/2048 based on the source image (longest side rounded up to a power of two, capped at 2048) and renders in temporary workers so the live preview is not disturbed.

## Deployment

Every push to `main` runs `.github/workflows/pages.yml` and publishes the site through GitHub Pages. The workflow copies only the static files into the Pages artifact and adds `.nojekyll`.

## Files

```
index.html         app markup
styles.css         full-screen dark UI
js/fft.js          radix-2 complex FFT + 2D helpers
js/fft-worker.js   per-channel spectrum cache and re-render
js/eq.js           eight-band EQ model, presets, base planes, ticks
js/pipeline.js     three-worker preview pipeline + high-resolution export
js/curve-ui.js     curve drawing and pointer editing
js/app.js          image loading, preview compositing, export, events
.github/workflows/pages.yml  GitHub Pages deployment
favicon.svg
```

Verified in Chrome at desktop, tablet, and 390 px mobile widths: Zero exports pure black, Flat round-trips the FFT pixel-for-pixel, a single raised point leaves the rest of the curve on its base, and transparent PNG export preserves alpha.
