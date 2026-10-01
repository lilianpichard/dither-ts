<p align="center">
  <img src="assets/dither_logo_light.webp" alt="dither-ts" width="320">
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/dither-ts"><img alt="npm version" src="https://img.shields.io/npm/v/dither-ts?label=npm"></a>
  <a href="https://github.com/lilianpichard/dither-ts/actions/workflows/ci.yml"><img alt="ci" src="https://github.com/lilianpichard/dither-ts/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/lilianpichard/dither-ts/releases"><img alt="release" src="https://img.shields.io/github/v/release/lilianpichard/dither-ts?label=release"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/badge/license-GPL--3.0--only-blue"></a>
</p>

<p align="center">Dither images and video. Runs entirely on your machine.</p>

<!-- TODO: hero gif. Drop a photo, watch the preview fill in with a dithered
     frame, switch method once or twice. About six seconds, no audio. -->

## Install

```sh
npm install dither-ts
```

Desktop builds for macOS, Windows and Linux are on the
[releases page](https://github.com/lilianpichard/dither-ts/releases).

## What It Does

- 24 dithering methods, from ordered matrices to error diffusion
- 11 palettes, or bring your own
- effects you can stack: glow, blur, sharpen, scanlines, grain and more
- images and video, out to png, jpg, svg, txt, gif or mp4
- presets to save, share and re-import
- nothing is uploaded, it works offline

There is a browser app to try it in and a desktop app to install.

## Developing

```sh
npm install
npm --prefix app install
npm --prefix electron install

npm run dev       # browser app, http://localhost:5173
npm run desktop   # desktop app
npm run verify    # tests, lint, build
```

<!-- TODO: three short gifs, one per flow: dither a photo, save and reuse a
     preset, export a gif. Six seconds each, no audio. -->

## Contributing

Small project, issues and pull requests welcome. If you want to help, read the
[contributing guide](CONTRIBUTING.md) first.

## Origin

Built after [Dither Guy](https://github.com/manoelpiovesan/dither-guy) by
manoelpiovesan. Its presets, its ideas and its filters are what this started
from.

## License

[GPL-3.0-only](LICENSE).
