# XCOM V2.8 逆向取证记录（REA）

> 目标：`D:\stm32\STM32project\【正点原子】战舰STM32F103开发板V4 资料盘(A盘)\6，软件资料\6，软件资料\1，软件\4，串口调试助手\4，串口调试助手\XCOM（正点原子推荐）\XCOM V2.8.exe`
> 工具：REA 6.4.0（managed 检查器）+ Python 手写 PE/CLI 解析（本机无 dotnet / ILSpy / monodis）
> 目的：把 XCOM 的功能搬进 `vofa`，不靠"我觉得串口助手应该长这样"。

## 1. 样本身份

| 项 | 值 |
| --- | --- |
| 格式 | PE32 / x86 / **IL-only（managed）** |
| SHA-256 | `3ea6ee586fb028cc492467768311e17b9c723a83613493d5c5976529cc197b6b` |
| 大小 | 1,001,984 B |
| 程序集 | **MySSCOM 2.8.0.0**，.NET Framework 4.0 Client Profile |
| 元数据 | v4.0.30319，71 TypeDef / 2357 MethodDef / 594 Field / 188 Property |
| 节 | 4 个；resources 751,903 B（占全文件 75%） |

**第一判断被推翻过**：REA 的 `open_binary` 先把它判成 native PE，Ghida 直接拒收
（`managed_target_unsupported`）。改用 `inspect_managed_artifact` 才确认是 .NET —— 所以这条路
从一开始就不是"反汇编 x86"，而是"读 CLR 元数据"。

## 2. 加壳判定（这是关键，决定了能挖到什么）

`#US`（user string）堆只有 **1104 字节 / 20 条**，而一个中文 WinForms 程序不可能只有 20 条字面量。
那 20 条里全是壳自己的东西：

```
System.Security.Cryptography.AesCryptoServiceProvider
GetDelegateForFunctionPointer        m_ptr / m_pData
System.Reflection.RuntimeModule      clrjit.dll
{11111-22222-50001-00000}  ×5        ← .NET Reactor 的标记
N4cHeiVcw70MQDKicp.xvJS1h4tQIK2V91NVp  ← 271KB 加密资源
```

配合这些异常：

- metadata stream 被改名为 `#Blop` / `#GUlD`（正常是 `#Blob` / `#GUID`）
- `Module` 表 2 行、`Assembly` 表 2 行（规范要求各 1 行）
- 3 个混淆名私有资源（271,175 / 27,218 / 352 B），文件头不是任何已知格式

**结论：.NET Reactor（NecroBit）。** 真程序集被 AES 加密塞在 271KB 资源里，运行时解密后反射加载。

**方法体实测**（`CheckTransportProtocol.crc16Checksum` 等）：

```
fat header: 13 30 04 00 04 00 00 00 00 00 00 00 | IL: 00 00 00 2a
                                                   nop nop nop ret
calculateChecksum: 00 16 2a  →  nop ldc.i4.0 ret（返回 0 的桩）
```

**所有方法体被抽空成桩，静态拿不到算法实现。** 但**元数据没被加密** —— 类型名、字段名、
方法名、属性名全是明文。这就是本次逆向的全部收获来源。

## 3. 元数据类型全景（明文）

71 个类型里，业务相关的：

| 类型 | 字段 | 方法 | 作用 |
| --- | --- | --- | --- |
| `MySSCOM.MainFrame` | **353** | 846 | 主窗口，字段=控件 |
| `MySSCOM.MultiSendInfoFrame` | 12 | 139 | 多条发送编辑器（DataGridView + Excel/CSV） |
| `MySSCOM.ManageTransportProtocol` | 22 | 80 | 协议传输状态机 |
| `MySSCOM.TransportProtocol` | 10 | 26 | 单帧模型 |
| `MySSCOM.CheckTransportProtocol` | 5 | 19 | 四种校验 |
| `MySSCOM.SerialPortManager` | 3 | 28 | WMI 枚举串口 |
| `MySSCOM.SetBaudrate` | 6 | 57 | 自定义波特率窗 |
| `MySSCOM.Utils` | 0 | 48 | HEX/字符串/时间/编码工具 |
| `MySSCOM.UtilExcle` | 0 | 30 | Excel 导入（OleDb） |
| `MySSCOM.INIFileHelper` / `UtilIni` | 2 / 0 | 27 / 33 | INI 配置 |
| `MySSCOM.ADinfo` / `TestForm.*AD*` | 6~8 | 18~67 | 广告位（不移植） |

`CheckTransportProtocol` 的方法名直接把校验算法列出来了：

```
xorChecksum   sumChecksum   crc8Checksum   crc16Checksum   calculateChecksum
```

`TransportProtocol` 的属性就是帧结构：

```
DeviceAddr  FunctionType  SbData  Sequence  DataLength
TransportProtocolLength  Checksum  Result  ChecksumMethod  IsValid
```

`ManageTransportProtocol` 暴露了重发机制：

