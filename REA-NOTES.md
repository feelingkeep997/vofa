# VOFA+ 逆向取证记录（REA）

> 目标：`D:\bishe\x64\vofa+.exe`
> 工具：REA 6.4.0（`Desktop\pro\rea`）+ Ghidra 12.1.4 headless
> 目的：给 `vofa`（Web 版克隆）定 UI 结构、协议、配色与交互，不猜。

## 1. 样本身份

| 项 | 值 |
| --- | --- |
| 格式 | PE32+ / x86_64 / executable |
| SHA-256 | `d4e53ea60484293b1a701ebe7a4d2db38fee267ebeab24746565f6b14ec0c370` |
| 大小 | 3,423,744 B（2021-03-14） |
| image_base | `0x140000000` |
| 段 | .text 366KB / .rdata 3.0MB / .data 31KB / .rsrc 18.9KB |
| 函数 | 3093 |
| 字符串 | 15745 |
| 框架 | Qt 5.15 + QML（同目录 `Qt5Core/Qml/Quick/SerialPort.dll`，`qmlcache/*.qmlc`） |

**结论：这是个 Qt/QML 应用，不是 Electron。** 业务逻辑一半在 C++（协议解析），一半在 QML（界面/配置）。

## 2. QML 资源树（`search_strings "qrc:/"` 命中 120+ 条）

```
qrc:///content/main.qml              ← 主窗口
qrc:///content/Splash.qml            ← 启动画面
qrc:///content/SettingsWindow.qml    ← 设置窗
qrc:///content/MyTabView.qml         ← 标签容器
qrc:///content/MyTabItem.qml         ← 单个标签
qrc:///content/globalfunctions.js    ← QML 侧脚本
qrc:/MyModules/content/AxisXCursor.qml      ← X 轴十字光标
qrc:/MyModules/content/WidgetRectangle.qml  ← 控件矩形/拖拽
qrc:/MyModules/content/NewWindow.qml
qrc:/MyModules/content/TabViewMenu.qml
qrc:/MyModules/content/ReturnWindow.qml
```

图标清单（`qrc:/icons/*.svg`）反推出功能面：`link`（连接）、`charttype`、`controls`、`command`、`text`、`settings`、`theme`、`screenshot`、`record`、`encoder`、`hex`、`str`、`rx`、`tx`、`time`、`dtr`、`rts`、`break`、`xaxis`、`ch`、`eye_open/close`、`save`、`clear_buf`、`auto`、`fill`、`mid`、`simplify`…

## 3. 协议（C++ 侧符号）

```
readyReadFireWaterSlot()      readyReadFireWaterPicSlot()
readyReadJustFloatSlot()      readyReadJustFloatPicSlot()
```

`*PicSlot` 是同协议下的「图片数据」分支。字符串表里另有 `使用RawData协议、开启时间戳的情况` → **RawData 是第三种协议**（仅十六进制监视，不绘波形）。

## 4. WaveChart 的真实状态模型（`%LOCALAPPDATA%\vofa+\100\context\vofa+.tabviews.json`）

```jsonc
axis_x_wave   { max_value, min_value, left_index, right_index, unit_text:"ms", decimal }
axis_x_wave2  axis_x_histog{unit:"unit"}  axis_x_freq{unit:"hz"}
axis_y_wave   { top_value, bottom_value, bar_index, decimal }
axis_y_bar    { top_value, bottom_value }
wave_check / bar_check / freq_check / histog_check   // 四种图：波形/柱状/频谱/直方
simplify_check  all_font_on
hide_axis_x_check / hide_axis_y_check / hide_border_check
rbw { histog_gap_num:10, freq_gap_num:257, line_width:2, fake_continuous }
theme { lineColor, lineColor2, lineColor2Follow1/2, bgProperties{...} }
```

全局：`datahub_global { fps:30, global_decimal:7 }`、`defaultAppTheme.lColors` 7 色、`text_buffer { encoder:"UTF-8", list_size:20 }`、ANSI 四色 `textAnsiTime/Rx/Tx/Err`。

