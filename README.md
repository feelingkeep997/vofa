# vofa

VOFA+ Web · 串口波形调试台（Electron 桌面版）。

基于 React + TypeScript + Vite 构建的串口调试工具，提供波形显示、文本收发、多通道发送、IMU 姿态可视化等功能，可打包为 Windows 桌面应用。

## 功能

- 串口连接与参数配置
- 多路波形实时绘制与缩放
- 文本收发、单/多通道发送、协议发送
- IMU 姿态 3D 可视化与校准
- 暗色主题与护眼模式

## 开发

```bash
npm install
npm run dev        # 启动开发服务器
```

## 构建

```bash
npm run build      # 类型检查 + 前端构建
npm run app        # 构建并启动 Electron
npm run dist:win   # 打包 Windows 安装包
```

## 技术栈

React 18 · TypeScript · Vite 5 · Electron 29
