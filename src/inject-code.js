"use strict";

// 由 start.js 抽取的注入代码模板（保持与原脚本完全一致）
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

module.exports = { getInsertCode };