## 5. 主题令牌（`%LOCALAPPDATA%\vofa+\100\themes\*\theme.json`）

令牌名原样保留在 `src/lib/theme.ts`：`goodColor / badColor / iconColor1..3 / objColor / mainColor / barColor / lightColor / lineColor / lineColorMain / fontColor / fontColorTips / fontColorBar / cbColor1..4 / textAnsi* / lColors[5] / bgProperties`。

内置四套：`Dark`、`EyeCare`（亮色）、`BlueIronman`、`Helmet`。取值全部照抄，没调色。

## 6. 交互模型（QML 提示原文，已 1:1 实现）

```
左键-单击:波形缩放至中间两格
左键-长按:波形缩放至整个屏幕
右键单击:解除自动缩放
右键长按:波形自动缩放至整个屏幕
左键: 清空采样数据
```

其余原文：「使此通道在波形图中不可见 / 可见」「点击此处可修改通道名称」「名称跟随已绑定通道」「可视采样点:」「多重采样」「Ctrl+Enter 发送」「文本区接收数据颜色」「先断开与下位机的连接才能切换语言」。

## 7. 与本项目（`vofa` Web 版）的映射

| VOFA+ | 本项目 |
| --- | --- |
| FireWater / JustFloat / RawData | `src/lib/protocol.ts`（已有，沿用） |
| Qt SerialPort | `src/lib/serial.ts`（Web Serial） |
| 环形缓冲 + 30fps 数据中枢 | `src/lib/store.ts` + `WaveChart` rAF 限帧 |
| WaveChart 四图 | `WaveChart.tsx`（wave/bar/freq/histog，频谱用朴素 DFT） |
| 主题包 | `src/lib/theme.ts`（四套真值） |
| tabviews 状态 | `ChartConfig` 字段一一对应 |

## 8. 已知差距（别装看不见）

- **不是 Qt 直译**：QML 是编译进 `.rdata` 的，拿不到原始 QML 源码，界面是照资源树+文案+状态模型重建的。
- 频谱为朴素 DFT（N≤512），不是官方 RBW/FFT 实现；`freq_gap_num:257` 只借了档位数概念。
- 图片协议分支（`*PicSlot`）、CSV 录制、插件系统、多窗口拖拽未实现。
- 串口走 Web Serial，仅 Chrome/Edge；Firefox/Safari 只能看演示数据。

## 9. 怎么跑

```bash
cd C:/Users/997997/Desktop/pro/vofa
npm install      # 已装好
npm run dev      # → http://127.0.0.1:5180
npm run build    # 类型检查 + 产物到 dist/
```

启动后是空的，**不自动跑演示数据**——不连硬件就不出图，别拿假信号骗自己。
接真实硬件：左栏「协议」→ 选协议 → 设波特率 → 「请求端口并连接」。
想临时看看效果，点画布中间的「先看演示数据」（或「协议」面板里的「演示数据」），手动开关。

## 10. 已实测通过

- 四种图：波形 / 柱状 / 频谱 / 直方（频谱峰值随扫频移动、直方图对方波呈双峰）
- 交互：滚轮缩放、左键拖动平移、左键单击缩到中间两格、双击自动缩放、十字光标读数
- 主题：四套切换后通道配色按调色板下标同步迁移，浅色主题强调色自动换黑字
- 面板：通道显隐/改名/换色、协议切换、命令面板 HEX/循环、文本区 RX/TX/HEX

## 11. 桌面版（exe）

```bash
npm run dist:win     # 构建 + 打包 + 建桌面快捷方式
```

产物：`release\VOFA+ Web\VOFA+ Web.exe`（免安装，252 MB，Electron 29 / Chromium 122）
桌面快捷方式：`C:/Users/997997/Desktop/VOFA+ Web.lnk`

实现要点：

