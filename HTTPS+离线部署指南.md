# HTTPS + 全离线部署指南（GitHub Pages）

> 目标：强制 HTTPS 访问；全离线可用（断网/离店扫码仍能打开已缓存内容，未缓存时显示离线提示页）；生成指向正式 HTTPS 地址的长期可用二维码。
> 账号安全：**全过程不写入任何密码/Token 到代码或配置文件**——GitHub 已不支持密码推送，统一使用 Personal Access Token（PAT，仅存在你本机）或 SSH Key。

---

## 一、现状核查结论

- 本地目录此前**未初始化 git、未部署过任何 GitHub Pages 站点**——本次为首次发布，非升级。
- 本地已完成 PWA 离线改造（见第三节文件清单），推送到 GitHub 并开启 Pages 后即达成全部目标。

## 二、需要你补充/确认的信息

| # | 信息 | 是否必须 | 默认值/说明 |
|---|------|---------|------------|
| 1 | **GitHub 用户名** | ✅ 必须 | 决定网址 `https://<用户名>.github.io/<仓库名>/`，也决定二维码内容 |
| 2 | 仓库名 | 建议确认 | 默认 `shili-wardrobe`（公开仓库，Private 仓库的 Pages 需 Pro） |
| 3 | 自定义域名 | 可选 | 如 `yi.pifu.photo`；不用则用 github.io 默认域名，**已强制 HTTPS** |
| 4 | 构建方式 | 已定 | **纯静态**（无 Jekyll），`.nojekyll` 已放置，Actions 原样上传 |
| 5 | 站点资源清单 | 已定 | index.html / styles.css / app.js / sw.js / manifest.webmanifest / icon.svg / icon-192.png / icon-512.png / db-template.json / catalog.json / offline.html |

## 三、本次改动/新增的文件清单

| 文件 | 作用 | 状态 |
|------|------|------|
| `sw.js` | **重写 v5**：预缓存全部静态资源；`catalog.json` 改**网络优先**（修复旧版缓存优先导致“店主更新衣服客人看不到”的 bug）；导航请求断网回退 `offline.html` | 改 |
| `offline.html` | 离线提示页：首次打开且无缓存时显示，提供重试按钮 | 新 |
| `manifest.webmanifest` | 补 `id` 稳定标识 + **PNG 图标 192/512**（Android 安装 PWA 的硬性要求） | 改 |
| `icon-192.png` / `icon-512.png` | PWA 安装图标，与 icon.svg 同视觉（由 `scripts/make_icons.py` 生成） | 新 |
| `.nojekyll` | 跳过 Jekyll，静态文件原样伺服 | 新 |
| `.github/workflows/deploy.yml` | GitHub Actions 自动发布：push 到 main 即部署 | 新 |
| `.gitignore` | 排除二维码 PNG（本地打印物，内容随地址变化） | 新 |
| `scripts/make_icons.py` | PNG 图标生成脚本（可复用） | 新 |
| `scripts/make-https-qr.py` | HTTPS 长期二维码生成脚本 | 新 |
| `README.md` | 部署章节改写，指向本指南 | 改 |
| `app.js` / `index.html` / `styles.css` | 无改动（双入口逻辑沿用） | 不变 |

## 四、HTTPS 强制访问

- **默认域名（`<用户名>.github.io`）**：GitHub Pages 自动签发证书并**强制 HTTPS，且该开关不可关闭**——无需任何操作即达成。
- **自定义域名（可选）**：仓库 Settings → Pages → Custom domain 填入 → 等 DNS 生效（几分钟到几小时）→ 勾选 "Enforce HTTPS"（DNS 配好前该勾选项为灰）。
- 站内**零外部请求**（无 CDN/字体/统计），不存在 mixed content，HTTPS 下无安全警告。

## 五、发布步骤（约 10 分钟，全部由你本人执行）

### 1. 创建 PAT（不要密码，密码方式 GitHub 已禁用）

浏览器打开 <https://github.com/settings/tokens?type=beta>（Fine-grained token，推荐）：
- Token name：`pages-deploy`
- Expiration：建议 90 天（到期后重生成即可）
- Repository access：**Only select repositories** → 选你新建的仓库
- Permissions → Repository permissions → **Contents: Read and write**（仅此一项）
- 生成后**复制到剪贴板**（只显示一次）——它只保存在你本机内存/输入框，不写任何文件

> 也可用 Classic token（`repo` scope）或 SSH Key；三者任选一，本指南以 PAT 为例。

### 2. 创建仓库

<https://github.com/new> → Repository name 填 `shili-wardrobe`（或你确认的名字）→ **Public** → **不要**勾选 "Add a README"（保持空仓库，避免冲突）→ Create。

### 3. 本地推送（在 `衣橱App` 目录执行）

仓库已由我初始化并完成首次提交，你只需：

```bash
cd "C:/Users/Administrator/WorkBuddy/2026-10-12-16-36-54/衣橱App"

# 关联远程仓库（把 <用户名> 换成你的 GitHub 用户名）
git remote add origin https://github.com/<用户名>/shili-wardrobe.git

# 推送；用户名填 GitHub 用户名，密码栏粘贴第 1 步的 PAT（不是登录密码）
git push -u origin main
```

