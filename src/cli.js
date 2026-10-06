"use strict";

const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");
const readline = require("readline");
const chalk = require("chalk");
const asar = require("asar");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");
const { getInsertCode } = require("./inject-code");
const { detectTyporaPath, isTyporaDir } = require("./detect");
const { runDisguise } = require("./disguise");
const { setLang, t, tSource, askLanguage } = require("./i18n");

const VERSION = "2.1.0";

// 帮助文案按当前语言生成（语言在 main 入口处选择）
function buildHelp() {
    return [
        "",
        "  " + t("appTitle") + " v" + VERSION + t("helpCliTag"),
        "",
        "  " + t("helpUsageLabel"),
        "",
        "  " + t("helpOptionsLabel") + ":",
        "    " + t("helpOptPath"),
        "    " + t("helpOptMachine"),
        "    " + t("helpOptEmail"),
        "    " + t("helpOptDebug"),
        "        --no-debug      " + t("helpOptNoDebug"),
        "    " + t("helpOptYes"),
        "    " + t("helpOptHelp"),
        "    " + t("helpOptVersion"),
        "",
        "  " + t("helpNotesLabel") + ": " + t("helpNotesBody1"),
        "        " + t("helpNotesBody2"),
        "",
        "  " + t("helpExamplesLabel") + ":",
        "    mdKit.exe",
        "    " + t("helpExample2"),
        "",
    ].join("\n");
}

function parseArgs(argv) {
    const opts = {
        path: null,
        machine: null,
        email: null,
        debug: false,
        yes: false,
        help: false,
        version: false,
    };
    const need = function (i, name) {
        if (i + 1 >= argv.length) {
            const err = new Error(t("argMissing", name));
            err.exitCode = 2;
            throw err;
        }
        return argv[i + 1];
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "-h" || a === "--help") opts.help = true;
        else if (a === "-v" || a === "--version") opts.version = true;
        else if (a === "-y" || a === "--yes") opts.yes = true;
        else if (a === "-d" || a === "--debug") opts.debug = true;
        else if (a === "--no-debug") opts.debug = false;
        else if (a === "-p" || a === "--path") { opts.path = need(i, a); i++; }
        else if (a === "-m" || a === "--machine") { opts.machine = need(i, a); i++; }
        else if (a === "-e" || a === "--email") { opts.email = need(i, a); i++; }
        else if (a.startsWith("--path=")) opts.path = a.slice(7);
        else if (a.startsWith("--machine=")) opts.machine = a.slice(10);
        else if (a.startsWith("--email=")) opts.email = a.slice(8);
        else {
            const err = new Error(t("argUnknown") + a);
            err.exitCode = 2;
            err.showHelp = true;
            throw err;
        }
    }
    return opts;
}

// 交互输入统一走 Node 内置 readline（输出经 process.stdout 的 WriteConsoleW 宽字符接口，
// 输入经 ReadConsoleW），在 GBK 代码页的控制台里中文提示不会乱码。
// 注意：readline-sync 的 fs.writeSync(fd) 裸写 UTF-8 字节会被按 GBK 解码导致乱码，已弃用。
let rlInstance = null;
function getRl() {
    if (!rlInstance) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            historySize: 0,
        });
        // stdin 结束（EOF）时置空实例，避免后续 ask() 在已关闭的接口上挂死
        rl.on("close", function () {
            if (rlInstance === rl) rlInstance = null;
        });
        rlInstance = rl;
    }
    return rlInstance;
}
function closeRl() {
    if (rlInstance) {
        rlInstance.close();
        rlInstance = null;
    }
}

function ask(question) {
    return new Promise(function (resolve) {
        const rl = getRl();
        const onClose = function () { resolve(null); };
        rl.once("close", onClose);
        rl.question(chalk.cyan(question), function (ans) {
            rl.removeListener("close", onClose);
            resolve(ans);
        });
    });
}

async function pause(interactive) {
    if (!interactive) return;
    await ask(t("enterContinue"));
}

async function askYesNo(question, defaultYes, interactive) {
    if (!interactive) return defaultYes;
    const hint = defaultYes ? "[Y/n]" : "[y/N]";
    const t = String(await ask(question + " " + hint + ": ")).trim().toLowerCase();
    if (!t) return defaultYes;
    return t === "y" || t === "yes" || t === "是";
}

