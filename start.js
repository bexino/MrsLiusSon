const asar = require("asar");
const chalk = require("chalk");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const readlineSync = require("readline-sync");
const WinReg = require("winreg");
const { flipFuses, FuseV1Options, FuseVersion } = require("@electron/fuses");

function getInsertCode(EnableHookDebug, atobMachineCode, email, nowDateStr) {
    return `
/** Hook破解开始 */
const electron = require("electron");
 
// 是否启用劫持调试
const HookDebug = ${EnableHookDebug ? "true" : "false"};
 
// 调试日志定义
// 日志固定写入 Typora 安装目录，避免在每个被打开的 md 文件旁生成日志
// 只用 require + process.execPath，不新增顶层标识符，防止与 launch.dist.js 变量冲突
const LOG_PATH = require("path").join(require("path").dirname(process.execPath), "Typora_Hook_Log.txt");
//fs.rmSync(LOG_PATH, { force: true });
function writeLog(...data) {
    // 未开启调试时直接返回：不创建、不写入 Typora_Hook_Log.txt。
    // 下方 fsHook / protocol.handle 中有部分无条件调用，必须在此处统一拦截。
    if (!HookDebug) return;
    const log = \`[\${new Date().toLocaleString()}] [Log] \${data.join(
        " "
    )}\\n------------------\\n\`;
    fs.appendFileSync(LOG_PATH, log);
}
 
// 调试模式只记录窗口创建，不改写 app.quit，也不自动打开 DevTools。
// 改写 app.quit 会让前台窗口关闭后主进程残留，双击 md 时 second-instance 无法正常唤起窗口。
if (HookDebug) {
    electron.app.on("browser-window-created", (_event, win) => {
        writeLog("【&#128064; 监控】检测到 BrowserWindow 实例化！");
    });
}
 
// Hook fs 模块，重定向对 resources/app 目录的访问
// resources/app/ → resources/app.bak/
const fsPathFrom = /resources[\\\\/]app[\\\\/]/i;
const fsPathTo = "resources\\\\app.bak\\\\";
const fsHook = {};
[
    "readFileSync",
    "readFile",
    "statSync",
    "stat",
    "Stats",
    "StatsFs",
    "open",
    "openSync",
].forEach((property) => {
    fsHook[property] = fs[property];
    fs[property] = function (filePath, ...args) {
        if (typeof filePath == "string" && fsPathFrom.test(filePath)) {
            const redirectPath = filePath.replace(fsPathFrom, fsPathTo);
            if (HookDebug) {
                writeLog(
                    \`[&#128737;&#65039; fsHook] 程序试图 fs.\${property} 重定向 \${filePath} --> \${redirectPath}\`
                );
            }
            return fsHook[property].call(this, redirectPath, ...args);
        }
        if (HookDebug) writeLog(\`[&#128737;&#65039; fsHook] 程序试图 fs.\${property} \${filePath}\`);
        return fsHook[property].call(this, filePath, ...args);
    };
});
const fsPromisesHook = {};
["readFile", "open", "stat"].forEach((property) => {
    fsPromisesHook[property] = fs.promises[property];
    fs.promises[property] = async function (filePath, ...args) {
        if (typeof filePath == "string" && fsPathFrom.test(filePath)) {
            const redirectPath = filePath.replace(fsPathFrom, fsPathTo);
            if (HookDebug) {
                writeLog(
                    \`[&#128737;&#65039; fsHook/Promises] 程序试图 fs.promises.\${property} 重定向 \${filePath} --> \${redirectPath}\`
                );
            }
            return fsPromisesHook[property].call(this, redirectPath, ...args);
        }

        return fsPromisesHook[property].call(this, filePath, ...args);
    };
});
 
// IPC 通信进行监控
if (HookDebug) {
    const invokeFilter = ["document.addSnapAndLastSync", "document.setContent"];
    const originalIpcMainHandle = electron.ipcMain.handle;
    electron.ipcMain.handle = function (channel, listener) {
        // writeLog(\`[IPC 注册] .handle 监听频道: "\${channel}"\`);
        const filter = !invokeFilter.includes(channel);
        return originalIpcMainHandle.call(this, channel, async (event, ...args) => {
            filter &&
                writeLog(
                    \`[&#128064;IPC 请求] 收到 .invoke("\${channel}") 参数:\`,
                    JSON.stringify(args)
                );
            try {
                const result = await listener(event, ...args);
                filter &&
                    writeLog(
                        \`[&#128064;IPC 响应] .handle("\${channel}") 返回结果:\`,
                        JSON.stringify(result)
                    );
                return result;
            } catch (error) {
                filter && writeLog(\`[&#128064;IPC 错误] .handle("\${channel}") 执行出错:\`, error);
                throw error;
            }
        });
    };
}
 
 
const crypto = require("crypto");
 
const originalPublicDecrypt = crypto.publicDecrypt;
crypto.publicDecrypt = function (key, buffer) {
    if (HookDebug) {
        writeLog("-------------------------------------------");
        writeLog("【&#128064; 监控】 crypto.publicDecrypt 被调用");
        writeLog("Key:", key);
        writeLog("Buffer (Hex):", buffer.toString("hex"));
    }
    // return originalPublicDecrypt.call(this, key, buffer);
    // 直接返回伪造的明文 Buffer
    return Buffer.from(
        JSON.stringify({
            deviceId: "${atobMachineCode.l}",
            fingerprint: "${atobMachineCode.i}",
            email: "${email}",
            license: "Cracked_By_DreamNya",
            version: "${atobMachineCode.v}",
            date: "${nowDateStr}",
            type: "DreamNya",
        })
    );
};
 
// 劫持联网验证
electron.app.whenReady().then(() => {
    electron.protocol.handle("https", async (request) => {
        if (HookDebug) {
            writeLog(\`[&#128064;electron.net Request] \${request.method} \${request.url}\`);
            writeLog("request.url typeof:", typeof request.url, "value:", request.url);
        }
        // 拦截目标请求，伪造响应
        if (request.url === "https://store.typora.io/api/client/renew") {
            if (HookDebug){
                writeLog(\`[&#128737;&#65039; 拦截] 伪造激活验证响应: {success:true, msg: \${btoa("DreamNya")}}\`);
            }
            return new Response(
                JSON.stringify({ success: true, msg: btoa("DreamNya") }),
                {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }
            );
        }
 
        if (HookDebug) {
            // 尝试打印 Request Body
            try {
                const reqClone = request.clone();
                const reqBody = await reqClone.text();
                if (reqBody) {
                    writeLog('[electron.net Request Body]:', reqBody);
                }
            } catch { }
 
            // 其他请求正常转发
            const response = await electron.net.fetch(request, { bypassCustomProtocolHandlers: true });
 
            // 克隆响应用于日志
            const resClone = response.clone();
            resClone
                .text()
                .then((resText) => {
                    writeLog(\`[&#128064;electron.net Response] \${response.status} \${request.url}\`);
                    writeLog('[electron.net Response Body]:', resText.substring(0, 500));
                })
                .catch((err) => {
                    console.error('[electron.net Response Error]:', err);
                });
 
            return response;
        }
 
        // 未开启调试时同样要转发请求：protocol.handle 的回调若返回 undefined，
        // Electron 会判定协议处理失败，导致 Typora 全部 https 请求报错。
        return electron.net.fetch(request, { bypassCustomProtocolHandlers: true });
    });
});
/** Hook破解结束 */
`;
}

