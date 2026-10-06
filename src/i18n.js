"use strict";

// 多语言支持：进入软件时先选择 简体中文 / English，之后伪装主页与破解流程均使用所选语言。
// esbuild 会把 src 下的模块打进同一个 bundle，cli.js 与 disguise.js 拿到的是同一份字典状态，
// 因此 cli.js 里 setLang 一次即可全局生效。字典值可为字符串或 (…args) => string 函数；
// t() 缺 key 时回落中文，再缺则返回 key 本身，保证漏译不会让程序崩溃。

const ZH = {
    // 通用
    appTitle: "Markdown 工具箱",
    enterContinue: "请按回车键继续...",
    pressAnyKey: "按任意键退出...",
    pressEnterExit: "按回车键退出...",
    errorMsg: function (msg) { return "错误: " + msg; },
    crackFailed: "破解失败: ",

    // 帮助
    helpCliTag: "  (独立命令行版)",
    argMissing: function (name) { return "选项 " + name + " 缺少参数"; },
    argUnknown: "未知选项: ",
    helpUsageLabel: "用法: mdKit.exe [选项]",
    helpOptionsLabel: "选项",
    helpOptPath: "-p, --path <目录>      指定 Typora 安装目录 (默认自动检测)",
    helpOptMachine: "-m, --machine <机器码>  机器码 (Base64, 交互模式下可省略)",
    helpOptEmail: "-e, --email <邮箱>      邮箱 (可选, 缺省自动随机生成)",
    helpOptDebug: "-d, --debug             开启 Hook 调试日志 (交互模式下也会询问)",
    helpOptNoDebug: "关闭 Hook 调试日志",
    helpOptYes: "-y, --yes               非交互模式 (此时 -m 必填)",
    helpOptHelp: "-h, --help              显示本帮助",
    helpOptVersion: "-v, --version           显示版本号",
    helpNotesLabel: "说明",
    helpNotesBody1: "备份始终开启; 邮箱缺省自动生成; 破解完成后激活码",
    helpNotesBody2: "会保存到 Typora 安装目录下的 AAA_邮箱.txt 文件里。",
    helpExamplesLabel: "示例",
    helpExample2: "mdKit.exe -p \"C:\\Program Files\\Typora\" -m <机器码> -y",

    // 一、定位 Typora
    invalidInstallDir: function (p) {
        return "指定的目录不是有效的 Typora 安装目录: " + p + "\n该目录下应包含 Typora.exe 和 resources 文件夹。";
    },
    detecting: "正在自动检测 Typora 安装目录...",
    foundTypora: function (dir) { return "已找到 Typora: " + dir; },
    sourceLabel: "  来源: ",
    srcArg: "命令行参数",
    srcManual: "手动输入",
    srcAppPaths: "注册表 App Paths",
    srcUninstall: "注册表卸载信息",
    srcProcess: "正在运行的 Typora 进程",
    srcCommon: "常见安装路径",
    noTyporaNonInteractive: "未检测到 Typora 安装目录，请使用 -p/--path 手动指定。",
    noTyporaInteractive: "未检测到 Typora 安装目录。",
    enterInstallDir: "请手动输入 Typora 安装目录: ",
    invalidDir: function (p) { return "目录无效: " + p; },
    closedAllProcesses: "已关闭所有 Typora.exe 进程",
    processNotRunning: "Typora.exe 未在运行。",
    closeManuallyHint: "如果 Typora 正在运行，请手动关闭后再继续。",

    // 二、机器码 / 邮箱
    enterMachineCode: "请输入机器码: ",
    machineRequired: "非交互模式必须提供 -m/--machine 机器码。",
    machineParseFailed: "机器码解析失败，请确认机器码是否正确（应为 Base64 编码的 JSON）。",
    emailGenerated: function (email) { return "已自动生成邮箱: " + email + " （如需指定请用 -e 参数）"; },
    askHookDebug: "是否开启 Hook 调试日志？（仅排查问题时需要，默认关闭）",
    backupDebugStatus: function (on) { return "备份: 始终开启  |  Hook 调试日志: " + (on ? t("debugOn") : t("debugOff")); },
    debugOn: "开启",
    debugOff: "关闭",

    // 三、破解过程
    startCrack: "==== 开始破解... ====",
    step1RemoveProtection: "一、正在解除 Typora 的防篡改保护...",
    asarNotFound: function (p) {
        return "未找到 app.asar: " + p + "\n该目录可能已经被破解过（app.asar 已被移除）。\n无需重复运行本工具；如需重新注入，请先用 app.asar.bak 还原后再试。";
    },
    extractAsar: function (dir) { return "解包 asar -> " + dir; },
    copyToBak: "复制 app 到 app.bak（递归复制）【应对完整性校验】",
    removeAsar: "移除 app.asar 文件",
    modifyFuse: "修改 Typora.exe 的 fuse 配置，允许加载未打包的 app 目录",
    exeBakExists: "已存在 Typora.exe.bak，跳过重复备份。",
    protectionRemoved: "防篡改保护已解除！",
    step2Inject: "二、正在注入破解代码到 launch.dist.js...",
    launchDistNotFound: function (p) { return "未找到 launch.dist.js: " + p; },
    injectSuccess: "成功插入破解代码到 launch.dist.js",
    injectNoRequire: "未找到 require 语句，破解代码未插入 launch.dist.js。",
    injectDone: "注入破解代码完成！",
    step3Registry: "三、正在修改注册表以关闭联网验证...",
    regWriteSuccess: function (name) { return name + " 注册表字段写入成功"; },
    regWriteFailed: "写入注册表失败:",

    // 四、收尾
    crackDone: "==== 破解完成！使用愉快！====",
    txtTitle: "Typora 激活码",
    txtCodeLabel: "激活码: ",
    txtEmailLabel: "邮箱:   ",
    txtDeviceLabel: "设备:   ",
    txtDateLabel: "日期:   ",
    txtUsage: "使用方法: 如弹出激活窗口，输入上面的激活码即可完成激活。",
    codeSavedTo: function (file) { return "激活码已保存到: " + file; },
    codeFileWriteFailed: function (file, msg) { return "激活码文件写入失败 (" + file + "): " + msg; },
    yourCode: function (code) { return "您的激活码为: " + code; },
    runSuccess: "  运行成功  ",
    activationCodeLabel: "激活码: ",
    codeSavedNote: "  （已保存到上面的 txt 文件）",
    suggestionsTitle: "后续操作建议：",
    suggestion1: "\t1. 关闭【自动检查更新】功能，防止被覆盖。",
    suggestion2: "\t2. 关闭【Typora服务器使用国内服务器】功能，避免绕过联网验证失败。",
    finishedExit: "运行完成，按回车键退出...",

    // 伪装主页
    menuTitle: "  Markdown 右键菜单工具",
    menuSep: "  =====================",
    menu1: "  1. 添加“新建 Markdown 文档”到右键菜单",
    menu2: "  2. 移除“新建 Markdown 文档”的右键菜单",
    menu3: "  3. 退出",
    statusPrefix: "  当前状态: ",
    statusAdded: "已添加",
    statusNotAdded: "未添加",
    menuPrompt: "输入对应数字后按下回车: ",
    addedMsg: "\n  已添加“新建 Markdown 文档”到右键菜单。（若菜单未立即出现，重启资源管理器即可）",
    removedMsg: "\n  已移除“新建 Markdown 文档”的右键菜单。",
    addFailed: "\n  添加失败: ",
    removeFailed: "\n  移除失败: ",
    invalidMenuInput: "  无效输入，请输入 1、2 或 3。\n",
};