```
SendSequence / RecieveSequence / RetryCount / IsCompleteRetry / IsAbortSend
SendTaskResult / CurrentSendTaskType / IsHasSendTask / IsEnableTransportProtocol
IsAutoNewLine / IsDispOriginalData / OriginalFrameSequence
```

## 4. 主窗体控件清单（353 字段，按类型统计）

```
50 Label      50 ToolStripMenuItem   31 Button    26 CheckBox
24 TextBox     6 ComboBox            5 Panel      4 TabPage
3 ContextMenuStrip  2 GroupBox  2 ProgressBar  5 ToolStripStatusLabel
1 SerialPort   6 System.Timers.Timer  5 Forms.Timer  3 BackgroundWorker
```

控件名本身就是功能说明书（节选，全部 228 个控件见 `scripts/xcom-reverse/mf_controls.txt`）：

**连接区**：`cbxComPort` `cbxBaudRate` `cbxDataBits` `cbxStopBits` `cbxParity`
`btnOpenCom` `ckbDTR` `ckbRTS` + 状态栏 `toolStripStatusLblCom/RevCnt/SendCnt/Time`

**四个 Tab**：`tabControl1` → `multiTab` / `singleTab` / `optionTab` / `transportProtocolTab`

**单条发送**：`tbxSendData` `btnSend` `btnClearSend` `ckbHexSend` `ckbSendNewLine`
`ckbTimeSend` `tbxSendPeriod` `btnOpenSendFile` `btnSendFile` `btnStopSendFile`
`progBarSendFile` `lblProgSendFile`

**多条发送**：`tbxMultiSend1..10` + `btnMultiSend1..10` + `ckbMultiSend1..10`
`ckbMultiHexSend` `ckbMultiSendNewLine` `ckbMultiAutoSend` `tbxMutilSendPeriod`
`ckbRelateKeyBoard` `btnMultiFirstPage/LastPage/NextPage/EndPage` `txb_JumpPage`
`btn_AddPage` `btn_RemovePage` `btnRemarkMultiSend`

**选项页**：`ckbRevHex` `ckbShowTime` `txb_ShowTime` `rtb_ReceData` `cb_AuotSave`
编码菜单 `asciToolStripMenuItem` / `uNICODEToolStripMenuItem` / `uTF32ToolStripMenuItem` /
`bigEndianUnicodeToolStripMenuItem` / `gBKGB2312ToolStripMenuItem`
语言菜单 `中文/英文/中文繁体`，缓冲上限 `kToolStripMenuItem`..`mToolStripMenuItem3`

**协议传输**：`cbxTransportProtocolChecksum` `tbxTransportProtocolSendFunctionType`
`tbxTransportProtocolSlaveDeviceAddr` `tbxTransportProtocolMaxDataLength`
`tbxTransportProtocolRetryCount` `tbxTransportProtocolSendPeriod`
`ckbTransportProtocolAutoSend` `ckbTransportProtocolDispOrigialData`
`ckbTransportProtocolAutoNewLine` `btnEnbaleTransportProtocol`
状态标签 `lblTransportProtocolRevSequence/SendSequence/RevChecksum/RevFunctionType/RevDataLength/SendDataLength/Result`

## 5. 内置说明原文（比反编译更直白）

`MainFrame.resources` 里躺着整份帮助文档，共 137 条中文，关键三段：

> **协议传输**：此协议是从 modbus(rtu) 演变而来，可以称之为 modbus 的变种。协议属于半双工传输的
> Send-Ack 模式，协议自带灵活可配置的自动重发机制，可配置重发次数，重发间隔（即帧周期），
> 多种校验方式，支持校验和，异或，CRC8，CRC16 校验，CRC8 和 CRC16 均为查表的方式，效率高。
> 支持单次发送，自动发送（自定义周期），文件发送（如，IAP 串口升级）三种模式。

> **多条发送**：增加了多条发送的数目，多达40条…可以任意编辑，导入导出您要发送的条目，
> 文件的格式是 excel…多行发送关联键盘，改为发送当前选中页的编号（xx0-xx9）…
> 将多行发送指令的保存文件改为 .CSV

> **串口**：默认可选波特率为 1200bps-1382400bps…可以选择 2/1.5/1 三种停止位，
> 4 种数据长度，可选奇、偶校验，或无校验…支持串口随时插拔

> **显示**：16进制显示…显示模式默认为黑色背景绿色字体…时间戳是以换行回车断帧…
> 缓存大小选择（200K，500K，1M，2M，3M，5M），界面最多显示的数据上限有限制超过范围直接删除到 10k 数据

## 6. 移植映射