let EnableBackup = false; // 是否备份原始文件
let EnableHookDebug = false; // 是否启用调试日志

const Typora_Installation_Path = "D:\\Program Files (x86)\\Typora";
const resourcesPath = path.join(Typora_Installation_Path, "resources");
const asarPath = path.join(resourcesPath, "app.asar");
const appDir = path.join(resourcesPath, "app");
const appBakDir = path.join(resourcesPath, "app.bak");
const asarBakPath = path.join(resourcesPath, "app.asar.bak");
const TyporaEXE = path.join(Typora_Installation_Path, "Typora.exe");
const LaunchDistJS = path.join(appDir, "launch.dist.js");

// 随机生成一个符合前端验证格式的注册码
function generateRegCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '+';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    code += '#';
    return code;
}

function closeTyporaProcesses() {
    try {
        execSync("taskkill /F /IM Typora.exe");
        console.log(chalk.green("已关闭所有 Typora.exe 进程"));
    } catch (e) {
        console.log(chalk.red("Typora.exe 未运行或关闭失败,请手动关闭后继续。"));
    }

    console.log(
        chalk.yellow(
            "已尝试自动关闭所有 Typora.exe 进程，如果未关闭请手动关闭后再运行此程序。"
        )
    );

    // 回车继续
    console.log(chalk.cyan("请按回车键继续..."));
    readlineSync.question();
}

function setRegValue(regKey, name, value) {
    return new Promise((resolve, reject) => {
        regKey.set(name, WinReg.REG_SZ, value, function (err) {
            if (err) reject(err);
            else resolve();
        });
    });
}

function getNowDateStr() {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = now.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}
const nowDateStr = getNowDateStr();

// 要求输入机器码和邮箱
console.log(chalk.cyan("请输入机器码: "));
const machineCode = readlineSync.question();
console.log(chalk.cyan("请输入邮箱: "));
const email = readlineSync.question();
// 询问是否开启备份（默认开启）与调试（默认关闭）
console.log(chalk.cyan("请选择是否开启备份与调试选项:"));
console.log(chalk.cyan("【建议开启】是否开启备份？(Y/N): "));
const backupAnswer = readlineSync.question();
console.log(chalk.cyan("【建议关闭】是否开启调试？(Y/N): "));
const debugAnswer = readlineSync.question();
EnableBackup = backupAnswer.toLowerCase() === "y";
EnableHookDebug = debugAnswer.toLowerCase() === "y";