- `electron/main.cjs` 起窗口；`electron/server.cjs` 在 127.0.0.1 随机端口上托管 `dist/`。
  **不用 file://** —— localhost 才是安全上下文，`navigator.serial` 才可用（实测 `typeof navigator.serial === 'object'`）。
- `select-serial-port` / `setPermissionCheckHandler` 放行 Web Serial。
- 打包不是 electron-builder：直接复制 `node_modules/electron/dist` + `resources/app/`，
  把 `electron.exe` 改名成 `VOFA+ Web.exe`。不联网、不签名、不下载额外东西。
- 图标 `build/vofa.ico` 由 `scripts/make-icon.mjs` 手搓（自写 PNG 编码 + ICO 封装，6 个尺寸）。
- 主程序闪退/白屏 → 双击同目录 `启动(兼容模式).cmd`（`--disable-gpu --no-sandbox`）。

已验证：打包产物启动后 `title = VOFA+ Web · 串口波形调试台`、4 通道出图、无 JS 报错。

## 12. 姿态仿真（PID 调参用）

目标：不接硬件也能看「这套 PID 改下去飞机怎么晃」，用 `D:/esp32/esp32project/CF-Drone-main` 的真实控制链跑闭环。

### 12.1 代码位置

```
src/lib/sim/
  quat.ts         四元数/向量 —— 与 Middlewares/quaternion.h 同约定
  pid.ts          PID 1:1 移植（双重抗饱和、D-on-measurement、D 项低通）
  params.ts       参数集 + CF-Drone 出厂默认值 + 预设
  plant.ts        四旋翼刚体 + 电机一阶滞后
  fc.ts           控制链：interpretControls → controlAttitude → controlRates → controlTorque
  engine.ts       实时步进 + 离线阶跃测试 + 指标分析
  parseProject.ts 从 C 源码抠参数
src/components/
  SimView.tsx     主视图（工具条 / 3D / 曲线 / 指标 / 摇杆）
  AttitudeCanvas.tsx  Canvas 2D 手写透视投影的 3D 姿态
  TraceChart.tsx  姿态/角速率/电机三组曲线
  SimPanel.tsx    参数面板 + 源码导入
```

### 12.2 与固件的对应关系（别改错）

| 固件 | 这里 | 注意 |
| --- | --- | --- |
| `quaternion.h` 的 ZYX 内旋 | `qFromEuler` | 逐项照抄，包括奇异分支 |
| `rotateVector(v,q)` = q⁻¹vq（世界→机体） | `qRotateVector(q, v)` | **参数顺序反了**，TS 里改成 q 在前 |
| `pid.h` 的 `update(error, measurement)` | `Pid.update(error, dt, measurement)` | dt 改成显式传参 |
| `controlTorque` 混控 | `fc.ts` 末尾 | 下标 0=RL 1=RR 2=FR 3=FL |
| `desaturate` | 同名函数 | 等比缩放差分量，保住均值 |

**坑 1**：`Pid` 首帧必须只出 P。固件靠 `prevTime=NAN` 让第一帧不进 I/D 分支；
这里 dt 是外部喂的，不加 `started` 标志的话 `error - NaN` 会把 D 项毒化成 NaN，
再被 `0 * NaN` 放大到整条控制链。

**坑 2**：`runStepTest` 的幅度参数是**度**，而 `SimParams.testAmp` 存的是**弧度**。
漏乘 `RAD` 的话阶跃只有 0.26°，指标看着"完美"其实什么都没测到。

### 12.3 参数从哪来

`parseProject.ts` 认这些写法，正则 + 白名单表达式求值（不 eval 任意代码）：

```
#define PITCHRATE_P 0.06            → 宏表
#define ROLLRATE_P PITCHRATE_P      → 宏别名，递归求值
#define ROLL_I_LIM radians(5.0f)    → radians()/deg2rad()/f 后缀/四则运算
float motThrMin = 0.10f;            → 变量初值
PID rollRatePID(A,B,C,WU,ALPHA);    → 第 4 个是 windup，第 5 个是 D 低通
{"CTL_R_RATE_P", &rollRatePID.p},   → 固件参数名对照（CLI/MAVLink 里那个名字）
```

