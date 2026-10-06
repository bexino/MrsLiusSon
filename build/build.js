// 一键构建脚本：esbuild 打包 -> SEA blob -> 复制 node.exe -> postject 注入
// 用法: node build/build.js
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const NODE = process.execPath;
const SENTINEL = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(label, cmd, args) {
    console.log("\n=== " + label + " ===");
    execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
}

// 1) esbuild 打包成单文件 CJS（original-fs 是 Electron 专有模块，标记为 external）
run("1/4 esbuild bundle", NODE, [
    path.join(ROOT, "node_modules", "esbuild", "bin", "esbuild"),
    "src/cli.js",
    "--bundle",
    "--platform=node",
    "--target=node24",
    "--format=cjs",
    "--outfile=build/bundle.cjs",
    "--external:original-fs",
]);

// 2) 生成 SEA 准备 blob
run("2/4 generate SEA blob", NODE, ["--experimental-sea-config", "build/sea-config.json"]);

// 3) 复制 node.exe 作为宿主可执行文件
console.log("\n=== 3/4 copy node.exe -> dist/mdKit.exe ===");
fs.mkdirSync(path.join(ROOT, "dist"), { recursive: true });
fs.copyFileSync(NODE, path.join(ROOT, "dist", "mdKit.exe"));

// 4) postject 注入 blob
run("4/4 postject inject", NODE, [
    path.join(ROOT, "node_modules", "postject", "dist", "cli.js"),
    "dist/mdKit.exe",
    "NODE_SEA_BLOB",
    "build/sea-prep.blob",
    "--sentinel-fuse",
    SENTINEL,
]);

const out = path.join(ROOT, "dist", "mdKit.exe");
console.log("\n构建完成: " + out + "  (" + (fs.statSync(out).size / 1024 / 1024).toFixed(2) + " MB)");
