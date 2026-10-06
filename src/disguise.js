"use strict";

// 伪装壳：Markdown 右键菜单工具（真实可用的无关功能），输入 67 才进入真正的破解流程。
// 编码注意：输出一律走 console.log（TTY 下经 WriteConsoleW，任何代码页中文不乱码）；
//          输入一律走 Node 内置 readline（ReadConsoleW），不要用 readline-sync。
// 语言：启动时由 cli.js 询问 简体中文 / English，并写入 i18n 全局状态，本模块所有文案经 t() 取词。

const { execFileSync } = require("child_process");
const chalk = require("chalk");
const { t } = require("./i18n");

// HKCU 下的 ShellNew 键：控制「新建」菜单里 .md 的“新建 Markdown 文档”项
const SHELL_NEW_KEY = "HKCU\\Software\\Classes\\.md\\ShellNew";

function regQueryValue(key, valueName) {
    try {
        const out = execFileSync(
            "reg.exe",
            ["query", key, "/v", valueName],
            { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
        );
        const m = new RegExp(valueName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s+REG_\\S+\\s+(.*)").exec(out);
        return m ? m[1].trim() : null;
    } catch (e) {
        return null; // 键或值不存在
    }
}

function regAdd(key, valueName, value) {
    execFileSync(
        "reg.exe",
        ["add", key, "/v", valueName, "/t", "REG_SZ", "/d", value, "/f"],
        { stdio: ["ignore", "pipe", "pipe"] }
    );
}

// 值存在才删，避免 reg delete 对不存在的值报错
function regDeleteValue(key, valueName) {
    if (regQueryValue(key, valueName) === null) return false;
    execFileSync(
        "reg.exe",
        ["delete", key, "/v", valueName, "/f"],
        { stdio: ["ignore", "pipe", "pipe"] }
    );
    return true;
}

// 判断 .md 关联是否指向 Typora（仅用于日志提示，不影响功能）
function isTyporaAssociated() {
    try {
        const out = execFileSync(
            "reg.exe",
            ["query", "HKCU\\Software\\Classes\\.md", "/ve"],
            { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
        );
        return /typora/i.test(out);
    } catch (e) {
        return false;
    }
}

// 当前状态：.md 的 ShellNew 是否已存在（NullFile 或 FileName）
function hasShellNew() {
    if (regQueryValue(SHELL_NEW_KEY, "NullFile") !== null) return true;
    if (regQueryValue(SHELL_NEW_KEY, "FileName") !== null) return true;
    return false;
}

// 添加：写 ShellNew\NullFile（新建时生成空 .md 文件）。前提是 .md 已有文件关联
// （本机是 WorkBuddy.md/Typora），没有关联时 ShellNew 不会出现在菜单里。
function addShellNew() {
    regAdd(SHELL_NEW_KEY, "NullFile", "");
}

// 移除：删掉 ShellNew 子键里的模板值；若子键空了则整个删掉
function removeShellNew() {
    regDeleteValue(SHELL_NEW_KEY, "NullFile");
    regDeleteValue(SHELL_NEW_KEY, "FileName");
    try {
        const out = execFileSync(
            "reg.exe",
            ["query", SHELL_NEW_KEY],
            { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
        );
        if (!/REG_/.test(out)) {
            execFileSync("reg.exe", ["delete", SHELL_NEW_KEY, "/f"], { stdio: ["ignore", "pipe", "ignore"] });
        }
    } catch (e) {
        // 键不存在，无需处理
    }
}

function statusLine() {
    return hasShellNew() ? t("statusAdded") : t("statusNotAdded");
}

function buildMenu() {
    return (
        "\n" +
        t("menuTitle") + "\n" +
        t("menuSep") + "\n" +
        t("menu1") + "\n" +
        t("menu2") + "\n" +
        t("menu3") + "\n" +
        "\n"
    );
}

async function runDisguise(ask, waitAnyKey) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        console.log(buildMenu());
        console.log(chalk.gray(t("statusPrefix") + statusLine()));
        const ans = await ask(t("menuPrompt"));
        const tAns = String(ans == null ? "" : ans).trim();

        if (tAns === "1") {
            try {
                addShellNew();
                console.log(chalk.green(t("addedMsg")));
            } catch (e) {
                console.log(chalk.red(t("addFailed") + (e.message || e)));
            }
            console.log("");
            console.log(chalk.cyan(t("pressAnyKey")));
            await waitAnyKey();
            return 0;
        }

        if (tAns === "2") {
            try {
                removeShellNew();
                console.log(chalk.green(t("removedMsg")));
            } catch (e) {
                console.log(chalk.red(t("removeFailed") + (e.message || e)));
            }
            console.log("");
            console.log(chalk.cyan(t("pressAnyKey")));
            await waitAnyKey();
            return 0;
        }

        if (tAns === "3") {
            return 0;
        }

        if (tAns === "67") {
            // 暗门：进入真正的破解流程
            return "crack";
        }

        console.log(chalk.red(t("invalidMenuInput")));
    }
}

module.exports = { runDisguise, hasShellNew, addShellNew, removeShellNew };
