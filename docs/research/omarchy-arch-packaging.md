# Restitutor 的 Omarchy／Arch Linux 封裝契約

研究日期：2026-09-20
目標環境：一般 x86_64 Omarchy 4（Arch Linux、Hyprland／Wayland）

## 結論

第一個可散布版本應採用 **AUR 的 `restitutor-bin` package**：GitHub Release 提供已封裝、鎖定 Electron 版本的 Linux x86_64 archive，AUR repository 只保存 `PKGBUILD`、`.SRCINFO` 與必要的 launcher／desktop metadata。使用者以 `omarchy pkg aur add restitutor-bin` 安裝，之後由一般的 `omarchy update` 更新，並以 `omarchy pkg drop restitutor-bin` 解除安裝。

這個選擇符合目前專案的實際狀態：`packages/electron` 使用 Electron 29.4.6、Electron Forge 與含 native module 的 `@fishpondstudio/steamworks.js`，Forge 目前只設定 `maker-zip`。若改用 Arch 的 system Electron，必須另外處理 Electron major version、native Node ABI 與 app layout 的相容性；那不是第一版發行所需承擔的風險。`-bin` package 應保留 upstream 發行物自帶的 Electron runtime，並將整個自包含 app 安裝在 `/opt/restitutor`。

AUR 本身不代管 binary package；它代管讓使用者下載來源並在本機產生 pacman package 的 build recipe。`PKGBUILD` 的 `source_x86_64` 應指向具有不可變版本號的 GitHub Release archive，並提供真實 `sha256sums_x86_64`，不能指向會變動的 `latest` URL 或使用 `SKIP`。這可讓安裝、更新與移除都由 pacman 的檔案擁有權資料庫管理。

## Package source 與命名

- AUR package name：`restitutor-bin`；`pkgname` 必須小寫，並以 `-bin` 表明重新封裝 upstream binary release。
- `arch=('x86_64')`。Electron 與 steamworks native module 都是 architecture-specific，不能宣告 `any`。AUR 也只接受支援 x86_64 的 packages。
- `pkgver` 應等於 upstream release version，`pkgrel=1`；只修改封裝而 upstream version 不變時遞增 `pkgrel`。
- `provides=("restitutor=$pkgver")`、`conflicts=('restitutor')`，讓未來的 source-built variant 可替換；不要使用 `replaces`，除非 package 真正改名。
- `license` 應使用 upstream license 的 SPDX identifier。repo root 目前沒有可供封裝確認的 license file，因此 release 前必須先確認著作權／授權並把授權檔包含於 release；AUR recipe 再安裝至 `/usr/share/licenses/restitutor-bin/`。
- AUR Git repository 需包含 maintainer header、`PKGBUILD`、由 `makepkg --printsrcinfo > .SRCINFO` 產生且保持同步的 `.SRCINFO`，以及 package-source 授權資訊。提交前先查官方 repositories 與 AUR，避免重複 package。

