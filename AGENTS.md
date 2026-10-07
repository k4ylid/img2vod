# FrameVOD

Windows desktop app (Electron + React + PixiJS) that turns still images into
motion videos (Ken Burns-style camera moves) and exports MP4 (720p/1080p,
16:9, 24/25/30/60 fps). No AI features.

## Commands

- `npm install` — install dependencies
- `npm run dev` — run the app in dev mode (electron-vite, HMR for renderer)
- `npm run build` — build main/preload/renderer into `out/`
- `npm run typecheck` — strict TS check of node-side and web-side code
- `npm test` — vitest unit tests for the pure evaluation engine (`src/shared`)
- `npm run smoke` — build + headless end-to-end export; writes
  `smoke-out/smoke-1080p30.mp4`, `smoke-out/smoke-720p25.mp4`, and
  `smoke-out/smoke-720p25-audio.mp4` (AAC audio track) and verifies them with
  ffprobe
- `npm run dist` — build + package a Windows NSIS installer into `dist/`
  (electron-builder; `dist/win-unpacked/` holds the unpacked app)

## Layout

- `src/main` — Electron main process: window, `fvod-file://` protocol, IPC,
  ffmpeg export pipeline, encoder detection, smoke-test entry
- `src/preload` — typed `contextBridge` API (`window.fvod`)
- `src/renderer` — React UI; `render/FrameRenderer.ts` is the single Pixi
  renderer shared by preview and export
- `src/shared` — pure TypeScript (no DOM/Node): project types + evaluation
  engine (`src/shared/engine`), unit-tested
- `scripts/smoke.mjs` — drives the packaged-app smoke test

## Conventions

- Camera model: `{cx, cy}` = view center in normalized image coords (0..1);
  `zoom = 1` means the whole image fits (contain) inside the 16:9 frame.
- Timeline: scenes play in order; a shot is `move` s of camera travel then
  `hold` s of rest (with optional microPush/drift).
- Anything that must behave identically in preview and export lives in
  `src/shared/engine` and stays deterministic (no `Math.random`).
