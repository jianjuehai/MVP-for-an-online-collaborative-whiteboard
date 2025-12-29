# 🎨 可分享、可实时展示的 在线团队协作白板

这是一个基于 **Vue 3** 和 **Fabric.js** 构建的实时协作白板应用。支持多人在线绘图、形状绘制、属性编辑、撤销重做以及云端保存等功能。后端采用 **Koa** + **Socket.io** 实现实时同步。

## 📺 视频演示
  [点击此处观看视频演示](https://github.com/jianjuehai/MVP-for-an-online-collaborative-whiteboard/issues/1#issue-3689704565)

## ✨ 功能特性

#### 1. 基础绘图与属性编辑

*   **🖌️ 自由绘图**：支持画笔模式，可调节颜色和粗细。
*   **🧽 橡皮擦**：支持轨迹擦除，可精准删除线条或物体。
*   **📐 形状绘制**：快速添加矩形、圆形、三角形等基础图形。
*   **⚙️ 属性编辑**：选中物体后可修改填充色、边框色及线宽。

#### 2. 实时协同
*   **🤝 URL分享**：点击新建画布会生成唯一ID，点击分享可以设置密码并复制链接
*   **🤝 实时协作**：多人进入同一房间（URL ID 一致）即可实时看到对方的操作。

#### 3. 历史记录
*   **↩️ 撤销/重做**：维护 `historyStack` 和 `redoStack`，50步历史记录回溯，支持快捷键 (Ctrl+Z / Ctrl+Y)。

#### 4. 其他功能
*   **💾 云端保存**：自动保存画布状态，刷新页面不丢失数据。
*   **📱 响应式设计**：适配移动端布局，支持触摸操作。
*   **🖼️ 图片导出**：一键将白板内容导出为 PNG 图片。

## 💡 难点攻克

**1. 无限循环更新**
**问题描述**：A 画图 -> 发送给 B -> B 渲染图形 -> B 的 Canvas 触发 object:added 事件 -> B 又发送给 A -> 死循环。
**解决方案**：引入 isReceivingRemote 互斥锁。
* 当执行远程同步代码时，将锁置为 true。
* 事件监听器检测到锁为 true 时，拦截事件，不发送 WebSocket 消息。
* 渲染完成后释放锁。

**2. 后来者数据同步**
**问题描述**：新用户进入房间时，看不到之前用户画的内容。
**解决方案**：
* 自动保存：前端实现防抖 (```debounce```) 机制，在操作停止 1秒 后自动将全量 JSON 同步至服务端内存。
* 全量拉取：新用户初始化时，先调用 HTTP 接口 (```GET /api/board/:id```) 拉取最新快照，渲染完成后再建立 WebSocket 连接。

**3. 橡皮擦的碰撞检测**
**问题描述**：开始使用简单的白色涂抹覆盖，后发现无法处理物体移动，于是采用直接删除物体
**解决方案**：AI 建议采用“碰撞检测”方案。
* 在 mouse:move 事件中，计算鼠标轨迹与画布上所有物体的几何相交。
* 使用 ```fabric.Intersection.intersectLinePolygon```判断线段与多边形是否接触。
* 为了防止误删（如透明区域），结合了 ```isTargetTransparent``` 进行像素级检测。

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
```

## 🤖 AI 辅助开发声明 
本项目在开发周期紧迫的情况下，采用了 AI 结对编程 模式，由我主导架构与逻辑设计，AI 辅助代码生成。

* 开发者主导
    * 系统架构设计、技术选型（Vue3 + Fabric + Socket）
    * 核心数据流设计（只传输发生变化的数据而不是整个白板的）
    * 关键难点攻克（防环锁机制、历史记录栈逻辑）
    * 前后端接口关联
    * 代码审查与重构
    * 样式美化
* AI 辅助
    * 生成 Fabric.js 的具体 API 调用代码
    * Element Plus 组件的响应式布局适配
    * socket.io接口调用
    * 通用的工具函数（防抖、节流、随机ID）
    * CSS 细节，代码优化
    * 橡皮擦的线性插值碰撞检测算法、撤销重做栈逻辑较为复杂，由 AI 提供算法原型，我负责将其适配到 Vue 的生命周期中

## 🚀 快速开始

### 本地开发 (Development)

1.  **安装依赖**
    ```bash
    npm install
    ```

2.  **启动开发环境**
    ```bash
    node server/index.js 
    #启动后端
    # 服务运行在 http://localhost:3000
    ```
    ```bash
    npm run dev / pnpm dev
    #启动前端
    # 页面运行在 http://localhost:5173
    ```

3.  **生产环境构建与运行**
    ```bash
    npm run build
    # 构建前端静态资源 (会在根目录生成 dist 文件夹)
    ```
    ```bash
    node server/index.js 
    # 页面运行在 http://localhost:3000 (自动代理 API 请求到后端)
    ```

4.  **访问**
    打开浏览器访问 `页面运行在 http://localhost:5173 (通过代理连接后端)`。会自动跳转到默认白板 `/board/default`。

## 📖 使用指南

1.  **切换工具**：点击顶部工具栏的图标切换“选择”、“画笔”或“橡皮擦”。
2.  **添加形状**：点击“形状”下拉菜单，选择矩形、圆形或三角形。
3.  **修改属性**：使用“选择”工具点击画布上的物体，侧边栏会自动弹出（移动端从底部弹出），可修改颜色和线宽。
4.  **多人协作**：点击工具栏“新建白板”创建画板，并且会随机生成唯一id。复制当前 URL 发送给朋友，可设置密码和有效期，对方打开后即可加入同一房间进行协作。
5.  **快捷键**：
    *   `V`: 选择模式
    *   `P`: 画笔模式
    *   `Delete` / `Backspace`: 删除选中物体
    *   `Ctrl + Z`: 撤销
    *   `Ctrl + Y`: 重做

## ⚠️ 注意事项

*   本项目为 MVP (Minimum Viable Product) 演示项目，后端数据存储在内存中 (`Map`)，重启服务后数据会丢失。生产环境建议对接 Redis 或 MongoDB。

## 🔮 未来规划
* 性能优化：引入 Redis 替代内存存储，支持持久化。
* 冲突解决：引入算法解决多人同时编辑同一物体的冲突。
* 样式扩展：工具栏引入更多形状
* 目前的撤销/重做逻辑是基于全量快照，这会导致内存占用较高。