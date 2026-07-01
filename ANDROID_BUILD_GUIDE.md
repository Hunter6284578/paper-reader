# Android App 构建与测试指南

##  快速开始

### 开发环境（连接本地后端）

1. **启动后端服务**
```bash
cd server && npm run dev
```

2. **构建并部署到 Android 模拟器/真机**
```bash
cd client && npm run android:debug
```

此命令会自动：
- 构建前端生产版本
- 同步到 Android 工程
- 打开 Android Studio（或直接在设备上运行）

3. **在 Android Studio 中点击 Run 按钮**，选择模拟器或连接的 Android 设备进行部署。

---

### 生产环境（连接远程后端）

1. **修改环境变量**
```bash
# 编辑 client/.env.production
VITE_API_BASE_URL=https://your-api-domain.com
```

2. **构建 Release APK**
```bash
cd client && npm run android:release
```

3. **APK 输出位置**
```
client/android/app/build/outputs/apk/release/app-release.apk
```

4. **安装到设备**
```bash
adb install client/android/app/build/outputs/apk/release/app-release.apk
```

---

## ✅ 功能验证清单

### 基础功能
- [ ] APK 成功安装到 Android 8.0+ 设备
- [ ] 应用启动无白屏，加载速度 < 3 秒
- [ ] 登录功能正常（用户名 admin / 密码 admin123）
- [ ] 退出登录后重新登录正常

### PDF 上传
- [ ] Android 端文件选择器正常打开
- [ ] 支持选择 PDF 文件
- [ ] 上传进度显示正常
- [ ] 上传成功后跳转到阅读页

### 沉浸式阅读
- [ ] 文本流布局正常渲染（非 PDF iframe）
- [ ] 章节标题分隔线显示正确
- [ ] 无限滚动加载下一批段落（距底部 5 段时触发）
- [ ] 底部进度条实时更新

### 主题与设置
- [ ] 切换白色/米色/深色主题即时生效
- [ ] 调节字号（14px~24px）即时生效
- [ ] 调节行高（1.5~2.0）即时生效
- [ ] 设置持久化到 localStorage，重启后保留

### 翻译功能
- [ ] 点击"翻译"按钮调用后端 API
- [ ] 逐段模式：英文原文 + 可折叠中文译文
- [ ] 逐句模式：每句下方显示对应译文
- [ ] 翻译缓存生效（二次访问无需重新翻译）
- [ ] 预加载窗口正常工作（当前段 N 时预载 N+1~N+10）

### 高亮与批注
- [ ] 选中文字弹出浮动工具栏
- [ ] 点击"高亮"成功标记文本
- [ ] 高亮颜色可选（黄/绿/蓝/粉）
- [ ] 点击"收藏生词"添加到词汇表
- [ ] 点击"添加批注"打开输入框
- [ ] 刷新页面后高亮/批注保留

### AI 问答
- [ ] 桌面端：AI 侧边栏正常展开/收起
- [ ] 移动端：AI 底部弹窗正常弹出/关闭
- [ ] 发送问题后流式回答正常
- [ ] 引用标注显示正确
- [ ] 清空对话功能正常

### 系统交互
- [ ] Android 返回键：阅读页返回列表页，列表页退出应用
- [ ] 状态栏沉浸式：与阅读主题颜色一致
- [ ] 横竖屏切换：布局自适应（如支持）

### 网络异常处理
- [ ] 无网络时显示友好提示
- [ ] API 请求超时显示错误信息
- [ ] 翻译失败时显示重试按钮

---

## 🔧 常见问题排查

### 1. 编译错误

**TypeScript 错误：**
```bash
cd client && npx tsc --noEmit
```

**构建失败：**
```bash
# 清理缓存后重新构建
rm -rf node_modules dist
npm install
npm run build
```

### 2. Capacitor 同步问题

**同步失败：**
```bash
# 删除 Android 平台重新添加
npx cap remove android
npx cap add android
npx cap sync
```

**插件未识别：**
```bash
# 检查插件是否正确安装
npx cap doctor android
```

### 3. Android Studio 问题

**Gradle 同步失败：**
- 确保已安装 JDK 17+
- 检查 `android/gradle/wrapper/gradle-wrapper.properties` 中的 Gradle 版本
- 尝试 File → Invalidate Caches / Restart

**无法找到设备：**
- 确保 USB 调试已开启
- 运行 `adb devices` 检查设备连接
- 重启 adb 服务：`adb kill-server && adb start-server`

### 4. 运行时问题

**白屏或加载失败：**
- 检查 `capacitor.config.ts` 中的 `webDir` 配置是否正确
- 确认前端已构建：`npm run build`
- 查看 Logcat 日志：`adb logcat | grep -i capacitor`

**API 请求失败：**
- 检查 `.env.development` 或 `.env.production` 中的 `VITE_API_BASE_URL`
- 确认后端服务正在运行
- 检查 CORS 配置（后端需允许跨域）

**状态栏不显示：**
- 确认已安装 `@capacitor/status-bar`
- 检查 `AndroidManifest.xml` 中是否有 `android:usesCleartextTraffic="true"`（开发环境）

---

## 🚀 后续优化方向

1. **离线支持**：使用 Service Worker + IndexedDB 缓存已阅读的论文和翻译结果
2. **推送通知**：集成 Firebase Cloud Messaging，推送翻译完成通知
3. **应用内更新**：检测新版本并提示用户下载最新 APK
4. **性能监控**：集成 Sentry 或 Firebase Crashlytics 追踪崩溃和性能问题
5. **Google Play 上架**：申请开发者账号，准备隐私政策、应用截图、描述材料

---

## 📞 技术支持

如遇问题，请检查：
1. Node.js 版本 >= 20
2. Android SDK 已安装（通过 Android Studio）
3. Gradle 版本兼容
4. 所有依赖已正确安装：`npm install`

查看详细日志：
```bash
# 前端构建日志
npm run build --verbose

# Android 构建日志
cd android && ./gradlew assembleDebug --info

# 设备日志
adb logcat
```