// 结束前停住窗口（仅 TTY），用户按任意键（raw 模式单键读取）或回车后退出
async function holdExit(message) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;
    console.log(chalk.cyan(message));
    try {
        await waitAnyKey();
    } catch (e) { /* raw 模式不可用时忽略 */ }
}

// 单键读取（按任意键），失败时回退到整行回车
let wasRaw = false;
function waitAnyKey() {
    return new Promise(function (resolve) {
        try {
            const stdin = process.stdin;
            wasRaw = !!stdin.isRaw;
            stdin.setRawMode(true);
            stdin.resume();
            const onData = function () {
                try { stdin.setRawMode(wasRaw); } catch (e2) { /* ignore */ }
                stdin.pause();
                stdin.removeListener("data", onData);
                resolve();
            };
            stdin.once("data", onData);
        } catch (e) {
            resolve();
        }
    });
}

function generateEmail() {
    const letters = "abcdefghijklmnopqrstuvwxyz";
    const alnum = letters + "0123456789";
    let user = "";
    for (let i = 0; i < 8; i++) {
        user += (i === 0 ? letters : alnum).charAt(Math.floor(Math.random() * (i === 0 ? letters : alnum).length));
    }
    const domains = ["gmail.com", "outlook.com", "hotmail.com", "yahoo.com", "qq.com", "163.com", "126.com", "foxmail.com"];
    return user + "@" + domains[Math.floor(Math.random() * domains.length)];
}

function closeTyporaProcesses(interactive) {
    let killed = false;
    try {
        execSync("taskkill /F /IM Typora.exe", { stdio: "ignore", windowsHide: true });
        killed = true;
        console.log(chalk.green(t("closedAllProcesses")));
    } catch (e) {
        console.log(chalk.gray(t("processNotRunning")));
    }
    if (!killed && interactive) {
        console.log(chalk.yellow(t("closeManuallyHint")));
    }
}

// 直接调用 reg.exe（不经 shell），避免 winreg 的 shell:true 触发 DEP0190 弃用警告
function setRegValue(name, value) {
    execFileSync(
        "reg.exe",
        ["add", "HKCU\\Software\\Typora", "/v", name, "/t", "REG_SZ", "/d", value, "/f"],
        { stdio: ["ignore", "pipe", "pipe"] }
    );
}

function getNowDateStr() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    return mm + "/" + dd + "/" + yyyy;
}

function generateRegCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "+";
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += "#";
    return code;
}

function atob(str) {
    return Buffer.from(str, "base64").toString("utf-8");
}

// 提前终止统一入口：抛出带 exitCode 的错误，由 main().catch 统一打印并停住窗口。
// 绝不要在这里直接 process.exit()——那会绕过停窗逻辑，用户来不及看红字窗口就没了。
function fatal(message, exitCode) {
    const err = new Error(message);
    err.fatal = true;
    err.exitCode = exitCode || 1;
    throw err;
}

// 把邮箱转成合法的 Windows 文件名（生成的邮箱本身安全，这里兜底处理 -e 传入的自定义邮箱）
function emailToFileName(email) {
    return "AAA_" + String(email).replace(/[\\/:*?"<>|]/g, "_").trim() + ".txt";
}

function copyDir(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) copyDir(srcPath, destPath);
        else fs.copyFileSync(srcPath, destPath);
    }
}

