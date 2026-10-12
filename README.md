# 衣橱 · 轻选衣（Wardrobe）

一款**零成本**的衣服展示类移动应用：启动动画结束后直接进入主界面，左右滑动切换衣服分类，点击即可浏览该分类下全部服装。暗紫 + 暗黑主题，无登录、无注册、无引导、无 AI 换衣。

## 零成本承诺

| 项目 | 方案 | 费用 |
|------|------|------|
| 技术栈 | 原生 HTML + CSS + JavaScript（无任何框架） | 免费开源 |
| 数据库 | 浏览器 IndexedDB（数据存本机，不上传） | 免费 |
| 离线/安装 | Service Worker + Web App Manifest（PWA，可"添加到主屏幕"） | 免费 |
| 外部请求 | **0 个**：无 CDN、无外部字体、无第三方 API、无统计 SDK | 免费 |
| 构建部署 | 无构建步骤，静态文件直接托管；GitHub Pages / Cloudflare Pages 免费额度足够 | 免费 |
| 运行环境 | 任意现代浏览器（Android Chrome 最佳） | 免费 |

**从开发到运行的总成本：0 元。**

## 快速开始

PWA 需要通过 http(s) 访问才能注册 Service Worker（数据库同理），所以需要任意一个本地静态服务器，任选其一：

```bash
# 方式 1：Python（系统自带）
cd 衣橱App
python -m http.server 8080

# 方式 2：Node.js
npx serve 衣橱App

# 方式 3：VS Code 安装 "Live Server" 扩展，右键 index.html → Open with Live Server
```

浏览器打开 `http://localhost:8080` 即可使用。手机与电脑同一 Wi-Fi 时，手机访问 `http://<电脑IP>:8080` 真机体验。

**安装为手机 App**：Android Chrome 打开后 → 菜单 →「添加到主屏幕」，即可以独立窗口全屏运行，离线可用。

## 使用流程

1. 启动动画（约 2.4 秒）→ **直接进入主界面**（无登录/注册/引导）
2. 主界面：**左右滑动切换分类**，或点击顶部分类条跳转；每页直接展示该分类全部服装
3. 点击服装卡片 → 详情页（大图 / 颜色 / 尺码 / 标签 / 说明）
4. 首次进入是空库 → 点「导入数据」，可直接多选衣服图片，或下载空模板填 JSON
   （catalog.json 已有预置样片时，首次进入会自动载入，无需手动导入）

## 拍照风格库（顾客端沉浸浏览）

扫码进入主界面后，**左滑 / 右滑屏幕边缘**（或点右上角风格库按钮）即可打开拍照风格库：

| 操作 | 效果 |
|------|------|
| 屏幕左缘右滑 / 右缘左滑 / 点顶栏按钮 | 打开风格库（iOS 式缩放淡入动画） |
| 风格墙左右滑 | 浏览各个拍照风格（封面大卡 + 件数 + 简介） |
| 点风格卡 | 进入该风格全屏浏览 |
| 浏览层左右滑 | 逐套服装切换（跟手位移、阈值翻页、边缘阻尼） |
| 单击图片 | 进 / 出沉浸模式（隐藏顶栏、底栏与圆点） |
| 下滑 | 返回上一层（浏览层 → 风格墙 → 关闭回主界面） |
| Android 返回键 | 逐层退出（与下滑等价，历史栈管理） |
| 「查看详情」 | 打开该套服装详情页，返回后回到浏览层原位置 |

- 风格 = 数据里的**分类**：店主新增分类后，风格墙自动出现新风格（架构支持 N 个，当前预置 1 个「暖调光影样片」）
- 风格数不足时墙尾固定显示"筹备中"卡，提示可扩展
- 全部手势基于 Pointer Events，触摸 / 鼠标同一套代码；`prefers-reduced-motion` 时关闭动画

## 客人扫码进入（零安装）

**客人不需要下载任何 App**：店里张贴二维码 → 客人微信「扫一扫」或相机扫一下 → 浏览器打开就是选衣界面（启动动画 2.4 秒 → 直接浏览）。

### 当前模式：店内局域网（数据不公开）

```
电脑运行：python -m http.server 8091 --bind 0.0.0.0
二维码内容：http://<电脑局域网IP>:8091/index.html   （当前：http://192.168.1.6:8091/index.html）
客人手机需连接店内同一 Wi-Fi
```

- 已生成 `店铺二维码.png`，直接打印张贴（收银台 / 试衣间 / 镜台）
- **IP 会变的两种情况**：电脑重连 Wi-Fi、路由器重新分配地址——IP 变了需重查并重新生成二维码：
  ```bash
  # 1. 查当前局域网 IP（Windows）
  python -c "import socket;s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.connect(('8.8.8.8',80));print(s.getsockname()[0])"
  # 2. 用新 IP 重新生成二维码（需 pip install qrcode）
  python -c "import qrcode;qrcode.make('http://<新IP>:8091/index.html').save('店铺二维码.png')"
  ```