| XCOM | 本项目 |
| --- | --- |
| `cbxBaudRate/DataBits/StopBits/Parity` | `ConnectPanel` 串口参数网格 + 自定义波特率 |
| `ckbDTR/ckbRTS` | `SerialLink.setSignals()`（Web Serial `setSignals`） |
| `ckbHexSend/ckbSendNewLine/ckbTimeSend` | `SingleSendPanel` |
| `btnSendFile/Stop/进度条` | `SerialLink.sendChunked()` + `fileProgress` |
| `tbxMultiSend1..10` + 翻页 + CSV | `MultiSendPanel` |
| `ckbRelateKeyBoard` | `window.keydown` 监听 0-9 |
| `cbxTransportProtocolChecksum` | `lib/xcom.ts` → `checksum()` 四算法 |
| `TransportProtocol` 字段 | `buildFrame()` / `parseFrame()` |
| `RetryCount/帧周期` | `lib/protoLink.ts` → `ProtoEngine.send()` |
| `ckbRevHex/ckbShowTime/编码/缓冲上限` | `TextPanel` 工具条 |
| `ckbDispOrigialData` | 协议日志里同时打原始帧 |

新增文件：

```
src/lib/xcom.ts            校验(查表 CRC8/CRC16) + 帧编解码 + HEX 自动拆分 + 编码表
src/lib/protoLink.ts       Send-Ack 重发状态机
src/components/SingleSendPanel.tsx
src/components/MultiSendPanel.tsx
src/components/ProtoSendPanel.tsx
src/components/XcomPanel.tsx
```

改动：`lib/serial.ts`（参数/DTR/RTS/分块发送）、`components/ConnectPanel.tsx`、
`components/TextPanel.tsx`（字节级断帧+编码+对比+保存）、`App.tsx`、`styles.css`、`Rail.tsx`。

**原 `CommandPanel`（命令页）已删除** —— 它的"存几条命令、点一下发送、循环发"被
「多条发送」完全覆盖（还多了分页、勾选循环、数字键盘、CSV）。留着就是两个入口干同一件事。

## 7. 已知差距（别装看不见）

- **校验多项式是标准值，不是从二进制里抠出来的。** 方法体被 NecroBit 清空，`crc8Checksum` /
  `crc16Checksum` 的实际实现不可见。这里用 CRC8/poly 0x07/init 0x00 与 CRC16/poly 0xA001/
  init 0xFFFF（modbus 惯例，低字节在前）。**若对端是自家固件，务必以固件为准核对。**
- **帧格式是推断的。** `[地址][功能码][序号][长度][数据][校验]` 来自字段名顺序 +
  "modbus 变种" 的原文，没有逐字节动态验证（没跑原程序抓串口）。
- **界面布局不是 1:1。** `InitializeComponent` 的 IL 同样被加密，控件坐标拿不到；
  面板是按 228 个控件名重建的。
- **没移植**：广告位（`TestForm.AD.*`）、软件库、更新提示、中/英/繁体多语言、
  Excel(.xls) 导入（只做了 CSV，XCOM 2.8 自己也改 CSV 了）、WMI 串口描述枚举
  （Web Serial 只给 VID/PID）。
- **浏览器限制**：Web Serial 只稳定支持 8 数据位 + 无校验，其它组合会降级并提示；
  `GBK/GB2312` 只能解码不能编码（浏览器无 GBK encoder）；CTS/DSR/DCD 状态拿不到。

## 8. 怎么跑

```bash
cd C:/Users/997997/Desktop/pro/vofa
npm run dev        # → http://127.0.0.1:5180
npm run build      # tsc --noEmit + vite build
npm run dist:win   # 打包 exe
```

左栏「发送」进入发送台；「协议与连接」里选完整串口参数。

## 9. 已实测

用项目自带 Electron（Chromium）无头跑通，`console errors = none`：

- 校验自检（modbus 标准向量 `01 03 00 00 00 0A`）：CRC16 → `C5 CD` ✓、CRC8 → `B9`、
  SUM → `0E`、XOR → `08`
- HEX 自动拆分：`01030000000A` → `01 03 00 00 00 0A`；奇数 `ABC` → `AB 0C`（倒数第二位补 0）
- 帧编解码往返：`seq=7 / len=2 / checksumOk=true`
- 三个 Tab 全渲染；多条 10 行 + 翻页 + CSV；协议参数 8 项 + 4 种校验；
  文本区 7 按钮 + 6 编码 + 6 档缓冲；串口参数 4 项
- 未连接时发送给出 `串口未连接，命令没有发出去`，不伪造 TX

## 10. 取证脚本

`scripts/xcom-reverse/`（纯 Python，无需 dotnet）：

```bash
python dump_metadata.py <exe> ./meta     # 定位 #US / #Strings / #Blob，导出字面量与名字堆
python parse_tables.py  <exe> meta/_streams.json   # 解析 #~ 表 → TypeDef/MethodDef/Field/Property
python dump_fields.py   <exe>            # 字段真实类型（控件类型靠这个）
python dump_resources.py <exe> ./res res_table.json  # 抽嵌入资源（注意 offset 前有 4 字节长度前缀）
python scan_res_text.py res/*.resources  # 资源里的 UTF-8 文本（内置帮助文档就在这）
```

踩过的坑都写在脚本注释里：资源 offset 要 +4 跳过长度前缀；`.resources` 里的字符串是
**UTF-8 不是 UTF-16**（BinaryWriter 行为）；`#US` 的 7-bit 长度含末尾 flag 字节。
