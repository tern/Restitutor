# Electron Wayland baseline for Omarchy

Research date: 2026-09-20

## Decision summary

Restitutor should not ship its current Electron 29.4.6 runtime as the Omarchy baseline. Electron 29 reached end of life on 2024-08-20 and embeds Chromium 122.0.6261.156. For a maintained Omarchy release, use a currently supported Electron major and require **Electron 42 or newer** at implementation time; **Electron 44 is the preferred first upgrade target** because it is the newest stable release on the research date. Re-evaluate the exact major immediately before implementation because Electron supports only the latest three stable majors.

For Electron 38.2 and newer, let Electron select native Wayland from `XDG_SESSION_TYPE=wayland`; retain `--ozone-platform=x11` as an explicit troubleshooting fallback. Do not make undocumented Chromium GPU switches part of the production launcher without measurements. Remove the existing development-only `--in-process-gpu` and Linux-irrelevant `--disable-direct-composition` from the proposed baseline, then validate GPU state and rendering on the target Omarchy machine.

## Confirmed facts

### Runtime and lifecycle

- `packages/electron/package.json` pins Electron `29.4.6`. Its `start` script adds `--in-process-gpu --disable-direct-composition`.
- Electron's release catalog identifies 29.4.6 as Chromium 122.0.6261.156 with Node.js 20.9.0. Electron's official schedule dates Electron 29 end of life to 2024-08-20. Electron 32's release notice explicitly says 29.x had reached end of support.
- On 2026-09-20, the schedule makes 42, 43, and 44 the supported stable majors. Electron 44 became stable on 2026-08-25; Electron 42 remains supported until 2026-10-20. Consequently, 42 is only a minimum migration floor, not a long-lived pin.

