// 端到端自检：构造沙箱夹具 -> 用 dist/mdKit.exe 破解 -> 断言全部关键行为
// 用法: node build/verify.js
// 注意: 全程只操作 build/verify-sandbox* 下的副本，不会碰真实 Typora 安装；
//       注册表 HKCU\Software\Typora 会在结束时还原。
"use strict";
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const vm = require("vm");
const asar = require("asar");

const ROOT = path.resolve(__dirname, "..");
const EXE = path.join(ROOT, "dist", "mdKit.exe");

// 动态定位真实 Typora 安装（不做任何盘符硬编码）：
// 注册表 App Paths → HKLM 卸载信息 → 常见相对候选（各盘符的 Program Files 变体）
function findRealTypora() {
    function probe(dir) {
        return dir && fs.existsSync(path.join(dir, "Typora.exe")) ? dir : null;
    }
    function queryReg(args) {
        try {
            return execFileSync("reg.exe", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] });
        } catch (e) {
            return "";
        }
    }
    // 1) App Paths（HKLM / HKLM WOW6432Node / HKCU）
    for (const key of [
        "HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Typora.exe",
        "HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Typora.exe",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Typora.exe",
    ]) {
        const out = queryReg(["query", key, "/ve"]);
        const m = /REG_SZ\s+(.*)/.exec(out);
        if (m) {
            const exePath = m[1].trim().replace(/^"|"$/g, "");
            const dir = probe(path.dirname(exePath));
            if (dir) return dir;
        }
    }
    // 2) 常见安装根（相对盘符枚举，不硬编码具体盘）
    const drives = ["C", "D", "E", "F", "G", "H"];
    for (const d of drives) {
        for (const suffix of [
            "Program Files\\Typora",
            "Program Files (x86)\\Typora",
            "Typora",
        ]) {
            const dir = probe(d + ":\\" + suffix);
            if (dir) return dir;
        }
    }
    return null;
}

const REAL = findRealTypora();
if (!REAL) {
    console.error("未找到 Typora 安装目录（注册表 App Paths 与常见路径均未命中），自检无法构造夹具。");
    process.exit(1);
}
if (!fs.existsSync(REAL)) {
    console.error("Typora 目录不存在: " + REAL);
    process.exit(1);
}
// 真实安装可能已被破解（app.asar 已改名为 app.asar.bak），夹具用哪个都一样
const REAL_ASAR = fs.existsSync(path.join(REAL, "resources", "app.asar"))
    ? path.join(REAL, "resources", "app.asar")
    : path.join(REAL, "resources", "app.asar.bak");
const MACHINE = Buffer.from(
    JSON.stringify({ l: "VERIFY_DEVICE_ID", i: "VERIFY_FINGERPRINT", v: "1.9.5" }),
    "utf-8"
).toString("base64");

const results = [];
function check(name, cond, extra) {
    results.push({ name, pass: !!cond, extra: extra === undefined ? "" : String(extra) });
}

async function makeFixture(dirName) {
    const SB = path.join(ROOT, "build", dirName);
    fs.rmSync(SB, { recursive: true, force: true });
    fs.mkdirSync(path.join(SB, "resources"), { recursive: true });
    fs.copyFileSync(path.join(REAL, "Typora.exe"), path.join(SB, "Typora.exe"));
    const fakeApp = path.join(ROOT, "build", dirName + "-app");
    fs.rmSync(fakeApp, { recursive: true, force: true });
    fs.mkdirSync(path.join(fakeApp, "sub"), { recursive: true });
    // 用真实 launch.dist.js 作为夹具，保证注入位置/严格模式等与线上一致
    fs.writeFileSync(
        path.join(fakeApp, "launch.dist.js"),
        asar.extractFile(REAL_ASAR, "launch.dist.js")
    );
    fs.writeFileSync(path.join(fakeApp, "sub", "marker.txt"), "marker-content", "utf-8");
    await asar.createPackage(fakeApp, path.join(SB, "resources", "app.asar"));
    fs.rmSync(fakeApp, { recursive: true, force: true });
    return SB;
}

function crack(sandbox, extraArgs) {
    return execFileSync(
        EXE,
        ["-p", sandbox, "-m", MACHINE, "-y"].concat(extraArgs || []),
        { encoding: "utf-8" }
    );
}

function readUtf8(p) {
    return fs.readFileSync(p, "utf-8");
}

