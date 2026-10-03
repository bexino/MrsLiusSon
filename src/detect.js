"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REG_VALUE_LINE = /^\s{4}(.*?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/;
const REG_KEY_LINE = /^HKEY_[A-Z_]+\\/;

function decodeBuffer(buf) {
    if (!buf || buf.length === 0) return "";
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
        return buf.slice(2).toString("utf16le");
    }
    const utf8 = buf.toString("utf8");
    if (!utf8.includes("\uFFFD")) return utf8;
    try {
        return new TextDecoder("gbk").decode(buf);
    } catch (err) {
        return utf8;
    }
}

function runReg(args) {
    try {
        const out = execFileSync("reg.exe", args, {
            encoding: "buffer",
            stdio: ["ignore", "pipe", "ignore"],
            windowsHide: true,
            timeout: 20000,
        });
        return decodeBuffer(out);
    } catch (err) {
        return "";
    }
}

function parseBlocks(text) {
    const blocks = [];
    let current = null;
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
        if (REG_KEY_LINE.test(line)) {
            current = { key: line.trim(), values: {} };
            blocks.push(current);
            continue;
        }
        const m = REG_VALUE_LINE.exec(line);
        if (m && current) {
            current.values[m[1].trim()] = m[3].trim();
        }
    }
    return blocks;
}

function getVal(block, name) {
    const target = String(name).toLowerCase();
    for (const k of Object.keys(block.values)) {
        if (k.toLowerCase() === target) return block.values[k];
    }
    return null;
}

function isTyporaDir(dir) {
    if (!dir) return false;
    try {
        return fs.existsSync(path.join(dir, "Typora.exe")) && fs.existsSync(path.join(dir, "resources"));
    } catch (err) {
        return false;
    }
}

function cleanPath(p) {
    return String(p).trim().replace(/^"|"$/g, "").trim();
}

function fromAppPaths() {
    const keys = [
        "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Typora.exe",
        "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Typora.exe",
        "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Typora.exe",
    ];
    for (const key of keys) {
        const text = runReg(["query", key, "/ve"]);
        if (!text) continue;
        for (const block of parseBlocks(text)) {
            for (const name of Object.keys(block.values)) {
                const v = cleanPath(block.values[name]);
                if (v.toLowerCase().endsWith("typora.exe")) {
                    return { dir: path.dirname(v), source: "注册表 App Paths" };
                }
            }
        }
    }
    return null;
}

function fromUninstall() {
    const roots = [
        "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
        "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    ];
    for (const root of roots) {
        const text = runReg(["query", root, "/s", "/f", "Typora", "/d"]);
        if (!text) continue;
        const seen = {};
        for (const b of parseBlocks(text)) {
            if (seen[b.key]) continue;
            seen[b.key] = true;
            const full = parseBlocks(runReg(["query", b.key]));
            for (const block of full) {
                const display = getVal(block, "DisplayName");
                if (!display || display.trim().toLowerCase() !== "typora") continue;
                const loc = getVal(block, "InstallLocation");
                if (loc && cleanPath(loc)) {
                    return { dir: cleanPath(loc), source: "注册表卸载信息" };
                }
                const un = getVal(block, "UninstallString");
                if (un && cleanPath(un)) {
                    return { dir: path.dirname(cleanPath(un)), source: "注册表卸载信息" };
                }
                const icon = getVal(block, "DisplayIcon");
                if (icon && cleanPath(icon)) {
                    return { dir: path.dirname(cleanPath(icon).split(",")[0]), source: "注册表卸载信息" };
                }
            }
        }
    }
    return null;
}

function fromProcess() {
    try {
        const out = execFileSync(
            "powershell.exe",
            [
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "(Get-Process Typora -ErrorAction SilentlyContinue | Select-Object -First 1).Path",
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true, timeout: 15000 }
        );
        const p = String(out).trim();
        if (p && p.toLowerCase().endsWith("typora.exe")) {
            return { dir: path.dirname(p), source: "正在运行的 Typora 进程" };
        }
    } catch (err) {
        // ignore
    }
    return null;
}

function commonPaths() {
    const list = [];
    const pf = process.env["ProgramFiles"];
    const pf86 = process.env["ProgramFiles(x86)"];
    const local = process.env["LOCALAPPDATA"];
    if (pf) list.push(path.join(pf, "Typora"));
    if (pf86) list.push(path.join(pf86, "Typora"));
    if (local) list.push(path.join(local, "Programs", "Typora"));
    const letters = "CDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    for (const d of letters) {
        list.push(d + ":\\Program Files\\Typora");
        list.push(d + ":\\Program Files (x86)\\Typora");
        list.push(d + ":\\Typora");
        list.push(d + ":\\Software\\Typora");
    }
    return list;
}

function detectTyporaPath() {
    const providers = [fromAppPaths, fromUninstall, fromProcess];
    for (const fn of providers) {
        try {
            const r = fn();
            if (r && r.dir && isTyporaDir(r.dir)) {
                return { dir: path.resolve(r.dir), source: r.source };
            }
        } catch (err) {
            // ignore
        }
    }
    for (const p of commonPaths()) {
        if (isTyporaDir(p)) {
            return { dir: path.resolve(p), source: "常见安装路径" };
        }
    }
    return null;
}

module.exports = { detectTyporaPath, isTyporaDir, runReg, decodeBuffer };
