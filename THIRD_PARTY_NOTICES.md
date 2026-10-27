# Third-Party Notices

VEIL bundles the following third-party software and model assets so that runtime processing can remain same-origin and offline-capable. Versions are pinned in `pnpm-lock.yaml`.

## Runtime

| Component | Version | License | Purpose |
| --- | --- | --- | --- |
| Tesseract.js | 6.0.1 | Apache-2.0 | Browser OCR runtime |
| tesseract.js-core | 6.1.2 | Apache-2.0 | WebAssembly OCR core |
| `@tesseract.js-data/eng` | 1.0.0 | MIT package metadata; upstream tessdata terms apply | English trained data |
| `@tesseract.js-data/chi_sim` | 1.0.0 | MIT package metadata; upstream tessdata terms apply | Simplified Chinese trained data |
| TensorFlow.js | 4.22.0 | Apache-2.0 | Local model runtime |
| BlazeFace model / TFJS models | 0.1.0 | Apache-2.0 | Local face detection |
| jsQR | 1.4.0 | Apache-2.0 | Local QR decoding |
| Lucide | Bundled | ISC | Interface icons |

## Development

| Component | Version | License | Purpose |
| --- | --- | --- | --- |
| `qrcode` | 1.5.4 | MIT | Generating the synthetic demo QR image |
| `playwright-core` | 1.64.1 | Apache-2.0 | Optional browser smoke test |

## License Files

- [Tesseract.js](licenses/tesseract-js-LICENSE.txt)
- [tesseract.js-core](licenses/tesseract-core-LICENSE.txt)
- [Tesseract trained data](licenses/eng-data-LICENSE.txt)
- [Chinese trained data](licenses/chi_sim-data-LICENSE.txt)
- [TensorFlow.js / BlazeFace](licenses/tensorflow-Apache-2.0.txt)
- [jsQR](licenses/jsqr-LICENSE.txt)
- [Lucide](licenses/lucide-LICENSE)

Apache-2.0 license texts are included in the repository. No endorsement by the upstream projects is implied.

## Asset Provenance

- `assets/models/blazeface/` is the pretrained BlazeFace model distributed through `@tensorflow-models/blazeface`.
- `assets/vendor/tesseract/*.traineddata.gz` originates from the Tesseract.js data packages and the Tesseract tessdata ecosystem.
- `assets/vendor/tesseract/tesseract-core-*-lstm.wasm.js` originates from `tesseract.js-core`.
- `assets/vendor/tf.min.js` and `assets/vendor/blazeface.min.umd.js` are unmodified package distribution files.
- `assets/vendor/jsqr.js`, `assets/vendor/tesseract.min.js`, `assets/vendor/tesseract/worker.min.js`, and `assets/lucide.min.js` are vendored package distribution files.

For a production redistribution, review the upstream license and NOTICE requirements for the exact vendored versions and trained-data provenance.