// Base64 解码
function atob(str) {
    return Buffer.from(str, "base64").toString("utf-8");
}
const atobMachineCode = JSON.parse(atob(machineCode));

console.log(chalk.yellow("deviceId: " + atobMachineCode.l));
console.log(chalk.yellow("fingerprint: " + atobMachineCode.i));
console.log(chalk.yellow("version: " + atobMachineCode.v));

// 关闭所有 Typora.exe 进程
closeTyporaProcesses();
console.log(chalk.green("==== 开始破解... ===="));

async function main() {
    // 一、反反调试

    console.log(chalk.yellow("一、正在进行反反调试操作..."));
    console.log(chalk.yellow("解包 asar"));
    await asar.extractAll(asarPath, appDir);

    console.log(
        chalk.yellow("复制 app 到 app.bak（递归复制）【应对完整性校验】")
    );
    // 2. 复制 app 到 app.bak（递归复制）
    function copyDir(src, dest) {
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
            const srcPath = path.join(src, entry.name);
            const destPath = path.join(dest, entry.name);
            if (entry.isDirectory()) {
                copyDir(srcPath, destPath);
            } else {
                fs.copyFileSync(srcPath, destPath);
            }
        }
    }
    copyDir(appDir, appBakDir);

    console.log(chalk.yellow("移除 app.asar 文件"));
    // 3. 重命名 app.asar 为 app.asar.bak
    if (EnableBackup) {
        fs.renameSync(asarPath, asarBakPath);
    } else {
        fs.rmSync(asarPath, { force: true });
    }

    console.log(
        chalk.yellow("修改 Typora.exe 的 fuse 配置，允许加载未打包的 app 目录")
    );

    if (EnableBackup) {
        // 修改前先备份
        fs.copyFileSync(TyporaEXE, `${TyporaEXE}.bak`);
    }

    // 修改fuse配置（同时会修改程序hash）
    flipFuses(TyporaEXE, {
        version: FuseVersion.V1,
        [FuseV1Options.OnlyLoadAppFromAsar]: false,
    });

    console.log(chalk.green("反反调试操作完成！"));

    // 二、注入破解代码
    console.log(chalk.yellow("二、正在注入破解代码到 launch.dist.js..."));

    // 读取原文件内容
    let content = fs.readFileSync(LaunchDistJS, "utf-8");

    // 查找第一个require语句后的分号
    const requireRegex = /require\([^)]+\);/;
    const match = requireRegex.exec(content);

    if (match) {
        const insertPos = match.index + match[0].length;
        const insertCode = getInsertCode(
            EnableHookDebug,
            atobMachineCode,
            email,
            nowDateStr
        );
        // 插入代码
        content =
            content.slice(0, insertPos) + insertCode + content.slice(insertPos);
        fs.writeFileSync(LaunchDistJS, content, "utf-8");
        console.log(chalk.green("成功插入破解代码到 launch.dist.js"));
    } else {
        console.log(
            chalk.red("未找到 require 语句，破解代码未插入launch.dist.js。")
        );
    }

    console.log(chalk.green("注入破解代码完成！"));

    // // 三、注册激活
    // console.log(chalk.yellow("三、正在注册激活..."));
    // try {
    //     execSync(`start "" "${TyporaEXE}"`);
    //     console.log(chalk.green("Typora 已启动！"));
    // } catch (e) {
    //     console.log(chalk.red("Typora 启动失败，请手动打开。"));
    // }

    // const regCode = generateRegCode();
    // console.log(chalk.green(`您的注册码为：${regCode}`));
    // console.log(chalk.yellow("请复制并用于激活。"));
    // console.log(chalk.cyan("请按回车键继续..."));


    // // 关闭Typora进程
    // closeTyporaProcesses();

    // 三、修改注册表
    console.log(chalk.yellow("三、正在修改注册表以关闭联网验证..."));
    // 修改注册表，尽量关闭联网验证
    // 注册表路径
    const regKey = new WinReg({
        hive: WinReg.HKCU,
        key: "\\Software\\Typora",
    });

    try {
        await setRegValue(regKey, "SLicense", "RHJlYW1OeWE=#0#1/1/2029");
        console.log(chalk.green("SLicense 注册表字段写入成功"));
        await setRegValue(regKey, "IDate", nowDateStr);
        console.log(chalk.green("IDate 注册表字段写入成功"));
    } catch (err) {
        console.log(chalk.red("写入注册表失败:"), err);
    }

    console.log(chalk.green("==== 破解完成！使用愉快！===="));
    console.log(chalk.yellow("后续操作建议：\n"));
    const regCode = generateRegCode();
    console.log(chalk.green(`\t1.您的注册码为：${regCode} 请复制并用于激活。`));
    console.log(chalk.yellow("\t2. 关闭【自动检查更新】功能，防止被覆盖。"));
    console.log(
        chalk.yellow(
            "\t3. 关闭【Typora服务器使用国内服务器】功能，避免绕过联网验证失败。"
        )
    );
}

main();
