# 3D Model Optimization Report

All PPF preview car models now load from optimized GLB files. Most models use Draco-compressed `scene.optimized.glb` files, and a few BMW/Mercedes models use `scene.fast.glb` compatibility files because they render more reliably with Three.js on mobile and avoid slow Draco decode stalls.

- Source format before: `.gltf` + `.bin` + texture folders
- Output format now: `scene.optimized.glb`
- Geometry compression: Draco
- Compatibility files: non-Draco GLB for selected BMW/Mercedes models
- Texture optimization: WebP, max 1024px
- Simplification: moderate decimation, preserving mesh/material names as much as possible
- Unneeded animations were removed from the BMW M4 files after they caused `GLTFLoader` parse errors.
- Old unoptimized `scene.gltf`, `scene.bin`, and `textures/` assets were removed from optimized model folders

## Summary

| Metric | Before | After |
| --- | ---: | ---: |
| Total optimized model set | 558.37 MB | 64.01 MB |
| Total GLB set used by project | 558.37 MB | 108.52 MB |
| Fast compatibility files | 0 MB | 44.53 MB |
| Largest compressed optimized model | 63.22 MB | 5.39 MB |
| Largest GLB used by project | 63.22 MB | 15.16 MB |
| Models optimized | 32 | 32 |
| Models over 10 MB after optimization | 0 | 0 |

Overall reduction: about 88.5%.
Including the compatibility files, the project still keeps about an 80.6% reduction from the original 3D assets.

## Largest Results

| Model | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| `skoda/modrang` | 63.22 MB | 3.96 MB | 93.7% |
| `skoda/models` | 58.87 MB | 2.48 MB | 95.8% |
| `skoda/mods` | 39.38 MB | 2.62 MB | 93.3% |
| `skoda/mc63` | 35.03 MB | 2.88 MB | 91.8% |
| `cupra/copraleon` | 34.10 MB | 2.32 MB | 93.2% |
| `audi/mod7` | 33.21 MB | 4.41 MB | 86.7% |
| `audi/mod8m` | 27.70 MB | 1.67 MB | 94.0% |
| `cupra/modcopra` | 26.88 MB | 2.03 MB | 92.5% |
| `audi/mod` | 23.51 MB | 1.45 MB | 93.8% |
| `seat/ford1` | 20.64 MB | 1.22 MB | 94.1% |

Full CSV report: `model-optimization-report.csv`

## Code Changes

- `ppf-preview.html` now references `scene.optimized.glb` files, with `scene.fast.glb` for BMW M4 and Mercedes models that needed a more compatible runtime format.
- Three.js / GLTFLoader / DRACOLoader / OrbitControls were updated from r128 to r147 to fix rendering errors from newer optimized GLB files.
- `DRACOLoader` remains enabled for Draco models.
- Loading overlay remains active while a model downloads.
- A fallback poster appears if a 3D model fails to load.
- Stale model loads are ignored, so rapidly switching cars will not keep old heavy models active.
- Previous model assets are disposed before the next car is displayed.

## Validation

All optimized GLB files passed `gltf-transform validate`.