Arch 的 `PKGBUILD(5)` 說明最低必要欄位、architecture-specific sources、checksums、`depends`／`makedepends`，以及 `package()` 必須只把檔案裝入 `$pkgdir`；Arch package guidelines 另要求不依賴 transitive dependencies、列出所有 direct library dependencies，並以 `find-libdeps` 檢查。來源：[PKGBUILD(5)](https://man.archlinux.org/man/PKGBUILD.5.en)、[Arch package guidelines](https://wiki.archlinux.org/title/Arch_package_guidelines)、[AUR submission guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines)。

## 建議的檔案佈局

```text
/opt/restitutor/                         # upstream Electron Linux bundle
/usr/bin/restitutor                      # launcher，exec /opt/restitutor/restitutor
/usr/share/applications/io.github.tern.Restitutor.desktop
/usr/share/icons/hicolor/256x256/apps/io.github.tern.Restitutor.png
/usr/share/icons/hicolor/512x512/apps/io.github.tern.Restitutor.png
/usr/share/licenses/restitutor-bin/LICENSE
```

Arch guidelines 容許大型、自包含的 application 放在 `/opt/<pkg>`；一般 executable entry point 放在 `/usr/bin`，architecture-independent shared data 放在 `/usr/share`。不得把 package 檔案寫入 `/home`、`/tmp` 或使用者的 `~/.config`。來源：[Arch package guidelines](https://wiki.archlinux.org/title/Arch_package_guidelines)。

launcher 的責任應保持很小：啟動 `/opt/restitutor/restitutor` 並透傳 arguments。是否加入 Electron Wayland flags（例如 ozone platform hint）應由另一張 Wayland runtime 決策 ticket 以實機驗證決定，不應在 package contract 中先硬編碼。

## Desktop entry 與 icon

建議的 desktop entry contract：

```ini
[Desktop Entry]
Type=Application
Name=Restitutor
Comment=Incremental grand strategy game
Exec=restitutor
Icon=io.github.tern.Restitutor
Terminal=false
Categories=Game;StrategyGame;
StartupWMClass=Restitutor
```

- 安裝到 `/usr/share/applications/`，讓 Omarchy launcher 透過標準 XDG application database 發現，不需修改 Omarchy 或使用者 Hyprland config。
- desktop filename 建議使用 reverse-DNS identifier；spec 建議 `.desktop` 前的名稱符合 D-Bus well-known name。
- `Exec` 使用 PATH 上的 launcher，不寫入使用者路徑；若未支援 URL／file opening，不加 `%U` 或 `%F`。
- `Icon` 使用沒有副檔名的 icon name，圖檔安裝至 hicolor theme 的 size-specific `apps` directories；至少由現有高解析 PNG 產生 256 與 512 px，若資產允許再提供 16、32、48、64、128 px。
- `StartupWMClass`／Wayland `app_id` 必須在 runtime 驗證後與 Electron window identity 對齊；上述值是預期 contract，不代表目前程式已達成。
- package build 應以 `desktop-file-validate` 驗證 desktop entry。

這些要求來自 freedesktop 的 [Desktop Entry Specification 1.5](https://specifications.freedesktop.org/desktop-entry/latest-single/) 與 [Icon Theme Specification 0.13](https://specifications.freedesktop.org/icon-theme/)。hicolor 是第三方 app icon 的標準 fallback；不需把 icon 複製進 Omarchy 自有目錄。

## Dependencies

`restitutor-bin` 應攜帶 upstream Electron runtime 與 app resources，但不能假設所有 system libraries 都被 bundle。正式 dependency list 應由 release artifact 實測產生：

1. 對 package 執行 `namcap`。
2. 對主 executable、Electron helpers 與所有 `.node`／`.so` 執行 `ldd`，並用 `find-libdeps` 找出 direct shared-library providers。
3. 在乾淨的 x86_64 Arch／Omarchy VM 安裝產物，確認沒有 undeclared direct dependency。
4. 把實際 direct runtime packages 填入 `depends`；只在功能確實可選時放入 `optdepends`，不要依賴 dependency-of-dependency。

依 Electron Linux runtime 的常見需求，預期會看到 GTK、NSS、ALSA、X11/XCB、Mesa／libdrm 等 providers，但在 artifact 尚未建成前不應把推測清單當成已確認 contract。若 standalone mode 不要求 Steam client，Steam 只能是 `optdepends`（並描述其用途），不能成為 hard dependency。

build recipe 的工具（例如 `desktop-file-utils`、archive extraction 工具）放入 `makedepends`，只有 runtime 實際會使用的 packages 才放 `depends`。依據：[PKGBUILD(5)](https://man.archlinux.org/man/PKGBUILD.5.en)、[Arch package guidelines](https://wiki.archlinux.org/title/Arch_package_guidelines)。

## Omarchy 的安裝、更新、移除契約

本機安裝的 Omarchy 4.0.0 command source 顯示：

- `omarchy pkg aur add <packages...>` 呼叫 `yay -S --noconfirm --needed`，完成後用 `pacman -Q` 確認 package 已註冊。
- `omarchy update` 先更新官方 system packages，再執行 `yay -Sua --noconfirm --cleanafter` 更新已安裝的 foreign／AUR packages。
- `omarchy pkg drop <packages...>` 對已安裝的指定 packages 執行 `pacman -Rns --noconfirm`。

因此使用者流程為：

```bash
omarchy pkg aur add restitutor-bin
omarchy update
omarchy pkg drop restitutor-bin
```

package 不需、也不應建立 Omarchy migration、修改 `/usr/share/omarchy/`、`~/.config/omarchy/` 或 `~/.config/hypr/`。正常 pacman upgrade 會原子地替換 package-owned application files；解除安裝會移除 package-owned launcher、desktop entry、icons 與 `/opt` bundle。遊戲存檔必須由 application 寫到使用者 data directory，而非 package-owned path，因此 upgrade／uninstall 不應刪除存檔；存檔實際路徑與 migration 由另一張 persistence 決策 ticket 定義。

本節的 primary evidence 是本機唯讀檔案 `/usr/share/omarchy/bin/omarchy-pkg-aur-add`、`omarchy-update`、`omarchy-update-aur-pkgs` 與 `omarchy-pkg-drop`（Omarchy 4.0.0.r1832.g23dab9e-1）。

## Release 與維護流程

1. Upstream CI 在 version tag 建立 Linux x64 Electron bundle；bundle 必須包含 client build、native modules、license，並能在沒有 Steam client 的 standalone 情境啟動。
2. 將 archive 與 checksum 發布到不可變的 GitHub Release URL。
3. 更新 AUR `pkgver`、checksum 與 `.SRCINFO`；在乾淨環境跑 `makepkg --cleanbuild`、`namcap PKGBUILD` 與 `namcap <package>`。
4. 安裝產物並驗證 launcher listing、icon、Wayland 啟動、package ownership、upgrade 與 uninstall；驗證範圍包含「存檔未被 package upgrade/remove 清掉」。
5. 發布 AUR commit。Omarchy 使用者下一次 `omarchy update` 會透過 yay 取得新版 recipe 並交由 pacman 升級。

不建議使用 Electron Forge 的 ZIP 直接作為使用者安裝介面：ZIP 沒有 pacman ownership、dependency metadata、desktop integration 或標準 update/uninstall lifecycle。ZIP 可作為 `restitutor-bin` 的 upstream source artifact，但使用者面向的 contract 應是 pacman package。

## 待後續決策／驗證

- 決定 release archive 的精確檔名、GitHub owner 與 tag scheme，並讓 Electron `package.json` version 不再固定為 `1.0.0`。
- 以實際 Linux artifact 確定 `depends`、license、binary name、icon sizes、Wayland `app_id`／`StartupWMClass`。
- 決定 launcher 是否需要 Wayland flags，以及 XWayland fallback policy。
- 先完成 standalone Steam detection，避免 `steamworks.js` 初始化失敗阻止 app 啟動。
- AUR 發布前查詢 `restitutor`／`restitutor-bin` 是否已被占用，並準備 AUR account SSH authentication；這些是發布動作，不屬於本研究 ticket。

## Primary sources

- [Arch package guidelines](https://wiki.archlinux.org/title/Arch_package_guidelines)
- [AUR submission guidelines](https://wiki.archlinux.org/title/AUR_submission_guidelines)
- [PKGBUILD(5)](https://man.archlinux.org/man/PKGBUILD.5.en)
- [makepkg(8)](https://man.archlinux.org/man/makepkg.8.en)
- [Desktop Entry Specification 1.5](https://specifications.freedesktop.org/desktop-entry/latest-single/)
- [Icon Theme Specification 0.13](https://specifications.freedesktop.org/icon-theme/)
- Installed Omarchy 4.0.0.r1832.g23dab9e-1 command sources under `/usr/share/omarchy/bin/`（read-only inspection）
- Restitutor `packages/electron/package.json` and `packages/electron/forge.config.js`