const EN = {
    // Common
    appTitle: "Markdown Toolbox",
    enterContinue: "Press Enter to continue...",
    pressAnyKey: "Press any key to exit...",
    pressEnterExit: "Press Enter to exit...",
    errorMsg: function (msg) { return "Error: " + msg; },
    crackFailed: "Crack failed: ",

    // Help
    helpCliTag: "  (standalone CLI)",
    argMissing: function (name) { return "Option " + name + " requires a value"; },
    argUnknown: "Unknown option: ",
    helpUsageLabel: "Usage: mdKit.exe [options]",
    helpOptionsLabel: "Options",
    helpOptPath: "-p, --path <dir>       Typora installation directory (auto-detected by default)",
    helpOptMachine: "-m, --machine <code>    Machine code (Base64; optional in interactive mode)",
    helpOptEmail: "-e, --email <email>     Email (optional; auto-generated if omitted)",
    helpOptDebug: "-d, --debug             Enable Hook debug log (also asked in interactive mode)",
    helpOptNoDebug: "Disable Hook debug log",
    helpOptYes: "-y, --yes               Non-interactive mode (-m is then required)",
    helpOptHelp: "-h, --help              Show this help",
    helpOptVersion: "-v, --version           Show version",
    helpNotesLabel: "Notes",
    helpNotesBody1: "backup is always on; email is auto-generated by default; after cracking, the",
    helpNotesBody2: "activation code is saved to AAA_<email>.txt in the Typora installation directory.",
    helpExamplesLabel: "Examples",
    helpExample2: "mdKit.exe -p \"C:\\Program Files\\Typora\" -m <machine code> -y",

    // Step 1: locate Typora
    invalidInstallDir: function (p) {
        return "The specified directory is not a valid Typora installation directory: " + p +
            "\nIt should contain Typora.exe and a resources folder.";
    },
    detecting: "Auto-detecting Typora installation directory...",
    foundTypora: function (dir) { return "Typora found: " + dir; },
    sourceLabel: "  Source: ",
    srcArg: "command line argument",
    srcManual: "manual input",
    srcAppPaths: "registry App Paths",
    srcUninstall: "registry uninstall info",
    srcProcess: "running Typora process",
    srcCommon: "common install paths",
    noTyporaNonInteractive: "Typora installation directory not found. Use -p/--path to specify it manually.",
    noTyporaInteractive: "Typora installation directory not found.",
    enterInstallDir: "Please enter the Typora installation directory manually: ",
    invalidDir: function (p) { return "Invalid directory: " + p; },
    closedAllProcesses: "All Typora.exe processes have been closed",
    processNotRunning: "Typora.exe is not running.",
    closeManuallyHint: "If Typora is running, please close it manually before continuing.",

    // Step 2: machine code / email
    enterMachineCode: "Please enter the machine code: ",
    machineRequired: "Non-interactive mode requires -m/--machine <machine code>.",
    machineParseFailed: "Failed to parse the machine code. Please check that it is correct (it should be Base64-encoded JSON).",
    emailGenerated: function (email) { return "Email auto-generated: " + email + " (use -e to specify one)"; },
    askHookDebug: "Enable Hook debug log? (only needed for troubleshooting, default: off)",
    backupDebugStatus: function (on) { return "Backup: always on  |  Hook debug log: " + (on ? t("debugOn") : t("debugOff")); },
    debugOn: "on",
    debugOff: "off",

    // Step 3: crack process
    startCrack: "==== Starting crack... ====",
    step1RemoveProtection: "1. Removing Typora's anti-tamper protection...",
    asarNotFound: function (p) {
        return "app.asar not found: " + p +
            "\nThis directory may already have been cracked (app.asar has been removed)." +
            "\nNo need to run this tool again; to re-inject, restore app.asar from app.asar.bak first.";
    },
    extractAsar: function (dir) { return "Extracting asar -> " + dir; },
    copyToBak: "Copying app to app.bak (recursive) [to pass the integrity check]",
    removeAsar: "Removing app.asar file",
    modifyFuse: "Modifying Typora.exe fuse config to allow loading the unpacked app directory",
    exeBakExists: "Typora.exe.bak already exists, skipping duplicate backup.",
    protectionRemoved: "Anti-tamper protection removed!",
    step2Inject: "2. Injecting crack code into launch.dist.js...",
    launchDistNotFound: function (p) { return "launch.dist.js not found: " + p; },
    injectSuccess: "Crack code inserted into launch.dist.js successfully",
    injectNoRequire: "No require statement found; crack code was NOT inserted into launch.dist.js.",
    injectDone: "Crack code injection complete!",
    step3Registry: "3. Modifying the registry to disable online verification...",
    regWriteSuccess: function (name) { return name + " registry value written successfully"; },
    regWriteFailed: "Failed to write registry:",

    // Step 4: finish
    crackDone: "==== Crack complete! Enjoy! ====",
    txtTitle: "Typora Activation Code",
    txtCodeLabel: "Code:   ",
    txtEmailLabel: "Email:  ",
    txtDeviceLabel: "Device: ",
    txtDateLabel: "Date:   ",
    txtUsage: "Usage: if the activation window pops up, enter the code above to complete activation.",
    codeSavedTo: function (file) { return "Activation code saved to: " + file; },
    codeFileWriteFailed: function (file, msg) { return "Failed to write activation code file (" + file + "): " + msg; },
    yourCode: function (code) { return "Your activation code: " + code; },
    runSuccess: "  Success  ",
    activationCodeLabel: "Activation code: ",
    codeSavedNote: "  (saved to the txt file above)",
    suggestionsTitle: "Suggested next steps:",
    suggestion1: "\t1. Turn off [Check for updates automatically] to prevent the crack from being overwritten.",
    suggestion2: "\t2. Turn off [Use China server for Typora services] to avoid failures when bypassing online verification.",
    finishedExit: "All done. Press Enter to exit...",

    // Disguise home page
    menuTitle: "  Markdown Context Menu Tool",
    menuSep: "  =====================",
    menu1: "  1. Add \"New Markdown document\" to the right-click menu",
    menu2: "  2. Remove \"New Markdown document\" from the right-click menu",
    menu3: "  3. Exit",
    statusPrefix: "  Current status: ",
    statusAdded: "Added",
    statusNotAdded: "Not added",
    menuPrompt: "Enter a number and press Enter: ",
    addedMsg: "\n  \"New Markdown document\" has been added to the right-click menu. (If it does not appear immediately, restart Explorer.)",
    removedMsg: "\n  \"New Markdown document\" has been removed from the right-click menu.",
    addFailed: "\n  Failed to add: ",
    removeFailed: "\n  Failed to remove: ",
    invalidMenuInput: "  Invalid input. Please enter 1, 2 or 3.\n",
};

