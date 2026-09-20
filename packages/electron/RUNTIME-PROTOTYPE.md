# Electron 44 Omarchy Runtime Prototype

This is a throwaway prototype for deciding Restitutor's Electron and Wayland release baseline. It never reads or writes real game saves and stores runtime data under `/tmp/restitutor-runtime-prototype`.

## Build and run

```bash
npm install
npm run prototype:package
npm run prototype:run:wayland
npm run prototype:run:xwayland
```

## Observed on the target Omarchy machine

- Electron 44.4.3 produced an x86_64 Linux artifact.
- `@fishpondstudio/steamworks.js` 0.3.8 loaded its Linux x64 native module and initialized Steam API in both modes.
- Native Wayland: keyboard, pointer, audio tone, fullscreen transitions, scaling, GPU/WebGL rendering, and normal quit were confirmed by the user.
- XWayland fallback with `--ozone-platform=x11`: the same interactions were confirmed by the user.
- Native Wayland emitted protocol-version and unsupported optional compositor feature warnings without visible failure.
- XWayland emitted three transient `GetVSyncParametersIfAvailable()` errors without visible failure.
- The repository's Electron Forge / Packager 18 CLI returned before asynchronous packaging completed under Node 26.7.0. The prototype uses a minimal explicit runtime assembly script instead; production packaging tooling needs a separate decision.

## Verdict supported by this prototype

Electron 44.4.3 is viable as the first Restitutor runtime baseline candidate on this Omarchy machine. Native Wayland should be the default, with explicit `--ozone-platform=x11` as a recovery fallback. The observed warnings should remain visible in release qualification rather than being treated as current blockers.
