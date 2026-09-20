# Restitutor Omarchy desktop 邊界調查

## 研究問題

現有 desktop、Steam、存檔、更新、發行與 Linux packaging 的邊界是什麼？Omarchy 實作開始前還必須決定哪些事項？

本調查描述 commit `471d274797b80bd88753d456bf9ec97c09f94590` 的 repository 狀態，並以 repository 原始碼為主要依據。

## 摘要

Restitutor 已有 Electron desktop shell，也能產出 Linux x64 application directory。缺口不在遊戲 renderer 的 Linux 移植，而在現有 desktop runtime 會在建立視窗前假定 Steam 可用，以 Steam ID 作為 filesystem 存檔 namespace，並把 Steam 專屬功能與一般 desktop 能力放在同一個 IPC service。

因此 Omarchy standalone release 需要非 Steam 的 desktop runtime 路徑、相容的存檔 identity 與遷移政策、Arch／Omarchy 安裝 metadata，以及與既有 macOS-only Steam publish script 分離的發行／更新路徑。Wayland 行為仍須以 packaged runtime 驗證；repository 目前無法證明它可正常運作。

## 現有 desktop 邊界

- Desktop shell 使用 Electron 29.4.6。Main process 會建立 `BrowserWindow`、注入 preload bridge、最大化並顯示視窗；packaged build 載入 `game/index.html`，也能透過 IPC 切換全螢幕（[`packages/electron/package.json`](../../packages/electron/package.json#L28-L35)、[`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L59-L95)、[`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L82-L88)）。
- Forge 在 packaging 後把 client build 複製到同層 `game/` directory。Linux 的 `getInstallRoot()` 直接以 executable 所在 directory 作為 root（[`packages/electron/forge.config.js`](../../packages/electron/forge.config.js#L35-L45)、[`packages/electron/src/InstallRoot.ts`](../../packages/electron/src/InstallRoot.ts#L11-L15)）。
- 最小視窗為 1136×640。Steam Deck detection 會強制全螢幕，但該 detection 本身依賴 Steam client（[`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L34-L35)、[`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L93-L95)）。
- Packaged build 目前會無條件開啟 DevTools（[`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L80-L90)）。

## Steam coupling 與 standalone 邊界

Electron shell 目前沒有 standalone mode：

1. `createWindow()` 在建立視窗前呼叫 `steamworks.init()`。
2. 整段 startup path 位於同一個 `try` block。
3. Initialization failure 會顯示 `Failed to Start Game`，接著退出。

此流程見 [`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L37-L40) 與 [`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L132-L135)。Release handoff 也記載未開啟 Steam 時會發生 `SteamAPI_Init() failed`（[`packages/electron/RELEASE.md`](../../packages/electron/RELEASE.md#L20-L24)）。

Steam 也與 service boundary 緊密耦合：

- `IPCService` constructor 必須取得 Steam client（[`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L11-L18)）。
- 存檔、備份與資料夾操作的 namespace 都取自 `localplayer.getSteamId()`（[`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L20-L56)、[`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L70-L79)）。
- Authentication、app identity、beta channel、achievement 與 Workshop／mod 操作都直接使用 Steam client（[`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L58-L68)、[`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L90-L159)）。
- Client 只要發現 `IPCBridge` 就把環境視為「Steam」，無法區分 Electron desktop 與有效的 Steam session（[`packages/client/src/rpc/SteamClient.ts`](../../packages/client/src/rpc/SteamClient.ts#L7-L18)）。

所以只 catch Steam initialization failure 並不足夠。Persistence、存檔資料夾、fullscreen、external URL 與 quit 等基礎 desktop 能力需要 Steam-independent service／adapter；Steam authentication、achievement、Workshop、beta name 與 Steam Deck detection 則可依 capability 決定是否啟用。

## 存檔相容性邊界

目前 Electron filesystem layout 為：

```text
<Electron appData>/RestitutorSaves/<SteamID>/<save name>
<Electron appData>/RestitutorLocal/<SteamID>/<backup name>
<Electron appData>/RestitutorLocal/Restitutor.log
```

Root 定義於 [`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L15-L31)；file operation 與 Steam-ID namespace 位於 [`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L20-L56)，資料夾操作位於同檔案的 [70–79 行](../../packages/electron/src/IPCService.ts#L70-L79)。

Serialized format 可以保留。Client 以 JSON encode game state 並輪替 backup name（[`packages/client/src/game/LoadSave.ts`](../../packages/client/src/game/LoadSave.ts#L9-L35)）；Electron 寫入時以 `lz-string` 壓縮字串，讀取時解壓縮（[`packages/electron/src/IPCService.ts`](../../packages/electron/src/IPCService.ts#L20-L35)）。

Client 依 platform 選擇 storage：有 preload bridge 時使用 Electron IPC；native mobile 使用 Capacitor；一般 web 使用 IndexedDB（[`packages/client/src/game/NativeUtils.ts`](../../packages/client/src/game/NativeUtils.ts#L7-L51)）。因此移除 bridge 來模擬 standalone 會把存檔移到 Chromium IndexedDB，無法保留既有 desktop layout。

Close flow 已嘗試在退出前存檔：main process 要求確認、送出 `close`，並在強制退出前保留五秒；renderer 存檔後呼叫 `quit`（[`packages/electron/src/index.ts`](../../packages/electron/src/index.ts#L97-L113)、[`packages/client/src/rpc/SteamClient.ts`](../../packages/client/src/rpc/SteamClient.ts#L20-L34)）。

尚未決定的是 standalone namespace 與 migration rule。為符合既定相容性目標，實作需保留 JSON 加 `lz-string` 格式，並定義 Omarchy 使用者如何選擇或匯入既有 `<SteamID>` directory，且不得覆寫任一份資料。

## Linux packaging 邊界

Repository 能 package Linux x64，但尚不能產出可由 Omarchy 系統安裝的 package：

- Forge 只有 `@electron-forge/maker-zip`，適用平台設定為 Windows、Linux 與 macOS（[`packages/electron/forge.config.js`](../../packages/electron/forge.config.js#L28-L33)、[`packages/electron/package.json`](../../packages/electron/package.json#L28-L34)）。
- Full publish path 會建立 `Restitutor-linux-x64`，再複製進 Steam ContentBuilder（[`packages/electron/scripts/publish.mjs`](../../packages/electron/scripts/publish.mjs#L37-L43)、[`packages/electron/scripts/publish.mjs`](../../packages/electron/scripts/publish.mjs#L72-L109)）。
- Linux VDF 把該 directory 映射到 Steam depot `4431752`（[`packages/electron/scripts/linux.vdf`](../../packages/electron/scripts/linux.vdf#L1-L20)）。

Repository-wide literal／config search 未找到 `PKGBUILD`、pacman／AUR recipe、`.desktop` file、AppStream metadata 或 standalone installer 定義。因此 launcher integration、icon installation、filesystem destination、dependency declaration、uninstall 與 package upgrade 都是新工作。

Development start command 會傳入 `--in-process-gpu --disable-direct-composition`，但 packaged launch 沒有 repository-defined wrapper 提供等價設定（[`packages/electron/package.json`](../../packages/electron/package.json#L7-L13)）。原始碼無法證明 Omarchy 上的 Wayland／Ozone rendering、縮放、音訊、keyboard／mouse、fullscreen transition 或正常退出；這些都必須列入 packaged-runtime acceptance。

## 發行與更新邊界

現有 `publish` script 不適合作為 Omarchy release path：

- 因同一個 full build 也建立 universal macOS app，script 不是在 macOS 執行就會退出（[`packages/electron/scripts/publish.mjs`](../../packages/electron/scripts/publish.mjs#L5-L9)）。
- 它在同一個需要 credentials 的 workflow 中遞增 client build、部署 Cloudflare Pages、透過 `scp` 上傳 mobile OTA、package desktop platforms、sign／notarize macOS，最後把所有 desktop builds 上傳 Steam（[`packages/electron/scripts/publish.mjs`](../../packages/electron/scripts/publish.mjs#L11-L83)）。
- GitHub workflows 仍指向特定 self-hosted machine 與 directory（[`.github/workflows/build.yml`](../../.github/workflows/build.yml#L7-L33)、[`.github/workflows/build-full.yml`](../../.github/workflows/build-full.yml#L7-L33)）。Release handoff 說明這些 path 屬於舊 Linux runner，但 `publish.mjs` 現在要求 macOS（[`packages/electron/RELEASE.md`](../../packages/electron/RELEASE.md#L104-L111)）。

原始碼沒有 Electron desktop updater。唯一 live-update code 僅在 iOS／Android 啟用，並下載 Capacitor bundle（[`packages/client/src/game/Mobile.ts`](../../packages/client/src/game/Mobile.ts#L8-L42)）。目前 Steam 負責 desktop distribution／update；standalone Omarchy release 必須選擇由 system package、manual release 或新的 desktop updater 負責。

## 現在已可決定的事項

1. **Desktop／Steam service seam：** 定義 Steam-independent capability set，以及 Steam-only capability 不可用時的行為。
2. **Standalone save identity 與 migration：** 選擇新 namespace，並制定從 `<SteamID>` directory 非破壞性匯入的確定規則。
3. **Omarchy package contract：** 選擇 repository／package channel，規格化 `PKGBUILD`、`.desktop`、icons、install paths、dependencies、uninstall 與 upgrade semantics。
4. **Update ownership：** 決定由 pacman／AUR、downloadable release artifacts 或 application 管理更新。
5. **Wayland acceptance：** 在目標 Omarchy 電腦驗證 packaged build，記錄需要的 Electron／Ozone switches 或 environment variables。
6. **Release separation：** 建立不依賴 macOS、Steam ContentBuilder、Cloudflare credentials、signing credentials 或 publisher private host 的 Omarchy build／release path。

## 證據品質與限制

本調查使用 Codebase Memory project `home-tern-Restitutor` generation `2026-09-20T10:18:31Z`，採 Tier 2 驗證。Structural search 與 call trace 涵蓋 window creation、save-path callers、Steam detection 與 callers、IPC methods、install-root resolution，以及 publish helpers。以上每個引用的 tracked source path 都已檢查 index coverage，結果均為 `no_recorded_issue` 且 metadata 相符；graph 未追蹤的 `linux.vdf` 已直接讀取。Config、workflow、documentation、packaging negative claim 與 updater negative claim 也以 repository text 直接檢查。

Coverage metadata 僅為 best-effort，不能證明完整性。Generated `packages/electron/compiled/` 與 `packages/electron/out/` directories 刻意不在 index 內，未視為 source authority。本調查未執行 packaged Omarchy runtime，也未使用 browser 驗證。