- 此模式下浏览器不允许注册 Service Worker（非 https），所以**离线缓存不可用**，但浏览、catalog 加载都正常；电脑关机则客人打不开

### 双入口设计（顾客端 / 店主端分离）

二维码只携带**纯顾客端 URL**（无参数、无 hash），扫码必进顾客主界面；店主端是独立入口，顾客端不可见也不可达：

| 入口 | URL | 行为 |
|------|-----|------|
| **顾客端**（二维码内容） | `http://<IP>:8091/index.html` | 启动动画 → 主界面；**无数据管理图标**；空库时显示"新衣上新中"，不暴露任何店主操作 |
| **店主端**（独立入口） | `http://<IP>:8091/index.html#/admin` | 跳过启动动画，直达数据管理；页内有「店主模式」标识；顶栏返回可预览顾客视角 |

- 店主把 `#/admin` 链接存为浏览器书签即可（电脑/自己手机各存一份），无需安装任何 App
- 公网托管后格式相同：`https://<域名>/index.html#/admin`
- `店铺二维码.png` 指向顾客端 URL，**无需因本次改动重新生成**

### 在线衣服库 catalog.json（扫码方案的核心）

客人手机扫码打开时**本地库是空的**，App 启动时会自动拉取 `catalog.json` 并导入——客人看到的就是店里统一的衣服，无需任何操作。**catalog.json 已预置 7 张影楼样片**（分类「暖调光影样片」），当前扫码即可看到完整内容，不是空态。

**版本同步机制**（保证老客人也能收到更新）：catalog.json 顶层 `version` 由店主「导出当前数据」时写为时间戳，天然单调递增。客人每次打开 App 都会拉取 catalog.json 并比较版本：

| 场景 | 行为 |
|------|------|
| 本机为空 | 直接导入（客人扫码即有内容） |
| catalog version 比本机已应用版本新 | 合并导入：同 ID 覆盖、新 ID 追加、**本机独有数据保留** |
| version 未变 / 断网 | 不动本机数据，秒开 |

**店主维护 catalog 只需一步**：
1. 在自己的浏览器里导入数据（图片 / JSON 均可）
2. 数据管理页 →「导出当前数据（备份）」→ 得到 `wardrobe-backup-*.json`（version 已是新时间戳）
3. 用它的内容**整体替换** `衣橱App/catalog.json` 保存，`git push` 上线

之后新客人扫码即见最新衣服；已打开过的手机按合并导入刷新（不会覆盖客人本机数据）。

### 升级模式：公网托管（客人离开 Wi-Fi 也能扫）

把本目录部署到 GitHub Pages / Cloudflare Pages（免费），二维码内容换成 `https://<用户名>.github.io/<仓库名>/index.html`：
- Service Worker 正常注册 → 首次打开后**完全离线可用**
- 任何网络都能扫开，不限于店内 Wi-Fi
- 注意：catalog.json 随之公开，衣服库对外可见

## 数据导入（模板化空库，自行填充）

应用内置空数据库结构，提供**两种导入通道**，按你的数据形态自选：

### 通道一：图片批量导入（推荐给只有照片的场景）

手里有一个文件夹的 PNG / JPG 服装图，不想手写 JSON？直接用这个：

- **入口**：主界面右上角数据库图标 → 数据管理 →「选择图片批量导入」
- **用法**：选择目标分类（或「＋ 新建分类」）→ 一次多选图片 → 自动处理
- **自动完成**：读取图片 → 等比压缩（长边 ≤1400px，WebP）→ 转 base64 **存入本机 IndexedDB（完全离线，不依赖外链）**→ 以**文件名**作为服装名生成条目
- **后续补信息**：尺码、颜色、说明等字段仍走 JSON 合并导入（同分类按 ID 覆盖追加，图片条目不受影响）
- **注意**：HEIC 等浏览器不支持的格式会被逐张报错跳过；处理期间按钮禁用，防止重复导入

### 通道二：JSON 导入（适合带完整信息的批量数据）

- **入口**：主界面右上角数据库图标 → 数据管理
- **导入方式**：选择 JSON 文件 / 粘贴 JSON
- **两种模式**：合并导入（同 ID 覆盖，其余保留）/ 替换全部（先清空再写入）——两种通道均遵循
- **校验**：缺字段、分类不存在、ID 重复等会逐条列出错误，不会写坏数据
- **模板**：点「下载空模板 JSON」即可得到空结构文件（同 `db-template.json`）

### 数据格式

