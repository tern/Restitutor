import path from "node:path";
import { execFileSync } from "node:child_process";
import fs from "fs-extra";

const { copySync, ensureDirSync, moveSync, removeSync, writeJsonSync } = fs;

const root = process.cwd();
const stage = path.join(root, "prototype-stage");
const output = path.join(root, "prototype-out", "RestitutorRuntimePrototype-linux-x64");

removeSync(stage);
removeSync(output);
ensureDirSync(path.join(stage, "compiled"));
copySync(path.join(root, "compiled", "index.js"), path.join(stage, "compiled", "index.js"));
writeJsonSync(path.join(stage, "package.json"), {
   name: "restitutor-runtime-prototype",
   version: "1.0.0",
   main: "compiled/index.js",
   dependencies: {
      "@fishpondstudio/steamworks.js": "0.3.8",
      "fs-extra": "11.3.0",
   },
});
execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts"], { cwd: stage, stdio: "inherit" });

copySync(path.join(root, "node_modules", "electron", "dist"), output);
moveSync(path.join(output, "electron"), path.join(output, "RestitutorRuntimePrototype"));
copySync(stage, path.join(output, "resources", "app"));
copySync(path.join(root, "steam_appid.txt"), path.join(output, "steam_appid.txt"));

console.log(output);
