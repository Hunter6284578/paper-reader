# 论文阅读器 (Paper Reader)

> 面向学术的 Android 论文阅读 App，内置 AI 问答、翻译、生词本与间隔复习。

**版本**: 0.5

## 功能特性

- **重排阅读** — Docling 解析 PDF，按段落重排，支持原文页对照
- **AI 问答** — FTS5 全文检索 + DeepSeek 流式回答，支持引用跳转
- **段落翻译** — 逐段中英对照，公式用 KaTeX 渲染
- **生词本** — 选中单词一键收藏，自动生成词根词缀与助记
- **学习 & 复习** — 扇贝风格两步学习 + SM-2 间隔复习算法
- **打卡日历** — GitHub 风格热力图，追踪学习天数
- **离线支持** — IndexedDB 缓存已读论文，无网也能阅读
- **主题切换** — 浅色 / 深色 / 护眼模式

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | React 19 + TypeScript + Tailwind CSS + Capacitor 8 |
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

### 前端

```bash
cd client
npm install
npm run dev                # http://localhost:5173
```

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
# 填入 SSH_HOST, SSH_USER, SSH_PASSWORD

# 2. 执行部署
python deploy_final.py
```

> 注意：Hono 服务用 `nohup` 启动（PM2 v7 有 fd 泄漏 bug）。

## 许可证

MIT