顺带能抓固件里的坑：`I != 0` 但没传 `windup` → 积分被 clamp 到 ±0，等于 I 完全失效。
（CF-Drone 的 `yawRatePID` 就踩过这个，注释写着 2026-10-22 才修。）

实测对 CF-Drone 的 `control.cpp` + `parameters.cpp`：26 项参数全部命中，0 警告，0 未找到。

### 12.4 默认机体参数（估算值，有实测就改）

118mm 对角轴距微型四轴：质量 50g、Ixx=Iyy=1.4e-5、Izz=2.4e-5 kg·m²、
单电机满推力 0.3N（推重比 2.45）、电机时间常数 30ms、悬停油门 41%。
这些是**估的**，不是称出来的 —— 仿真跟真机的偏差主要来自这里。

### 12.5 实测指标（roll 15° 阶跃）

| 参数 | 上升时间 | 超调 | 调节时间 | 振荡 |
| --- | --- | --- | --- | --- |
| 出厂 | 0.311s | 0.0% | 1.20s | 0 |
| 偏软 | 0.338s | 0.0% | 1.76s | 0 |
| 激进 | 0.154s | 1.2% | 0.83s | 2 |
| 内环 P=0 | 0.140s | 510% | 发散 | — |
| 内环 P=5 | 0.349s | 3.6% | 3.59s | 多次 |
| 陀螺噪声 3°/s | 0.133s | 47.6% | 不收敛 | — |

趋势符合控制理论：内环增益不足 → 相位滞后 → 超调；噪声直接毁掉 D 项。

### 12.6 已知差距

- 只做**姿态**，不模拟位置/高度（ALTHOLD 没搬过来）。改质量只影响悬停油门，不影响角响应 ——
  这是对的（角加速度 = τ/J，与质量解耦），但容易让人误以为参数没生效。
- 电机模型是线性推力 + 一阶滞后，没有桨叶气动非线性、没有电池压降、没有振动。
- 姿态估计用的是真值（除陀螺噪声外），没有搬 `estimate.cpp` 的互补滤波。
- 3D 是 Canvas 2D 手写投影，没有光照/阴影/深度缓冲，纯示意。
- 阶跃测试跑完把 3D 摆到终态，不做过程回放。

### 12.7 怎么用

`npm run dev` → 左栏「姿态」→「开始」→ 拖右摇杆看姿态；调右侧滑块实时生效；
点「阶跃测试」出指标 + 诊断建议；面板底部拖 `control.cpp`/`parameters.cpp` 进去自动灌参数。

## 13. IMU 静止数据标定（真机对齐）

目的：仿真默认零偏是 0，那是理想传感器。用实采的静止数据标出**这台机器**的零偏/噪声喂进去，
「静止不动也会慢慢歪」才会真的发生。

### 13.1 数据从哪来

`Drivers/imu.cpp:99` 的调试输出，17 通道，50Hz（解锁后降到 10Hz）：

```
acc.x, acc.y, acc.z        %.4f   m/s²
gyro.x, gyro.y, gyro.z     %.3f   °/s
roll, pitch, yaw           %.4f   rad
velZ, thrust, hoverEst, armed, motor RL/RR/FR/FL
```

**关键**：`imuPlot(acc, gyro)` 传的是 `correctedGyro = rawGyro - gyroBias - gyroBiasTrim`，
也就是**飞控认为自己静止时的真实读数**，不是芯片原始值。所以这里读出来的数如果很大，
说明去偏没成功，不是传感器原始噪声大。

### 13.2 实采数据实测（辉哥 2026-10-23 给的一帧）