> Windows 首次输入后 Git 会记住凭据（凭据管理器），之后推送不再需要输入。PAT 不会出现在任何代码/配置文件中。

### 4. 开启 Pages（Source 选 GitHub Actions）

仓库页面 → **Settings → Pages → Build and deployment → Source: GitHub Actions**（不是 "Deploy from a branch"）。

### 5. 等待自动部署

推送即触发 Actions：仓库 **Actions** 标签页可见 "部署到 GitHub Pages" 工作流 → 约 1-2 分钟变绿 → 访问 <https://<用户名>.github.io/shili-wardrobe/> 验证。

### 6. 生成长期二维码

```bash
# 依赖：pip install qrcode
python scripts/make-https-qr.py <用户名> shili-wardrobe
# 产出 店铺二维码-https.png（已在 .gitignore 中，不会进仓库）
```

打印张贴，替换旧的局域网二维码。**该地址永久有效，任何网络都能扫开。**

## 六、GitHub Actions 自动发布流程

```
git push origin main
   └→ Actions 触发「部署到 GitHub Pages」
        ├─ actions/checkout@v4        检出代码
        ├─ actions/configure-pages@v5 配置 Pages 环境
        ├─ upload-pages-artifact@v3   整个目录原样上传（无构建）
        └─ deploy-pages@v4            发布到 https://<用户名>.github.io/<仓库名>/
```

以后每次更新衣服/改代码：`git add -A && git commit -m "..." && git push` → 一分钟内自动上线。也可在 Actions 页手动 "Run workflow" 重新部署。

## 七、离线访问设计说明

| 资源 | 策略 | 效果 |
|------|------|------|
| 全部静态资源（页面/JS/CSS/图标/模板） | install 时**预缓存** | 首次打开后完全离线可用，秒开 |
| `catalog.json`（衣服数据） | **网络优先 + 断网回退缓存** | 在线：店主更新后客人拿到最新；离线：显示上次成功加载的衣服 |
| 页面导航 | 网络优先 → 缓存首页 → `offline.html` | 断网扫码：有缓存直接开；首次打开无缓存才看到离线提示页 |

安装到主屏幕后（Android Chrome：菜单 → 添加至主屏幕），独立窗口全屏运行，与原生 App 体验一致。

## 八、验证步骤

### 本地验证（部署前，我现在就能跑）

```bash
# 1. 语法与格式
node --check app.js && node --check sw.js
python -c "import json;json.load(open('manifest.webmanifest',encoding='utf-8'));json.load(open('catalog.json',encoding='utf-8'));print('JSON OK')"

# 2. 起本地服务器（任意静态服务器均可）
python -m http.server 8091 --bind 0.0.0.0

# 3. 浏览器打开 http://localhost:8091/ → DevTools → Application：
#    - Manifest：无错误，图标 192/512 就位
#    - Service Workers：已激活，Cache Storage 含 wardrobe-v5 全部资源
#    - 断网（DevTools Network → Offline）后刷新：页面正常打开 = 预缓存生效
```

### 真机验证（部署后，必须做）

1. **HTTPS**：手机浏览器打开 `https://<用户名>.github.io/shili-wardrobe/` → 地址栏有锁标，无安全警告 → 启动动画后进主界面
2. **安装 PWA**：Android Chrome 菜单 → 「添加至主屏幕」→ 桌面图标启动，独立窗口无地址栏
3. **全离线**：开飞行模式 → 点桌面图标 → **仍能打开并浏览已缓存衣服**（catalog 走的是上次缓存）
4. **离线提示页**（可选严格验证）：新手机/无痕模式 + 飞行模式首次打开 → 显示「网络开小差了」提示页，恢复网络后重试正常
5. **扫码**：扫 `店铺二维码-https.png` → 直接打开 HTTPS 站点
6. **双入口**：扫出的顾客端无数据管理图标；`.../index.html#/admin` 直达店主后台

## 九、故障排查

| 现象 | 原因 | 解决 |
|------|------|------|
| 打开是 404 | Pages 未开 / Source 没选 GitHub Actions / Actions 未跑完 | Settings → Pages → Source 选 GitHub Actions；等 Actions 变绿 |
| push 要求密码 | GitHub 已禁用密码推送 | 用 PAT（第五节第 1 步） |
| push 403 无权限 | PAT 权限不够或未选中该仓库 | PAT 需 Contents: Read and write + 选中仓库 |
| 页面旧内容不更新 | SW 缓存 | 已升 v5 自动清旧缓存；仍异常则 DevTools → Clear storage |
| 店主更新 catalog 后客人看不到 | 不会发生（v5 已改网络优先） | 若发生，检查 catalog.json 是否真的保存成功了 |
| 自定义域名 HTTPS 勾不了 | DNS 未生效 | 等 DNS 解析生效后再勾 Enforce HTTPS |
| Actions 报 `pages` 权限错 | 仓库设置禁用过 Actions 权限 | Settings → Actions → General → Workflow permissions 选 "Read and write permissions" |

## 十、成本

GitHub Pages 公开仓库免费额度：每月软限制 100GB 流量 / 10 万次请求——一个影楼站点远远用不完。**总成本仍为 0 元。**