// 在 VM 里跑注入后的代码，断言调试闸门 / https 回落 / 伪造授权
async function runtimeAssertions(sandbox, debugOn) {
    const text = readUtf8(path.join(sandbox, "resources", "app", "launch.dist.js"));
    const a = text.indexOf("/** Hook");
    const b = text.indexOf("/** Hook", a + 1);
    const injected = text.slice(a, text.indexOf("*/", b) + 2);

    const tmpDir = path.join(os.tmpdir(), "mdkit-verify-" + (debugOn ? "on" : "off"));
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const logPath = path.join(tmpDir, "Typora_Hook_Log.txt");

    const appendCalls = [];
    const fsStub = Object.create(fs);
    // fs.promises 在真实 fs 模块上是只读访问器，不能直接赋值，必须 defineProperty
    Object.defineProperty(fsStub, "promises", {
        value: Object.create(fs.promises),
        writable: true,
        configurable: true,
        enumerable: true,
    });
    fsStub.appendFileSync = function (...args) {
        appendCalls.push(args);
        return fs.appendFileSync(...args);
    };

    let httpsHandler = null;
    let netFetchCalls = 0;
    const electronStub = {
        app: { on() {}, whenReady() { return Promise.resolve(); } },
        ipcMain: { handle() {} },
        protocol: { handle(scheme, h) { if (scheme === "https") httpsHandler = h; } },
        net: {
            fetch: async (req) => {
                netFetchCalls++;
                return new Response("forwarded:" + req.url, { status: 200 });
            },
        },
    };

    const sandboxCtx = {
        require(id) {
            if (id === "electron") return electronStub;
            return require(id);
        },
        fs: fsStub,
        process: Object.create(process, { execPath: { value: path.join(tmpDir, "Typora.exe") } }),
        console,
        Buffer,
        Response,
        URL,
        btoa: (s) => Buffer.from(s, "binary").toString("base64"),
        setTimeout,
        clearTimeout,
    };
    sandboxCtx.globalThis = sandboxCtx;
    vm.createContext(sandboxCtx);
    vm.runInContext(injected, sandboxCtx, { filename: "injected.js" });
    await new Promise((r) => setTimeout(r, 20));

    const tag = debugOn ? "[debug=ON] " : "[debug=OFF] ";
    check(tag + "https handler 已注册", typeof httpsHandler === "function");

    const renewRes = await httpsHandler({
        url: "https://store.typora.io/api/client/renew",
        method: "POST",
        clone() { return { text: async () => "" }; },
    });
    const renewBody = await renewRes.text();
    check(tag + "renew 端点被伪造为 success", renewRes.status === 200 && renewBody.includes("success"), renewBody);

    const normalRes = await httpsHandler({
        url: "https://example.com/x",
        method: "GET",
        clone() { return { text: async () => "body" }; },
    });
    check(tag + "普通 https 请求返回 Response(非 undefined)", normalRes && typeof normalRes.text === "function", typeof normalRes);
    check(tag + "普通 https 请求被正常转发", netFetchCalls === 1, netFetchCalls);

    const forged = JSON.parse(
        sandboxCtx.require("crypto").publicDecrypt("k", Buffer.from("00", "hex")).toString("utf-8")
    );
    check(tag + "publicDecrypt 伪造 deviceId", forged.deviceId === "VERIFY_DEVICE_ID", forged.deviceId);
    check(tag + "publicDecrypt 伪造 email", /^[a-z][a-z0-9]{7}@(gmail|outlook|hotmail|yahoo|qq|163|126|foxmail)\.com$/.test(forged.email), forged.email);
    check(tag + "publicDecrypt 伪造 license", forged.license === "Cracked_By_DreamNya", forged.license);

    const logExists = fs.existsSync(logPath);
    check(tag + "日志文件生成 === debugOn", logExists === debugOn, "logExists=" + logExists + " appendCalls=" + appendCalls.length);
    check(tag + "不在工作目录生成日志", !fs.existsSync(path.join(process.cwd(), "Typora_Hook_Log.txt")));
}

function snapshotRegistry() {
    try {
        const out = execFileSync("reg.exe", ["query", "HKCU\\Software\\Typora"], { encoding: "utf-8" });
        const vals = {};
        out.split(/\r?\n/).forEach((line) => {
            const m = /^\s{4}(\S+)\s+REG_SZ\s*(.*)$/.exec(line);
            if (m) vals[m[1]] = m[2];
        });
        return vals;
    } catch (e) {
        return null; // 键不存在
    }
}

