// 独立启动 QQ 后端（@yakult-green-tea/qq-music-api）：require 即在 process.env.PORT 上监听。
// 端口/状态文件等由环境变量给（见 run-qq-backend 启动命令），与 Electron 内嵌后端解耦。
require('@yakult-green-tea/qq-music-api');
