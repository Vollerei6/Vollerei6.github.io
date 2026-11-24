# 个人主页

一个**零构建、零依赖**的静态个人主页（邓默 / Vollerei6），外加页脚一个可以打字的小终端。

```
.
├── index.html                 主页（简历式，内容全是静态 HTML）
├── cv/index.html              一页纸简历（浏览器打印即 PDF）
├── inner-world/index.html     彩蛋页（主页上没有任何链接指向它）
├── assets/
│   ├── css/style.css          主页样式
│   ├── css/inner.css          里世界样式
│   └── js/terminal.js         终端解释器（约 370 行，无依赖）
├── data/stats.json            里世界读取的实时数据（由 Actions 更新）
├── scripts/fetch-stats.mjs    抓取 B 站 / Steam 数据（只在 CI 或本机手动跑）
├── tests/shell-test.html      终端的 15 项自测（浏览器打开即可）
└── .github/workflows/refresh-stats.yml
```

## 本地预览

```powershell
cd D:\PersonalPage
python -m http.server 8765
# 打开 http://127.0.0.1:8765/
```

直接用 `file://` 双击打开也能看，只有一处降级：`inner-world` 里的粉丝数读不到
（浏览器禁止 `file://` 下 fetch 本地 JSON），页面会提示用 http 打开。
终端在 `file://` 下完全正常，`tests/shell-test.html` 也可以直接双击。

## 部署到 GitHub Pages（约 5 分钟）

1. 新建仓库 **`Vollerei6.github.io`**（必须和用户名一致，网址才是 `https://vollerei6.github.io/`）。
   免费账号的 Pages 要求仓库 **public**。
2. 推送。**这台机器的 22 端口不通**（hosts 把 github.com 指到 127.0.0.1 了），用 HTTPS + PAT：
   ```powershell
   git remote add origin https://github.com/Vollerei6/Vollerei6.github.io.git
   git push -u origin main          # 密码处粘贴 Personal Access Token（Contents: Read and write）
   ```
   PAT 在 <https://github.com/settings/tokens> 生成。
3. 仓库 **Settings → Pages → Source: Deploy from a branch → main / (root)**，保存。
4. 等 1–2 分钟，访问 `https://vollerei6.github.io/`。

## 实时数据

里世界的粉丝数/关注数来自 `data/stats.json`。B 站接口不返回 CORS 头，浏览器无法直连，
所以由 Actions 每天抓一次并提交 JSON。**零配置**：mid 用 workflow 里的兜底值。

![refresh-stats](https://github.com/Vollerei6/Vollerei6.github.io/actions/workflows/refresh-stats.yml/badge.svg)

1. 想换成别的账号：**Settings → Secrets and variables → Actions** 加 `BILI_MID` 覆盖兜底值。
   可选：`STEAM_KEY` + `STEAM_ID`（Steam Web API key，只存在 Secrets 里）。
2. **Actions → refresh-stats → Run workflow** 可以手动跑一次。
3. 只有数值真的变了才会产生 commit（否则每天一个空 commit 太吵）。
4. 本地想验证抓取：`node scripts/fetch-stats.mjs --mid=3493144029038938 --dry-run`。
   - 校园网 DNS 对 `api.bilibili.com` 会返回 NXDOMAIN（本机实测），本地跑不通属正常，用 Actions。

> 当前 `data/stats.json` 里是 2026-11-24 抓的真实值，已可直接显示。

## 简历页

`cv/index.html` 是一页 A4 版式，点右下角"打印 / 存为 PDF"，或者在浏览器里 `Ctrl+P`，
边距选"默认"、勾掉页眉页脚，就能得到 `邓默-简历.pdf`。
内容改的是这个 HTML 本身（有意不引外部 CSS，单独改不会影响主页）。

## 还没确定的事

- [ ] 简历里"预计 2028.06 毕业"是我按 24 级四年制推的，不对就改
- [ ] 论文标注"第三作者"，如果作者顺序需要调整告诉我
- [ ] 里世界要不要接英雄联盟战绩（需要 Riot/腾讯开放平台的 key，国服比较麻烦）
- [ ] 是否加自定义域名 / Cloudflare Pages 镜像（国内访问 github.io 偶尔不稳）

## 终端

支持 `help` `ls` `cat` `cd` `pwd` `whoami` `date` `history` `clear` `echo` `exit` `open`，
以及自定义的 `sudo` `rm` `contact`；`Tab` 补全、`↑↓` 翻历史、`Ctrl+L` 清屏。
命令表在 `terminal.js` 的 `commands` 里，页面通过 `Shell.mount({...})` 注入内容。

> 终端是彩蛋而非唯一入口：简历内容全部是静态 HTML，关掉 JS、搜索引擎、手机浏览器都能正常看到主页。
