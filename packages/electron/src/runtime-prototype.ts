import path from "node:path";
import { init, shutdown } from "@fishpondstudio/steamworks.js";
import { app, BrowserWindow, ipcMain } from "electron";
import { ensureDirSync } from "fs-extra";

const prototypeRoot = path.join(app.getPath("temp"), "restitutor-runtime-prototype");
ensureDirSync(prototypeRoot);
app.setPath("userData", path.join(prototypeRoot, "user-data"));
app.commandLine.appendSwitch("enable-logging", "stderr");

let steamInitialized = false;

const html = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Restitutor Electron Wayland Runtime Prototype</title>
<style>
:root{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#e8e4da;background:#171713}body{margin:0;padding:24px}.shell{max-width:1040px;margin:auto}.warning{color:#ffca76}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.card{border:1px solid #4c4b42;border-radius:8px;padding:14px;background:#22221d}.value{white-space:pre-wrap;overflow-wrap:anywhere;color:#b9e6a2}button{font:inherit;margin:4px 8px 4px 0;padding:8px 12px;background:#39382f;color:#fff;border:1px solid #777361;border-radius:5px}button:hover{background:#4a493e}canvas{width:100%;height:120px;background:#10100e}.ok{color:#b9e6a2}.bad{color:#ff9b8f}</style>
</head>
<body><main class="shell">
<h1>Restitutor Runtime Prototype</h1>
<p class="warning">THROWAWAY PROTOTYPE — uses temporary data only. Test native Wayland first, then XWayland fallback.</p>
<div><button id="refresh">Refresh state</button><button id="fullscreen">Toggle native fullscreen</button><button id="audio">Play test tone</button><button id="quit">Quit normally</button></div>
<section class="grid">
<div class="card"><h2>Main process</h2><div id="environment" class="value"></div></div>
<div class="card"><h2>Renderer</h2><div id="renderer" class="value"></div></div>
<div class="card"><h2>GPU</h2><div id="gpu" class="value"></div></div>
<div class="card"><h2>Input</h2><div id="input" class="value">Press keyboard and mouse buttons in this window.</div></div>
<div class="card"><h2>Audio</h2><div id="audioState" class="value">Not tested</div></div>
<div class="card"><h2>WebGL canvas</h2><canvas id="canvas"></canvas><div id="webgl" class="value"></div></div>
</section>
</main>
<script>
const {ipcRenderer}=require("electron");
const out=(id,value)=>document.getElementById(id).textContent=typeof value==="string"?value:JSON.stringify(value,null,2);
async function refresh(){
  out("environment",await ipcRenderer.invoke("prototype:environment"));
  out("gpu",await ipcRenderer.invoke("prototype:gpu"));
  out("renderer",{userAgent:navigator.userAgent,devicePixelRatio:window.devicePixelRatio,innerSize:[innerWidth,innerHeight],screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight,colorDepth:screen.colorDepth},fullscreen:document.fullscreenElement!==null});
}
const canvas=document.getElementById("canvas");
const gl=canvas.getContext("webgl2")||canvas.getContext("webgl");
if(gl){const ext=gl.getExtension("WEBGL_debug_renderer_info");out("webgl",{version:gl.getParameter(gl.VERSION),vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):gl.getParameter(gl.VENDOR),renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});gl.clearColor(.12,.45,.7,1);gl.clear(gl.COLOR_BUFFER_BIT);}else{out("webgl","WebGL unavailable");}
addEventListener("keydown",e=>out("input",{type:e.type,key:e.key,code:e.code,ctrl:e.ctrlKey,alt:e.altKey,shift:e.shiftKey,meta:e.metaKey}));
addEventListener("pointerdown",e=>out("input",{type:e.type,button:e.button,pointerType:e.pointerType,x:e.clientX,y:e.clientY}));
document.getElementById("refresh").onclick=refresh;
document.getElementById("fullscreen").onclick=async()=>{await ipcRenderer.invoke("prototype:fullscreen");await refresh();};
document.getElementById("audio").onclick=async()=>{try{const ctx=new AudioContext();const oscillator=ctx.createOscillator();const gain=ctx.createGain();gain.gain.value=.08;oscillator.connect(gain).connect(ctx.destination);oscillator.start();oscillator.stop(ctx.currentTime+.35);oscillator.onended=()=>{out("audioState",{status:"tone completed",sampleRate:ctx.sampleRate,state:ctx.state});ctx.close();};}catch(error){out("audioState",{status:"failed",error:String(error)});}};
document.getElementById("quit").onclick=()=>ipcRenderer.invoke("prototype:quit");
addEventListener("resize",refresh);
refresh();
</script></body></html>`;

async function steamProbe(): Promise<Record<string, unknown>> {
   try {
      const steam = init();
      steamInitialized = true;
      return {
         status: "initialized",
         appId: steam.utils.getAppId(),
         steamId: steam.localplayer.getSteamId().steamId64.toString(),
      };
   } catch (error) {
      return { status: "unavailable", error: String(error) };
   }
}

app.whenReady().then(async () => {
   const steam = await steamProbe();
   const mainWindow = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 900,
      minHeight: 600,
      backgroundColor: "#171713",
      webPreferences: { nodeIntegration: true, contextIsolation: false },
   });
   mainWindow.removeMenu();

   ipcMain.handle("prototype:environment", () => ({
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
      sessionType: process.env.XDG_SESSION_TYPE ?? null,
      waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
      x11Display: process.env.DISPLAY ?? null,
      commandLine: process.argv,
      steam,
      temporaryRoot: prototypeRoot,
      packaged: app.isPackaged,
   }));
   ipcMain.handle("prototype:gpu", async () => ({
      featureStatus: app.getGPUFeatureStatus(),
      info: await app.getGPUInfo("basic"),
   }));
   ipcMain.handle("prototype:fullscreen", () => {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return mainWindow.isFullScreen();
   });
   ipcMain.handle("prototype:quit", () => app.quit());

   await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
   if (steamInitialized) shutdown();
});
