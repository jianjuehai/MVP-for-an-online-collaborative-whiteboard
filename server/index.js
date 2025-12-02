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

// 中间件配置
app.use(cors()) // 允许跨域
app.use(bodyParser()) // 解析 JSON 请求体

// --- API 定义 ---

// 1. 获取白板数据
router.get('/api/board/:id', async (ctx) => {
  const { id } = ctx.params
  const data = db.get(id)

  if (data) {
    ctx.body = { code: 0, data }
  } else {
    // 如果没有数据，返回空对象或初始化配置
    ctx.body = { code: 0, data: null, message: 'New board' }
  }
})

// 2. 保存白板数据
router.post('/api/board/:id', async (ctx) => {
  const { id } = ctx.params
  const boardData = ctx.request.body // 前端传来的 canvas JSON

  if (!boardData) {
    ctx.status = 400
    ctx.body = { code: -1, message: 'Data is required' }
    return
  }

  db.set(id, boardData)
  console.log(
    `[Save] Board ${id} saved. Object count: ${boardData.objects?.length}`,
  )

  ctx.body = { code: 0, message: 'Saved successfully' }
})

// 3. (可选) 获取所有白板列表 - 调试用
router.get('/api/boards', async (ctx) => {
  ctx.body = { code: 0, list: Array.from(db.keys()) }
})

// 挂载路由
app.use(router.routes()).use(router.allowedMethods())

// --- WebSocket 设置 (Day 6 核心) ---

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

    // (可选) 广播给房间里其他人: "有人来了"
    // socket.to(roomId) 表示发给房间里除了自己以外的人
    socket
      .to(roomId)
      .emit('sys_msg', `User ${socket.id.substring(0, 4)} joined the room.`)
  })

  // [Day 7 新增] 核心绘图同步事件
  // Payload 结构: { roomId, action, data, objectId }
  socket.on('draw', (payload) => {
    const { roomId } = payload

    // 广播给房间内的其他人 (socket.to 会排除发送者自己)
    // 这样发送者不会收到自己发出的消息，天然避免了一部分循环
    socket.to(roomId).emit('draw', payload)

    // (可选) 可以在这里把增量操作合并到 db 的 JSON 中，实现后端持久化
    // 为了简单起见，Day 7 我们暂时只做转发，不实时改写后端数据库
  })

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id)
  })
})

// 4. 启动服务器 (注意这里是 server.listen，不是 app.listen)
const PORT = 3000
server.listen(PORT, () => {
  console.log(
    `🚀 Server (HTTP + WebSocket) running at http://localhost:${PORT}`,
  )
})