```
0.0573,-0.0184,9.8097,18.526,-11.906,17.453,0.0986,-0.0833,-0.8258,...
```

| 项 | 值 | 含义 |
| --- | --- | --- |
| acc | (0.057, -0.018, 9.810) | \|acc\|=9.8099，偏离 1g 仅 0.03% → **飞机确实放平了** |
| 反算倾角 | roll 0.11° / pitch 0.33° | 真实姿态几乎是水平的 |
| 飞控算的倾角 | roll 5.65° / pitch -4.77° | **差出来的 5~7° 全是零偏积分出来的** |
| gyro 残差 | 18.53 / -11.91 / 17.45 °/s | 模长 **28.1 °/s** |

### 13.3 这组数暴露的固件问题

`imu.cpp` 的在线零偏微调有三重门控：

```
GYRO_TRIM_RATE_TH    = 0.09 rad/s ≈ 5.2 °/s   // rawGyro 模长低于此值才算"静止"
GYRO_TRIM_LIMIT      = 0.08 rad/s ≈ 4.6 °/s   // 微调量硬限幅
GYRO_TRIM_STATIC_SAMPLES = 1000               // 需连续 1s
```

**死锁**：零偏 28.1 °/s 远大于 5.2 °/s 的静止门控 → `gyroStaticCount` 永远归零 →
`gyroBiasTrim` 一次都不会更新 → 零偏只能靠上电那 1 秒的 `calibrateGyroOnce()`。
而且就算门控放行，4.6 °/s 的限幅也补不了 28 °/s。

推论：这台上电标定**没成功**（标定时被碰了 / 上电前就在动 / 标定后温漂）。
表现就是 `estimate.cpp` 注释里写的「起飞后机体持续倾斜、朝固定方向侧漂」。

### 13.4 仿真复现精度

把标定值灌进 `SimParams`，静止 10 秒（电机不转，`landed` → acc 权重 0.003）：

| | roll | pitch |
| --- | --- | --- |
| 仿真估计值 | **5.56°** | **-4.85°** |
| 真机那一帧 | **5.65°** | **-4.77°** |

误差 < 0.1°。这条链路（传感器模型 → estimate.cpp → control.cpp → 刚体）是对的。

### 13.5 新加的东西

- `src/lib/sim/estimate.ts` —— `estimate.cpp` 1:1 移植（applyGyro / applyAcc / applyLevel / estimateVelZ）
- `src/lib/sim/imuData.ts` —— 解析 + 标定 + 诊断（阈值直接引用固件常量）
- `src/components/ImuCalibPanel.tsx` —— 拖文件/粘贴 → 标定 → 一键应用
- `SimParams` 新增 16 项：`gyroBiasX/Y/Z`、`gyroNoise`、`accBiasX/Y/Z`、`accScaleX/Y/Z`、
  `accNoise`、`estAccWeight`、`estAccWeightInFlight`、`estRatesLpfAlpha`、`levelWeight`、`levelBiasGain`
- 曲线新增「估计」页：真值 vs 飞控估计，两条线分开就是估计漂了

### 13.6 两个坑

1. **电机不转时加速度计读数不是 0**。本仿真不积分位置，电机停 = 停在地上，支撑力抵消重力，
   `readSensors` 必须按 `(0,0,g)` 出数。少了这条，固件的 `landed` 判据（|acc|≈1g）永远不成立，
   地面静止场景会用飞行权重修姿态，漂得比真机夸张十倍。
2. **数据里第一列可能被吃掉小数点**。辉哥贴的 `0573` 实际是 `0.0573`，按 573 算会让 |acc|=573。
   标定器现在会在模长偏离 1g 超 30% 时直接拒绝 acc 标定并报警。

### 13.7 还需要什么

- 一段**连续 5~10 秒**的静止数据（50Hz 下 250~500 行）。一帧只能算均值，噪声/漂移率算不出来。
- 采的时候：飞机放平、上电后等 3 秒再开始、别碰桌子、别开电机。
