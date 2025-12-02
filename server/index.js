const Koa = require('koa')
const Router = require('koa-router')
const cors = require('@koa/cors')
const bodyParser = require('koa-bodyparser')
const http = require('http') // Node原生http模块
const { Server } = require('socket.io') // Socket.io

const app = new Koa()
const router = new Router()

// 模拟数据库 (Key: boardId, Value: JSON Data)
const db = new Map()

// 辅助函数：检查白板是否可用（过期或不存在）
const checkBoardAccess = (board, password) => {
  if (!board) return { allowed: false, reason: 'not_found' }

  // 检查过期
  if (board.meta?.expiresAt && Date.now() > board.meta.expiresAt) {
    return { allowed: false, reason: 'expired' }
  }

  // 检查密码
  if (board.meta?.password && board.meta.password !== password) {
    return { allowed: false, reason: 'password_required' }
  }

  return { allowed: true }
}

// 中间件配置
app.use(cors()) // 允许跨域
app.use(bodyParser()) // 解析 JSON 请求体

// --- API 定义 ---

// 1. 获取白板数据
router.get('/api/board/:id', async (ctx) => {
  const { id } = ctx.params
  const { password } = ctx.query // 从查询参数获取密码

  const board = db.get(id)

  // 如果是新白板（内存里没有），直接允许
  if (!board) {
    ctx.body = { code: 0, data: null, message: 'New board' }
    return
  }

  const access = checkBoardAccess(board, password)

  if (!access.allowed) {
    // 返回特定的错误码，前端据此显示密码输入框或过期提示
    ctx.body = { code: 403, error: access.reason, message: 'Access denied' }
    return
  }

  ctx.body = { code: 0, data: board.data }
})

// 2. 保存白板数据
router.post('/api/board/:id', async (ctx) => {
  const { id } = ctx.params
  const boardData = ctx.request.body // 前端传来的 canvas JSON

  // 获取旧数据以保留 meta 信息
  const existing = db.get(id) || { meta: {} }

  db.set(id, {
    ...existing,
    data: boardData,
  })

  ctx.body = { code: 0, message: 'Saved successfully' }
})

// 3. 设置分享选项 (密码、有效期)
router.post('/api/board/:id/share', async (ctx) => {
  const { id } = ctx.params
  const { password, expiresIn } = ctx.request.body // expiresIn 单位：小时

  const existing = db.get(id) || { data: null }

  const meta = {
    password: password || null, // 空字符串视为无密码
    expiresAt: expiresIn ? Date.now() + expiresIn * 3600 * 1000 : null,
  }

  db.set(id, { ...existing, meta })

  ctx.body = { code: 0, message: 'Share settings updated' }
})

// 4. 验证密码接口 (用于前端输入密码后的校验)
router.post('/api/board/:id/verify', async (ctx) => {
  const { id } = ctx.params
  const { password } = ctx.request.body

  const board = db.get(id)
  const access = checkBoardAccess(board, password)

  if (access.allowed) {
    ctx.body = { code: 0, token: 'ok' } // 简单返回成功
  } else {
    ctx.body = { code: 403, error: access.reason }
  }
})
// 挂载路由
app.use(router.routes()).use(router.allowedMethods())

// --- WebSocket 设置 ---

// 1. 创建 HTTP Server，将 Koa 应用作为回调传入
const server = http.createServer(app.callback())

// 2. 初始化 Socket.io，绑定到 http server 上
const io = new Server(server, {
  cors: {
    origin: '*', // 允许前端跨域连接
    methods: ['GET', 'POST'],
  },
})

// 3. 监听 Socket 连接事件
io.on('connection', (socket) => {
  console.log('Client connected:', socket.id)

  // 监听前端发来的 "join" 事件 (加入房间)
  socket.on('join', (roomId) => {
    socket.join(roomId) // 将该 socket 加入对应的房间分组
    console.log(`Socket ${socket.id} joined room: ${roomId}`)

    socket
      .to(roomId)
      .emit('sys_msg', `User ${socket.id.substring(0, 4)} joined the room.`)
  })

  // 核心绘图同步事件
  // Payload 结构: { roomId, action, data, objectId }
  socket.on('draw', (payload) => {
    const { roomId } = payload

    // 广播给房间内的其他人
    // 这样发送者不会收到自己发出的消息，天然避免了一部分循环
    socket.to(roomId).emit('draw', payload)
  })

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id)
  })
})

// 4. 启动服务器
const PORT = 3000
server.listen(PORT, () => {
  console.log(
    `🚀 Server (HTTP + WebSocket) running at http://localhost:${PORT}`,
  )
})