```json
{
  "version": 1,
  "categories": [
    { "id": "cat-dress", "name": "连衣裙", "sort": 1, "desc": "春夏新款" }
  ],
  "items": [
    {
      "id": "item-001",
      "categoryId": "cat-dress",
      "name": "浅紫碎花连衣裙",
      "image": "https://example.com/1.jpg",
      "sizes": ["S", "M", "L"],
      "colors": ["#8B5CF6"],
      "tags": ["新品", "显瘦"],
      "desc": "雪纺面料，透气亲肤",
      "sort": 1
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `version` | 否 | 数据版本号（建议时间戳）。catalog.json 用；客人端只认更大的版本，小版本不重复同步 |
| `categories[].id` | 是 | 分类唯一 ID |
| `categories[].name` | 是 | 分类名称 |
| `categories[].sort` | 否 | 排序权重，小的在前 |
| `categories[].desc` | 否 | 分类副标题 |
| `items[].id` | 是 | 服装唯一 ID（合并导入按它覆盖） |
| `items[].categoryId` | 是 | 所属分类 ID，必须已存在 |
| `items[].name` | 是 | 服装名称 |
| `items[].image` | 否 | 图片 URL 或 base64；留空自动生成紫色占位图 |
| `items[].sizes` | 否 | 尺码数组 |
| `items[].colors` | 否 | 颜色数组，`#RRGGBB` 会显示为色点 |
| `items[].tags` | 否 | 标签数组 |
| `items[].desc` | 否 | 说明文本 |
| `items[].sort` | 否 | 分类内排序权重 |

**图片建议**：3:4 竖图、单张 300KB 以内。可用外链 URL（需联网加载），或转为 base64 写进 JSON 实现完全离线（数据全部存本机 IndexedDB，换设备用「导出当前数据」备份后再导入）。

## 部署到 GitHub Pages（HTTPS + 全离线）

完整步骤（含 PAT 安全发布、Actions 自动部署、真机离线验证）见 **《HTTPS+离线部署指南.md》**，摘要：

- 首次发布：创建仓库 → PAT 推送（密码方式 GitHub 已禁用，PAT 不写任何文件）→ Settings → Pages → Source 选 **GitHub Actions** → 自动部署到 `https://<用户名>.github.io/<仓库名>/`
- **强制 HTTPS**：默认域名由 GitHub 强制启用且不可关闭；自定义域名需 DNS 生效后勾选 Enforce HTTPS
- **全离线**：Service Worker 预缓存全部静态资源；`catalog.json` 网络优先（在线拿最新、离线用缓存）；无缓存时断网打开显示 `offline.html` 提示页
- **长期二维码**：`python scripts/make-https-qr.py <用户名> <仓库名>` 生成，任何网络可扫
- 以后更新：`git push` 即自动上线（约 1 分钟）

> Cloudflare Pages 亦可作为备选静态托管；本地 `python -m http.server` 适合开发调试。

## 打包为 APK（可选，仍零成本）

若需要原生安装包，可用 Google 开源的 [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)（免费）将本 PWA 打包为 APK/AAB，自行签名后分发，无需支付任何费用。

## 目录结构

```
衣橱App/
├── index.html            应用外壳（启动动画/主界面/详情/数据管理/拍照风格库）
├── styles.css            暗紫暗黑主题样式
├── app.js                应用逻辑（IndexedDB、渲染、导入校验、catalog 版本同步、风格库手势、双入口路由）
├── sw.js                 Service Worker（v7：预缓存 + catalog 网络优先 + 离线提示页）
├── manifest.webmanifest  PWA 清单（可安装、独立窗口、PNG 图标）
├── icon.svg              应用图标（矢量）
├── icon-192.png          PWA 安装图标 192×192（兼作 iOS apple-touch-icon）
├── icon-512.png          PWA 安装图标 512×512（maskable）
├── db-template.json      空数据库模板（直接可用）
├── catalog.json          店里统一的在线图库（扫码方案核心，店主维护；已预置 7 张样片）
├── offline.html          离线提示页（首次打开且无缓存时显示）
├── preview.html          图片快速预览页（开发用：单图全屏左右滑动查看 images/ 全部图片，上线前删除）
├── images/               预览图片目录（影楼样片 8 个文件；缩略图_001 与主图_002 内容重复，catalog 只收 7 张）
├── .nojekyll             跳过 Jekyll，静态原样伺服
├── .github/workflows/    GitHub Actions 自动发布（push 即部署）
├── scripts/              make_icons.py / make-https-qr.py / make_catalog.py（catalog 种子生成）/ _check-preview.py（预览页校验）
├── HTTPS+离线部署指南.md 部署/发布/验证完整文档
└── README.md             本说明
```

## 常见问题

- **双击 index.html 打不开数据？** file:// 协议下浏览器禁用 IndexedDB，必须用 http 服务器打开（见「快速开始」）。
- **图片不显示？** 外链图片需联网；加载失败会自动回退为紫色占位图，不影响浏览。
- **数据会丢吗？** 数据存于浏览器 IndexedDB，清除浏览器数据会一并清掉，重要数据请定期用「导出当前数据」备份。
- **想换主题色？** 修改 `styles.css` 顶部 `:root` 中的 `--primary` 系列变量即可。
