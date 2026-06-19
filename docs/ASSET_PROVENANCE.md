# Asset Provenance

Generated background PNGs were created specifically for this project in the Codex image generation session on 2026-06-18, then optimized for release with `npm run optimize:images`. No uploaded reference images, trademarks, copyrighted characters, or third-party source images were used as inputs. Exact long-form generation prompts were not preserved in the repository; this file records the retained source PNG hashes and shipped WebP hashes.

Optimization settings:

- Source directory in the development workspace, not shipped in release archives: `release_backups/source_png_before_webp_20260618/`
- Source WebP output directory: `public/assets/images/`
- Shipped WebP path in release builds: `dist/assets/images/`
- Size: `1200x800`
- Format: WebP
- Quality: `82`
- Tool: Sharp via `scripts/optimize-images.mjs`
- Optimization date: 2026-06-18

| Asset | Source PNG Bytes | Source PNG SHA-256 | WebP Bytes | WebP SHA-256 |
| --- | ---: | --- | ---: | --- |
| `break-room.webp` | 2438439 | `4c031037c6ba3d791d55724e13fd536f3fbcdc8689ee7397ee5089605ffa6ff7` | 89676 | `24f64f4185eb527f2421c277d84f1f5b633cdfa9eaf71d2e3cebc8a5203e6fbf` |
| `clock-hall.webp` | 2622863 | `1a8f2106857bc95e69cad0b9da11eb8569d1cf6816d189510c538cf0f069bb20` | 106982 | `d9f50078be1e43202456392aef93a85b21f84948beb5eed79ea61ae44c01f611` |
| `ending-dawn.webp` | 2433851 | `b893688137f72b281cf83ac2d50f56d22d57b806b774ca7fac3151ac7e74d3df` | 107450 | `e4cd4aa20fec903581a893efc18438acfdb6be12096a193acbbd86f6dd6c49c7` |
| `interrogation-booth.webp` | 2569946 | `55a73212960df14c9fa675193b5234a066b1511257c6d6dec6576a4b150acbdf` | 93230 | `3ec0ddc13111d160cbf5ca47e37897a743c2823419ac74649275cea3e6057548` |
| `mirror-server.webp` | 2282584 | `3f12c766c152235afd9d6d6ca5190a0cb753e190b249bd1a65b9691ba66e6ec7` | 84638 | `bc47383f14b648ad7d68633f94e1edc0424b05bf2e78d41d26aa2a1b9d9e8507` |
| `reception.webp` | 2293174 | `a028ef399fad1d7858e32bb8f8a49182c9fa430a48fab35483fd06e610c4430c` | 80648 | `ee365a07b5c4eba335b1d1bfb956aa06267b7695aaded71fb3638f26f6e8b789` |
| `records-archive.webp` | 2518663 | `2949c02fe9302e199803dc4d38ef989af5a187d8425153b00c090bb6b6adfcf1` | 108678 | `2cddb9ba22e58a7f6efaed5a04020cf982210ae8b610565bb6c1e3ca89b12992` |
| `security-office.webp` | 2270961 | `a6d9404350f86e12b80f6dba8a46fdd78dd8cb775712b4faaab0fc88925b68f6` | 82166 | `8a278d187a79d0f4b3a35b8e8d7b7158ba217b9e3f97c8c0544b2b4db83de9bd` |
| `title-department.webp` | 2133705 | `d51a77997f73669f1c0169d082841dc4f6b3fc00c22eaa41bdb532ceb905a65c` | 75260 | `3b5debd9e44d3b4fc47f4ddff96f2a44edfc8f370476832aa551c130f52fddbb` |

Audio provenance and third-party license files are tracked in `ASSETS.md`. Source audio lives under `public/assets/audio/ui/`; release builds ship it under `dist/assets/audio/ui/`.