const DICTS = { zh: ZH, en: EN };

let current = "zh";

function setLang(lang) {
    const k = String(lang == null ? "" : lang).trim().toLowerCase();
    current = (k === "en" || k === "english") ? "en" : "zh";
}

function getLang() {
    return current;
}

// 取词：支持带参数文案（字典值为函数时，把附加参数原样传给它）
function t(key) {
    const dict = DICTS[current] || ZH;
    let v = dict[key];
    if (v === undefined) v = ZH[key];
    if (v === undefined) return key;
    if (typeof v === "function") return v.apply(null, Array.prototype.slice.call(arguments, 1));
    return v;
}

// detect.js / cli.js 产出的“来源”是中文数据字符串，展示时按当前语言翻译；未登记的原样返回
const SOURCE_KEYS = {
    "命令行参数": "srcArg",
    "手动输入": "srcManual",
    "注册表 App Paths": "srcAppPaths",
    "注册表卸载信息": "srcUninstall",
    "正在运行的 Typora 进程": "srcProcess",
    "常见安装路径": "srcCommon",
};

function tSource(source) {
    const key = SOURCE_KEYS[source];
    return key ? t(key) : source;
}

// 询问界面语言：提问本身双语展示（选择前尚无单一界面语言）。
// EOF/管道等异常输入回落中文；无效输入双语提示后重问。
async function askLanguage(ask) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
        const ans = await ask(
            "请选择语言 / Please select a language:\n" +
            "  1. 简体中文\n" +
            "  2. English\n" +
            "输入 1 或 2 / Enter 1 or 2: "
        );
        if (ans == null) return "zh"; // stdin 关闭（EOF）时默认中文
        const s = String(ans).trim().toLowerCase();
        if (s === "1" || s === "zh" || s === "cn" || s === "中文" || s === "简体中文" || s === "chinese") return "zh";
        if (s === "2" || s === "en" || s === "english" || s === "英语" || s === "英文") return "en";
        console.log("  无效输入，请输入 1 或 2 / Invalid input. Please enter 1 or 2.\n");
    }
}

module.exports = { setLang, getLang, t, tSource, askLanguage };