async function resolveInstallPath(opts, interactive) {
    if (opts.path) {
        const p = path.resolve(opts.path);
        if (!isTyporaDir(p)) {
            fatal(t("invalidInstallDir", p), 1);
        }
        return { dir: p, source: "命令行参数" };
    }

    console.log(chalk.yellow(t("detecting")));
    const found = detectTyporaPath();
    if (found) {
        console.log(chalk.green(t("foundTypora", found.dir)));
        console.log(chalk.gray(t("sourceLabel") + tSource(found.source)));
        return found;
    }

    if (!interactive) {
        fatal(t("noTyporaNonInteractive"), 1);
    }

    console.log(chalk.red(t("noTyporaInteractive")));
    const manual = await ask(t("enterInstallDir"));
    const p = path.resolve(String(manual).trim().replace(/^"|"$/g, ""));
    if (!isTyporaDir(p)) {
        fatal(t("invalidDir", p), 1);
    }
    return { dir: p, source: "手动输入" };
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));

    if (opts.version) {
        console.log("mdKit v" + VERSION);
        return;
    }

    // 交互界面语言：进入软件时先询问 简体中文 / English，之后伪装主页与破解流程都使用该语言。
    // 无参数 + TTY 才询问（与伪装壳条件一致）；带参数（-y/-p/-m 等脚本与自检场景）跳过询问，
    // 默认中文，行为与旧版一致。-h/--help 在询问语言之后按所选语言显示。
    const noArgs = process.argv.slice(2).length === 0;
    const interactiveLang = noArgs && !opts.yes;

    if (interactiveLang && process.stdin.isTTY && process.stdout.isTTY) {
        const lang = await askLanguage(ask);
        setLang(lang);
        console.log("");
    }

    if (opts.help) {
        console.log(buildHelp());
        return;
    }

    // 伪装壳：无参数 + TTY 时先显示 Markdown 右键菜单；输入 67 才进入破解。
    // 带任何参数（-y/-p/-m 等）直接走破解，保证脚本与自检不受影响。
    if (interactiveLang && process.stdin.isTTY && process.stdout.isTTY) {
        const verdict = await runDisguise(ask, waitAnyKey);
        if (verdict !== "crack") {
            closeRl();
            return;
        }
        console.log("");
    }

    const interactive = !opts.yes;

    console.log("");
    console.log(chalk.bgCyan.black("  " + t("appTitle") + " v" + VERSION + "  "));
    console.log("");
    // 一、定位 Typora
    const install = await resolveInstallPath(opts, interactive);
    const Typora_Installation_Path = install.dir;
    const resourcesPath = path.join(Typora_Installation_Path, "resources");
    const asarPath = path.join(resourcesPath, "app.asar");
    const appDir = path.join(resourcesPath, "app");
    const appBakDir = path.join(resourcesPath, "app.bak");
    const asarBakPath = path.join(resourcesPath, "app.asar.bak");
    const TyporaEXE = path.join(Typora_Installation_Path, "Typora.exe");
    const LaunchDistJS = path.join(appDir, "launch.dist.js");

    // 二、机器码 / 邮箱
    let machineCode = opts.machine;
    if (!machineCode) {
        if (!interactive) {
            fatal(t("machineRequired"), 2);
        }
        console.log(chalk.cyan(t("enterMachineCode")));
        machineCode = await ask("");
    }
    machineCode = String(machineCode).trim();

    let atobMachineCode = null;
    try {
        atobMachineCode = JSON.parse(atob(machineCode));
    } catch (e) {
        fatal(t("machineParseFailed"), 1);
    }

    // 邮箱：可选参数，缺省自动随机生成（不影响破解效果，格式对即可）
    let email = opts.email;
    if (!email) {
        email = generateEmail();
        console.log(chalk.gray(t("emailGenerated", email)));
    }
    email = String(email).trim();

    console.log("");
    console.log(chalk.yellow("deviceId:    " + atobMachineCode.l));
    console.log(chalk.yellow("fingerprint: " + atobMachineCode.i));
    console.log(chalk.yellow("version:     " + atobMachineCode.v));
    console.log(chalk.yellow("email:       " + email));
    console.log("");

    // 三、备份 / 调试（备份始终开启；调试日志由用户选择，-d 参数可强制开启）
    const EnableBackup = true;
    const EnableHookDebug = opts.debug
        ? true
        : await askYesNo(t("askHookDebug"), false, interactive);

    console.log(chalk.yellow(t("backupDebugStatus", EnableHookDebug)));    console.log("");

    const nowDateStr = getNowDateStr();

    // 四、关闭 Typora
    await closeTyporaProcesses(interactive);
    await pause(interactive);

    console.log(chalk.green(t("startCrack")));

    // 五、解除防篡改保护（解包 asar / 关闭 asar 强制加载开关）
    console.log(chalk.yellow(t("step1RemoveProtection")));

    if (!fs.existsSync(asarPath)) {
        fatal(t("asarNotFound", asarPath), 1);
    }

    console.log(chalk.yellow(t("extractAsar", appDir)));
    await asar.extractAll(asarPath, appDir);

    console.log(chalk.yellow(t("copyToBak")));
    copyDir(appDir, appBakDir);

    console.log(chalk.yellow(t("removeAsar")));
    if (EnableBackup) {
        if (fs.existsSync(asarBakPath)) fs.rmSync(asarBakPath, { force: true });
        fs.renameSync(asarPath, asarBakPath);
    } else {
        fs.rmSync(asarPath, { force: true });
    }

    console.log(chalk.yellow(t("modifyFuse")));
    if (EnableBackup) {
        const exeBak = TyporaEXE + ".bak";
        if (!fs.existsSync(exeBak)) {
            fs.copyFileSync(TyporaEXE, exeBak);
        } else {
            console.log(chalk.gray(t("exeBakExists")));
        }
    }
    await flipFuses(TyporaEXE, {
        version: FuseVersion.V1,
        [FuseV1Options.OnlyLoadAppFromAsar]: false,
    });
    console.log(chalk.green(t("protectionRemoved")));

    // 六、注入破解代码
    console.log(chalk.yellow(t("step2Inject")));
    if (!fs.existsSync(LaunchDistJS)) {
        fatal(t("launchDistNotFound", LaunchDistJS), 1);
    }
    let content = fs.readFileSync(LaunchDistJS, "utf-8");
    const requireRegex = /require\([^)]+\);/;
    const match = requireRegex.exec(content);
    if (match) {
        const insertPos = match.index + match[0].length;
        const insertCode = getInsertCode(EnableHookDebug, atobMachineCode, email, nowDateStr);
        content = content.slice(0, insertPos) + insertCode + content.slice(insertPos);
        fs.writeFileSync(LaunchDistJS, content, "utf-8");
        console.log(chalk.green(t("injectSuccess")));
    } else {
        console.log(chalk.red(t("injectNoRequire")));
    }
    console.log(chalk.green(t("injectDone")));

    // 七、注册表
    console.log(chalk.yellow(t("step3Registry")));
    try {
        setRegValue("SLicense", "RHJlYW1OeWE=#0#1/1/2029");
        console.log(chalk.green(t("regWriteSuccess", "SLicense")));
        setRegValue("IDate", nowDateStr);
        console.log(chalk.green(t("regWriteSuccess", "IDate")));
    } catch (err) {
        console.log(chalk.red(t("regWriteFailed")), err);
    }

    console.log("");
    console.log(chalk.green(t("crackDone")));
    const regCode = generateRegCode();

    // 八、激活码落盘：写到 Typora 安装目录，AAA_ 前缀保证在资源管理器里排最前
    const outDir = Typora_Installation_Path;
    const codeFile = path.join(outDir, emailToFileName(email));
    const codeContent = [
        t("txtTitle"),
        "==============================",
        t("txtCodeLabel") + regCode,
        t("txtEmailLabel") + email,
        t("txtDeviceLabel") + atobMachineCode.l,
        t("txtDateLabel") + nowDateStr,
        "",
        t("txtUsage"),
        "",
    ].join("\r\n");
    try {
        fs.writeFileSync(codeFile, codeContent, "utf-8");
        console.log(chalk.green(t("codeSavedTo", codeFile)));
    } catch (err) {
        console.log(chalk.red(t("codeFileWriteFailed", codeFile, err.message)));
        console.log(chalk.green(t("yourCode", regCode)));
    }

    console.log("");
    console.log(chalk.bgGreen.black(t("runSuccess")));
    console.log(chalk.green(t("activationCodeLabel") + regCode + t("codeSavedNote")));
    console.log(chalk.yellow(t("suggestionsTitle")));
    console.log(chalk.yellow(t("suggestion1")));
    console.log(chalk.yellow(t("suggestion2")));
    console.log("");
    await holdExit(t("finishedExit"));
    closeRl();
}

main().catch(async function (err) {
    // 停住窗口让用户看清信息；只有在 TTY 下才等待，-y/管道场景直接退出
    const canHold = process.stdin.isTTY && process.stdout.isTTY;
    if (err && err.showHelp) {
        console.error(buildHelp());
    }
    if (err && err.fatal) {
        console.error("");
        console.error(chalk.red(t("errorMsg", err.message)));
    } else {
        console.error("");
        console.error(chalk.red(t("crackFailed") + (err && err.stack ? err.stack : err)));
    }
    if (canHold) {
        try {
            await ask(t("pressEnterExit"));
        } catch (e) { /* readline 不可用时忽略 */ }
    }
    closeRl();
    process.exitCode = (err && err.exitCode) || 1;
});