function restoreRegistry(snap) {
    try {
        if (snap === null) {
            execFileSync("reg.exe", ["delete", "HKCU\\Software\\Typora", "/f"], { stdio: "ignore" });
            return;
        }
        Object.keys(snap).forEach((k) => {
            execFileSync("reg.exe", ["add", "HKCU\\Software\\Typora", "/v", k, "/t", "REG_SZ", "/d", snap[k], "/f"], { stdio: "ignore" });
        });
    } catch (e) {
        console.log("  注册表还原失败(可忽略): " + e.message);
    }
}

(async () => {
    console.log("== mdKit 端到端自检 ==");
    console.log("真实 Typora（仅用于构造夹具）: " + REAL);
    if (!fs.existsSync(EXE)) {
        console.error("未找到 " + EXE + "，请先运行: npm run build");
        process.exit(1);
    }
    if (!fs.existsSync(path.join(REAL, "Typora.exe"))) {
        console.error("未找到真实 Typora: " + REAL + "（自检需要它来构造夹具）");
        process.exit(1);
    }
    if (!fs.existsSync(REAL_ASAR)) {
        console.error("未找到 app.asar 或 app.asar.bak: " + REAL + "\\resources（自检需要它来构造夹具）");
        process.exit(1);
    }

    const snap = snapshotRegistry();
    console.log("注册表快照: " + JSON.stringify(snap));

    try {
        for (const debugOn of [false, true]) {
            const dirName = debugOn ? "verify-sandbox-debug" : "verify-sandbox";
            console.log("\n-- 夹具 " + dirName + " (debug=" + debugOn + ") --");
            const sb = await makeFixture(dirName);
            const out = crack(sb, debugOn ? ["-d"] : []);
            check("[" + dirName + "] 破解退出正常且打印完成", out.includes("破解完成"), "");

            const appDir = path.join(sb, "resources", "app");
            const injectedFile = path.join(appDir, "launch.dist.js");
            check("[" + dirName + "] app/ 已解包", fs.existsSync(injectedFile));
            check("[" + dirName + "] app.bak/ 已生成", fs.existsSync(path.join(sb, "resources", "app.bak")));
            check("[" + dirName + "] app.asar.bak 已备份", fs.existsSync(path.join(sb, "resources", "app.asar.bak")));
            check("[" + dirName + "] Typora.exe.bak 已备份", fs.existsSync(path.join(sb, "Typora.exe.bak")));

            const injectedText = readUtf8(injectedFile);
            check("[" + dirName + "] 注入后仍以 \"use strict\" 开头", injectedText.startsWith('"use strict";'));
            check("[" + dirName + "] HookDebug = " + debugOn, injectedText.includes("const HookDebug = " + debugOn + ";"));

            execFileSync(process.execPath, ["--check", injectedFile]);
            check("[" + dirName + "] 注入后语法检查通过", true);

            await runtimeAssertions(sb, debugOn);
        }

        // --no-backup 选项已在 v2.1.0 移除（备份始终开启），此处断言备份文件必须存在
        console.log("\n-- 强制备份行为 --");
        const sbNoBak = await makeFixture("verify-sandbox-nobak");
        const outNoBak = crack(sbNoBak);
        check("[强制备份] 未提供关闭选项且正常完成", outNoBak.includes("破解完成"));
        check("[强制备份] 已生成 app.asar.bak", fs.existsSync(path.join(sbNoBak, "resources", "app.asar.bak")));
        check("[强制备份] 已生成 Typora.exe.bak", fs.existsSync(path.join(sbNoBak, "Typora.exe.bak")));
        // 激活码文件应写到 Typora 安装目录（沙箱夹具根目录）
        const codeFiles = fs.readdirSync(sbNoBak).filter((f) => f.startsWith("AAA_") && f.endsWith(".txt"));
        check("[强制备份] 激活码文件已生成到 Typora 安装目录", codeFiles.length >= 1, codeFiles.join(", "));
    } finally {
        restoreRegistry(snap);
        for (const d of ["verify-sandbox", "verify-sandbox-debug", "verify-sandbox-nobak"]) {
            fs.rmSync(path.join(ROOT, "build", d), { recursive: true, force: true });
        }
    }

    const failed = results.filter((r) => !r.pass);
    results.forEach((r) => console.log((r.pass ? "PASS " : "FAIL ") + r.name + (r.extra ? "   [" + r.extra + "]" : "")));
    console.log("\nTOTAL " + results.length + "  PASSED " + (results.length - failed.length) + "  FAILED " + failed.length);
    process.exit(failed.length ? 1 : 0);
})().catch((err) => {
    console.error("自检异常: " + (err && err.stack ? err.stack : err));
    process.exit(1);
});
