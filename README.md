# 🎨 可分享、可实时展示的 在线团队协作白板

这是一个基于 **Vue 3** 和 **Fabric.js** 构建的实时协作白板应用。支持多人在线绘图、形状绘制、属性编辑、撤销重做以及云端保存等功能。后端采用 **Koa** + **Socket.io** 实现实时同步。

## ✨ 功能特性

*   **🖌️ 自由绘图**：支持画笔模式，可调节颜色和粗细。
*   **🧽 橡皮擦**：支持轨迹擦除，可精准删除线条或物体。
*   **📐 形状绘制**：快速添加矩形、圆形、三角形等基础图形。
*   **🤝 实时协作**：多人进入同一房间（URL ID 一致）即可实时看到对方的操作。
*   **⚙️ 属性编辑**：选中物体后可修改填充色、边框色及线宽。
*   **↩️ 撤销/重做**：支持 50 步历史记录回溯 (Ctrl+Z / Ctrl+Y)。
*   **💾 云端保存**：自动保存画布状态，刷新页面不丢失数据。
*   **📱 响应式设计**：适配移动端布局，支持触摸操作。
*   **🖼️ 图片导出**：一键将白板内容导出为 PNG 图片。

## 🛠️ 技术栈

### 前端 (Frontend)
*   **Vue 3** (Composition API) - 核心框架
*   **Vite** - 构建工具
*   **Pinia** - 状态管理
*   **Vue Router** - 路由管理
*   **Fabric.js** - Canvas 绘图引擎
*   **Socket.io-client** - 实时通信客户端
*   **Element Plus** - UI 组件库

### 后端 (Backend)
*   **Node.js** - 运行环境
*   **Koa** - Web 框架
*   **Socket.io** - WebSocket 服务端
*   **Koa-router** - API 路由

### 部署 (DevOps)
*   **Docker** & **Docker Compose** - 容器化部署
*   **Nginx** - 静态资源托管与反向代理

## 📂 项目结构

```text
MVP-demo/
├── public/                 # 静态资源目录
├── server/                 # 后端服务代码
│   └── index.js            # Koa + Socket.io 服务入口
├── src/
│   ├── api/                # API 请求封装
│   │   └── board.js        # 白板相关 API (saveBoard, getBoard)
│   ├── components/         # Vue 组件
│   │   ├── PropertySidebar.vue   # 属性侧边栏 (支持移动端抽屉)
│   │   └── WhiteboardToolbar.vue # 顶部工具栏 (响应式布局)
│   ├── composables/        # 组合式函数 (Hooks)
│   │   ├── useCanvas.js    # 核心绘图逻辑 (Fabric.js 封装)
│   │   └── useSocket.js    # WebSocket 通信逻辑 (单例模式)
│   ├── router/             # 路由配置
│   │   └── index.js        # 路由定义 (支持 /board/:id)
│   ├── stores/             # Pinia 状态仓库
│   │   └── boardStore.js   # 全局状态管理 (工具、属性、加载状态)
│   ├── views/              # 页面视图
│   │   └── Whiteboard.vue  # 白板主页面 (逻辑胶水层)
│   ├── App.vue             # 根组件
│   ├── main.js             # 入口文件
│   └── style.css           # 全局样式重置
│
├── package.json            # 项目依赖配置
└── vite.config.js          # Vite 配置文件

## 🚀 快速开始

### 本地开发 (Development)

1.  **安装依赖**
    ```bash
    npm install
    ```

2.  **启动后端服务**
    ```bash
    node server/index.js
    # 服务运行在 http://localhost:3000
    ```

3.  **启动前端开发服务器**
    ```bash
    npm run dev
    # 页面运行在 http://localhost:5173
    ```

4.  **访问**
    打开浏览器访问 `http://（你的ip地址）:5173`。会自动跳转到默认白板 `/board/default`。

## 📖 使用指南

1.  **切换工具**：点击顶部工具栏的图标切换“选择”、“画笔”或“橡皮擦”。
2.  **添加形状**：点击“形状”下拉菜单，选择矩形、圆形或三角形。
3.  **修改属性**：使用“选择”工具点击画布上的物体，侧边栏会自动弹出（移动端从底部弹出），可修改颜色和线宽。
4.  **多人协作**：点击工具栏“新建白板”创建画板，并且会随机生成唯一id。复制当前 URL 发送给朋友，对方打开后即可加入同一房间进行协作。
5.  **快捷键**：
    *   `V`: 选择模式
    *   `P`: 画笔模式
    *   `Delete` / `Backspace`: 删除选中物体
    *   `Ctrl + Z`: 撤销
    *   `Ctrl + Y`: 重做

## ⚠️ 注意事项

*   本项目为 MVP (Minimum Viable Product) 演示项目，后端数据存储在内存中 (`Map`)，重启服务后数据会丢失。生产环境建议对接 Redis 或 MongoDB。
*   移动端体验已做适配，但受限于 Canvas 性能，在低端设备上可能会有轻微延迟。