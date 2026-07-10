# opus-recorder (vendored)

`encoderWorker.min.js` is the Ogg/Opus encoder worker from
[opus-recorder](https://github.com/chris-rudmin/opus-recorder) v8.0.5
(npm `opus-recorder@8.0.5`, MIT — see LICENSE.md). It is an emscripten
build of libopus + speexdsp with the WASM binary inlined as base64, so it
is a single self-contained file: no CDN, no separate .wasm fetch, and it
works offline once the service worker has cached it.

Neiro uses it headless (no microphone involved) to compress rendered MIX
buffers before they are saved to the feed — see `js/opus-encoder.js`.
The same file is loaded two ways:

- Browser: as a classic `Worker`, driven with the message protocol
  `init` → `getHeaderPages` → `encode`* → `done`.
- Node (tests): `require()`d directly — the file exports
  `{ Module, OggOpusEncoder }` for CommonJS consumers.

To upgrade: replace `encoderWorker.min.js` and `LICENSE.md` from the new
package's `dist/`, update the version above, and re-run the tests
(`node --test tests/*.test.mjs`), which encode real audio through this
file and will catch protocol changes.