Sources: [Electron 29 releases](https://releases.electronjs.org/release?channel=stable&major=v29), [Electron release schedule](https://releases.electronjs.org/schedule), [Electron 32 release notice](https://releases.electronjs.org/release/v32.0.0), [`packages/electron/package.json`](../../packages/electron/package.json).

### Native Wayland and XWayland

- Electron 38 changed `--ozone-platform`'s default to `auto`, removed `ELECTRON_OZONE_PLATFORM_HINT`, and uses native Wayland when `XDG_SESSION_TYPE=wayland`. A startup fix making that selection effective shipped in 38.2.0. Electron's own retrospective therefore describes native Wayland as working out of the box in Electron 38.2 and newer.
- Before that baseline, Chromium Ozone supports `--ozone-platform=wayland` for native Wayland and an `auto` hint that selects Wayland when available, otherwise X11. Arch's Electron guidance likewise says releases before 38.2 need `--ozone-platform=auto`/`wayland` or `ELECTRON_OZONE_PLATFORM_HINT`.
- Electron documents `--ozone-platform=x11` as the escape hatch where Wayland's security model prevents programmatic window positioning, focusing, or post-creation resizing. Under a Wayland desktop, that X11 backend runs via XWayland.
- The target session fact supplied to this ticket is `XDG_SESSION_TYPE=wayland`. That is enough for Electron 38.2+ auto-selection, but is not evidence that Restitutor has successfully rendered natively.

Sources: [Electron breaking changes for 38](https://www.electronjs.org/docs/latest/breaking-changes#removed-electron_ozone_platform_hint-environment-variable), [Electron Wayland technical note](https://www.electronjs.org/blog/tech-talk-wayland), [Electron Wayland selection fix](https://releases.electronjs.org/pr/48301), [Chromium Ozone overview](https://chromium.googlesource.com/chromium/src/+/main/docs/ozone_overview.md), [Electron `BrowserWindow` platform notices](https://www.electronjs.org/docs/latest/api/browser-window#platform-notices), [ArchWiki Electron](https://wiki.archlinux.org/title/Electron), [ArchWiki Wayland](https://wiki.archlinux.org/title/Wayland).

### GPU and existing switches

- Chromium defines `--in-process-gpu` as running the GPU process as a thread inside the browser process. It is not an Electron-documented production switch. It changes Chromium's normal process isolation and should be treated as a diagnostic/workaround until a Restitutor-specific need is demonstrated.
- Chromium's `--disable-direct-composition` disables DirectComposition surfaces. Chromium's DirectComposition implementation is Windows-specific, so this switch provides no documented Wayland benefit.
- Restitutor does not call `app.disableHardwareAcceleration()`. Electron provides `app.getGPUFeatureStatus()`/`app.getGPUInfo()` and `app.isHardwareAccelerationEnabled()` to observe actual GPU behavior. This is a better validation mechanism than assuming a flag worked.

Sources: [Chromium content switches](https://chromium.googlesource.com/chromium/chromium/+/master/content/public/common/content_switches.cc), [Chromium GL switches](https://chromium.googlesource.com/chromium/src/+/main/ui/gl/gl_switches.cc), [Electron `app` GPU APIs](https://www.electronjs.org/docs/latest/api/app), [Electron supported switches](https://www.electronjs.org/docs/latest/api/command-line-switches), [`packages/electron/src/index.ts`](../../packages/electron/src/index.ts).

### Fractional scaling

- Native Wayland reduces the compatibility layers between Chromium and the compositor, and Electron calls out HiDPI and fractional scaling as benefits of the native backend.
- Fractional scaling behavior depends on Chromium, the Wayland compositor/protocols, GPU path, and the application's CSS/layout. A supported Electron runtime makes the modern path available, but no primary source guarantees that this particular game will be sharp and correctly sized at every scale.

Source: [Electron Wayland technical note](https://www.electronjs.org/blog/tech-talk-wayland).

## Proposed launch baseline

1. Upgrade to a supported Electron major, initially testing 44; do not accept a major below 42 on the research date.
2. On Electron 38.2+, launch without an Ozone override in the normal `.desktop` entry. `XDG_SESSION_TYPE=wayland` should select native Wayland.
3. Offer `--ozone-platform=x11` as a documented recovery option, not the default.
4. Remove `--in-process-gpu` and `--disable-direct-composition` from the normal Linux start command unless an A/B prototype proves that a specific target GPU needs one.
5. Avoid globally enabling experimental Wayland feature flags by default. Flags such as `WaylandWindowDecorations` are Chromium implementation toggles whose availability/defaults change by Chromium version; test only when solving a reproduced defect.

## Items requiring prototype validation

These cannot be established from documentation alone:

- Confirm the active backend in both paths: native run (`XDG_SESSION_TYPE=wayland`, no override) and fallback (`--ozone-platform=x11`). Capture logs/process environment rather than judging by appearance.
- Record `app.getGPUFeatureStatus()`, `app.getGPUInfo("complete")`, renderer FPS/frame pacing, WebGL status, and crash/log output with the current forced GPU switches versus no forced switches.
- Exercise Intel/AMD/NVIDIA hardware actually intended for support. Verify blank windows, GPU-process crashes, suspend/resume, fullscreen transitions, and multi-monitor movement.
- Test compositor scales 100%, 125%, 150%, 175%, and 200% for readable/sharp text, correct pointer coordinates, stable window size, and canvas/WebGL output. Test monitors with different scales if available.
- Verify the current startup sequence (`maximize()` before `show()`) and fullscreen behavior under native Wayland. Electron's documented Wayland restrictions make programmatic window behavior a concrete compatibility risk.
- Verify keyboard input/IME, mouse, audio, dialogs, clipboard, save/exit, and launcher startup in a packaged build rather than only `electron-forge start`.
- Confirm the `steamworks.js` native module builds and initializes against the chosen Electron ABI. That compatibility constraint may select a different supported Electron major, but it cannot justify keeping EOL Electron 29.

## Repository observations relevant to the prototype

- `createWindow()` initializes Steam before constructing the window, creates a hidden `BrowserWindow`, calls `maximize()`, then `show()`, and only later loads game content. Startup failure is caught and shown via `dialog.showErrorBox()`.
- The package currently produces ZIP artifacts for Linux; it does not yet encode an Arch/Omarchy launcher policy.
- The current `start` flags are only in the npm development command. Packaged launch behavior needs an explicit decision rather than assuming those flags carry into release artifacts.

Sources: [`packages/electron/src/index.ts`](../../packages/electron/src/index.ts), [`packages/electron/forge.config.js`](../../packages/electron/forge.config.js), [`packages/electron/package.json`](../../packages/electron/package.json).

## Evidence limits

This is a documentation/source review, not a runtime test. The codebase-memory index generation used was `2026-09-20T10:18:31Z`; coverage checks for the three cited repository files reported matching metadata and no recorded issue, which is a best-effort signal rather than proof of completeness. No browser or game process was launched, in accordance with the repository's verification rules.
