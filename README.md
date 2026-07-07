# 论文阅读器 (Paper Reader)

> 面向学术的 Android 论文阅读 App，内置 AI 问答、翻译、生词本与间隔复习。

**版本**: 0.7

## 功能特性

- **重排阅读** — Docling 解析 PDF，按段落重排，支持原文页对照
- **AI 问答** — FTS5 + 向量语义混合检索 (RAG) + DeepSeek 流式回答，支持引用跳转
- **跨论文全局问答** — 一次提问搜索所有论文，综合多篇文献回答
- **段落翻译** — 逐段中英对照，公式用 KaTeX 渲染
- **生词本** — 选中单词一键收藏，自动生成词根词缀与助记
- **学习 & 复习** — 扇贝风格两步学习 + SM-2 间隔复习算法，自动标记已掌握
- **打卡日历** — GitHub 风格热力图，追踪学习天数，可自定义每日目标
- **阅读统计** — 每篇论文阅读时长、会话次数追踪
- **阅读书签** — 自动保存阅读位置，下次打开继续上次阅读
- **高亮 & 导出** — 三色高亮 + 点击删除 + 导出 Markdown 笔记
- **批量上传** — 一次选择多个 PDF 批量上传
- **元数据提取** — CrossRef API 自动获取论文标题、作者、DOI
- **论文搜索** — 按标题、摘要、作者关键词搜索
- **离线支持** — IndexedDB 缓存已读论文，无网也能阅读
- **全局暗色模式** — 阅读器 + 所有页面统一主题切换
- **复习提醒** — 每日定时推送通知提醒复习单词
- **请求超时** — API 请求 30 秒超时，网络不稳定不会卡死

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 18 + TypeScript + Tailwind CSS + Capacitor 8 |
| 后端 | Hono + better-sqlite3 + Drizzle ORM |
| PDF 解析 | Docling (Python) / pdfjs-dist fallback |
| AI | DeepSeek API (流式 SSE) |
| 检索 | SQLite FTS5 全文搜索 |
| 部署 | 阿里云 ECS (Debian) + Docker |

## 项目结构

```
paper-reader/
├── client/                  # React + Capacitor 前端
│   ├── src/
│   │   ├── components/      # 共享组件
│   │   │   ├── reader/      # 阅读器组件
│   │   │   └── vocab/       # 单词学习组件
│   │   ├── pages/           # 页面
│   │   ├── stores/          # Zustand 状态管理
│   │   ├── hooks/           # 自定义 hooks
│   │   └── services/        # API 调用 & 离线存储
│   └── android/             # Capacitor Android 原生层
├── server/                  # Hono Node.js 后端
│   ├── src/
│   │   ├── routes/          # API 路由
│   │   ├── services/        # 业务逻辑 (LLM, PDF, 翻译)
│   │   ├── db/              # Drizzle schema & 连接
│   │   └── middleware/      # JWT 认证
│   └── python/              # Docling PDF 解析脚本
└── deploy_final.py          # 部署脚本 (paramiko SSH)
```

## 本地开发

### 环境要求

- Node.js 20+
- Python 3.10+ (含 docling, PyMuPDF)
- Android Studio (模拟器)

### 后端

```bash
cd server
cp .env.example .env       # 填入 DEEPSEEK_API_KEY 等
npm install

# 设置 Python 路径 (Windows)
set PYTHON_EXECUTABLE=C:\path\to\python.exe
set PYTHONIOENCODING=utf-8

npm run dev                # http://localhost:3000
```

服务端采用单所有者设备配对模型。生产环境必须配置 `DEVICE_PAIRING_CODE`；已配对设备可在 App 的“AI 与设备设置”中查看和撤销。

### 前端

```bash
cd client
npm install
npm run dev                # http://localhost:5173
```

## 质量检查

```bash
# 服务端：空库迁移、设备配对/撤销、上传限制、检索融合
cd server
npm test
npm run build
npm audit --omit=dev

# 客户端：离线 outbox 迁移与幂等同步
cd ../client
npm test
npm run build
npm audit --omit=dev
```

GitHub Actions 还会执行 Android `testDebugUnitTest` 冒烟检查。
Windows 本地项目路径含中文时可运行 `cd client && npm run android:test`；该命令只把测试产物放到临时英文路径，不改变 APK 的正常输出位置。

## 数据库维护

数据库结构由 `server/src/db/migrations/` 下的版本化迁移管理。启动时会自动应用未执行的迁移；手动执行与备份命令如下：

```bash
cd server
npm run db:migrate
npm run db:backup   # 保留最近 5 份备份
```

旧部署第一次升级时会自动登记为迁移基线，不会删除现有论文数据或运行时 FTS5 表。

### Android 模拟器

```bash
cd client
npx cap sync android
npx cap run android --target emulator-5554
```

## 部署

```bash
# 1. 复制部署配置
cp .env.deploy.example .env.deploy
# 填入 SSH_HOST、SSH_USER、SSH_KEY_PATH、SSH_KNOWN_HOSTS

# 2. 执行部署
python deploy_final.py
```

> 注意：Hono 服务用 `nohup` 启动（PM2 v7 有 fd 泄漏 bug）。

## 许可证

MIT
