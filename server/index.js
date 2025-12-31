const Koa = require('koa')
const Router = require('koa-router')
const cors = require('@koa/cors')
const bodyParser = require('koa-bodyparser')
const http = require('http') // Node原生http模块
const { Server } = require('socket.io') // Socket.io

// 引入 path 和 fs 模块以及 koa-static。目的是为了后续可能的静态文件服务
const path = require('path')
const fs = require('fs')
const serve = require('koa-static')

// --- 引入数据库模块 ---
const { query } = require('./db')

const app = new Koa()
const router = new Router()

// 模拟数据库 (Key: boardId, Value: JSON Data)
// const db = new Map()
// Key: username, Value: { id, username, password }
// const users = new Map()

// 辅助函数：检查白板是否可用（过期或不存在）
const checkBoardAccess = (board, password) => {
  if (!board) return { allowed: false, reason: 'not_found' }

  // 修正 1: 数据库字段是 expires_at (下划线)，不是 meta.expiresAt
  // 注意：数据库取出的 bigint 可能是字符串或数字，比较时最好转一下，但在 JS 中通常直接比也没问题
  if (board.expires_at && Date.now() > Number(board.expires_at)) {
    return { allowed: false, reason: 'expired' }
  }

  // 修正 2: 数据库字段是 password，不是 meta.password
  if (board.password && board.password !== password) {
    return { allowed: false, reason: 'password_required' }
  }

  return { allowed: true }
}

// 中间件配置
app.use(cors()) // 允许跨域
app.use(bodyParser()) // 解析 JSON 请求体

// --- 托管前端静态资源 (放在 API 路由之前) ---
// dist 在项目根目录，而 server/index.js 在 server 目录，所以是 ../dist
const staticPath = path.join(__dirname, '../dist')

// 只有当 dist 目录存在时才托管，避免开发环境报错
if (fs.existsSync(staticPath)) {
  app.use(serve(staticPath))
}

// --- 中间件：解析 Token (但不强制拦截，因为未登录用户也能访问白板) ---
const authMiddleware = async (ctx, next) => {
  const token = ctx.headers['authorization']?.replace('Bearer ', '')

  if (token) {
    try {
      // 解码 Token，获取用户信息 { id, username, ... }
      const decoded = jwt.verify(token, JWT_SECRET)
      ctx.state.user = decoded
    } catch (err) {
      // Token 无效或过期，这里选择忽略，视为游客
      console.log('Token invalid:', err.message)
    }
  }
  await next()
}
// --- API 定义 ---

// 1. 获取白板数据
router.get('/api/board/:id', async (ctx) => {
  const { id } = ctx.params
  const { password } = ctx.query // 从查询参数获取密码

  try {
    // SQL 查询
    const rows = await query('SELECT * FROM boards WHERE id = ?', [id])
    const board = rows[0]

    // 如果数据库没记录，视为新白板
    if (!board) {
      ctx.body = { code: 0, data: null, message: 'New board' }
      return
    }

    const access = checkBoardAccess(board, password)

    if (!access.allowed) {
      // 如果是过期（expired），但当前请求携带的 Token 是该白板 owner，则允许访问
      const requesterId = ctx.state.user ? Number(ctx.state.user.id) : null
      const ownerId = board.owner_id ? Number(board.owner_id) : null

      if (
        access.reason === 'expired' &&
        requesterId &&
        ownerId &&
        requesterId !== ownerId
      ) {
        ctx.body = { code: 403, error: access.reason, message: 'Access denied' }
        return
      }
    }

    // 解析 JSON (数据库存的是字符串)
    const boardData = board.data ? JSON.parse(board.data) : null
    ctx.body = { code: 0, data: boardData }
  } catch (err) {
    console.error('DB Error:', err)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Server Error' }
  }
})

// 2. 保存白板数据
router.post('/api/board/:id', authMiddleware, async (ctx) => {
  // 如果没有用户信息，直接拒绝
  if (!ctx.state.user) {
    ctx.status = 401
    ctx.body = { code: 401, message: '请登录后保存' }
    return
  }

  const { id } = ctx.params
  const boardData = ctx.request.body

  // 获取当前登录用户的 ID (如果没有登录，则是 null)
  const userId = ctx.state.user ? ctx.state.user.id : null

  try {
    const dataStr = JSON.stringify(boardData)
    const now = new Date()

    // SQL 修改：
    // 1. 插入列增加了 owner_id
    // 2. VALUES 增加了 ?
    // 3. ON DUPLICATE KEY UPDATE 不更新 owner_id (防止别人保存时篡改所有者)
    const sql = `
      INSERT INTO boards (id, data, created_at, updated_at, owner_id) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        data = VALUES(data), 
        updated_at = VALUES(updated_at)
        -- 注意：这里不更新 owner_id，只有第一次创建时才写入
    `

    // 参数数组对应：id, data, created_at, updated_at, owner_id
    await query(sql, [id, dataStr, now, now, userId])

    ctx.body = { code: 0, message: 'Saved successfully' }
  } catch (err) {
    console.error('DB Error:', err)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Server Error' }
  }
})

// 3. 设置分享选项 (密码、有效期)
router.post('/api/board/:id/share', authMiddleware, async (ctx) => {
  if (!ctx.state.user) {
    ctx.status = 401
    ctx.body = { code: 401, message: '请登录后设置' }
    return
  }

  const { id } = ctx.params
  const { password, expiresIn } = ctx.request.body

  const expiresAt = expiresIn ? Date.now() + expiresIn * 3600 * 1000 : null
  const pwd = password || null
  const now = new Date()

  try {
    // SQL: 有则更新设置，无则插入
    const sql = `
      INSERT INTO boards (id, password, expires_at, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE 
        password = VALUES(password), 
        expires_at = VALUES(expires_at),
        updated_at = VALUES(updated_at)
    `
    await query(sql, [id, pwd, expiresAt, now, now])

    ctx.body = { code: 0, message: 'Share settings updated' }
  } catch (err) {
    console.error('DB Error:', err)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Server Error' }
  }
})
// 4. 单独验证密码接口 (用于前端输入密码后的校验)
// router.post('/api/board/:id/verify', async (ctx) => {
//   const { id } = ctx.params
//   const { password } = ctx.request.body

//   const board = db.get(id)
//   const access = checkBoardAccess(board, password)

//   if (access.allowed) {
//     ctx.body = { code: 0, token: 'ok' } // 简单返回成功
//   } else {
//     ctx.body = { code: 403, error: access.reason }
//   }
// })

// 5. 删除白板
router.delete('/api/board/:id', authMiddleware, async (ctx) => {
  if (!ctx.state.user) {
    ctx.status = 401
    ctx.body = { code: 401, message: '请登录后操作' }
    return
  }

  const { id } = ctx.params
  const userId = ctx.state.user.id

  try {
    // 检查是否是所有者
    const rows = await query('SELECT owner_id FROM boards WHERE id = ?', [id])
    const board = rows[0]

    if (!board) {
      ctx.body = { code: 404, message: '画板不存在' }
      return
    }

    if (board.owner_id !== userId) {
      ctx.status = 403
      ctx.body = { code: 403, message: '无权删除此画板' }
      return
    }

    // 执行删除
    await query('DELETE FROM boards WHERE id = ?', [id])
    ctx.body = { code: 0, message: '删除成功' }
  } catch (err) {
    console.error('Delete board error:', err)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Server Error' }
  }
})

// --- 用户认证相关 (注册、登录) ---

const jwt = require('jsonwebtoken')
const JWT_SECRET = 'your-secret-key' // 生产环境请放入环境变量

// 注册
router.post('/api/auth/register', async (ctx) => {
  const { username, password } = ctx.request.body

  // 1. 基础校验
  if (!username || !password) {
    ctx.body = { code: 400, message: '用户名和密码不能为空' }
    return
  }

  // 2. 检查用户名是否存在 (内存模拟)
  try {
    // 1. 检查用户名是否存在
    const existing = await query('SELECT id FROM users WHERE username = ?', [
      username,
    ])
    if (existing.length > 0) {
      ctx.body = { code: 400, message: '用户名已存在' }
      return
    }

    // 2. 插入新用户
    await query('INSERT INTO users (username, password) VALUES (?, ?)', [
      username,
      password,
    ])

    ctx.body = { code: 0, message: '注册成功' }
  } catch (err) {
    console.error('Register Error:', err)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Server Error' }
  }
})

// 登录
router.post('/api/auth/login', async (ctx) => {
  const { username, password } = ctx.request.body

  try {
    // 1. 查找用户
    const rows = await query('SELECT * FROM users WHERE username = ?', [
      username,
    ])
    const user = rows[0]

    // 2. 验证密码 (这里是明文比对，生产环境请用 bcrypt.compare)
    if (user && user.password === password) {
      const token = jwt.sign(
        { id: user.id, username: user.username },
        JWT_SECRET,
        { expiresIn: '24h' },
      )

      ctx.body = {
        code: 0,
        data: {
          token,
          username: user.username,
          id: user.id,
        },
        message: '登录成功',
      }
    } else {
      ctx.body = { code: 401, message: '用户名或密码错误' }
    }
  } catch (err) {
    console.error('Login Error:', err)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Server Error' }
  }
})

// --- 获取当前用户的白板列表 ---
router.get('/api/user/boards', authMiddleware, async (ctx) => {
  const userId = ctx.state.user.id

  try {
    // 只查询必要的字段，不要把巨大的 data 查出来
    const sql = `
      SELECT id, created_at, updated_at 
      FROM boards 
      WHERE owner_id = ? 
      ORDER BY updated_at DESC
    `
    const rows = await query(sql, [userId])

    ctx.body = { code: 0, data: rows }
  } catch (err) {
    console.error('Get user boards error:', err)
    ctx.status = 500
    ctx.body = { code: 500, message: 'Server Error' }
  }
})

// 挂载路由
app.use(router.routes()).use(router.allowedMethods())

// --- 处理 Vue Router 的 History 模式 ---
// 如果请求的不是 API，也不是静态资源，就返回 index.html
// 必须放在 router 挂载之后，作为最后的兜底
app.use(async (ctx) => {
  // 如果是 API 请求但没匹配到路由（404），直接返回，不返回 HTML
  if (ctx.path.startsWith('/api')) return

  // 检查是否是前端路由请求
  if (
    ctx.method === 'GET' &&
    fs.existsSync(path.join(staticPath, 'index.html'))
  ) {
    ctx.type = 'html'
    ctx.body = fs.createReadStream(path.join(staticPath, 'index.html'))
  }
})

// 将增删改操作应用到数据库中保存的 board.data（只同步对象级变更）
async function applyDeltaToBoard(roomId, action, data) {
  try {
    const rows = await query('SELECT data FROM boards WHERE id = ?', [roomId])
    let boardData =
      rows[0] && rows[0].data ? JSON.parse(rows[0].data) : { objects: [] }

    if (!boardData || typeof boardData !== 'object') boardData = { objects: [] }
    if (!Array.isArray(boardData.objects))
      boardData.objects = boardData.objects ? boardData.objects : []

    if (action === 'add') {
      // 避免重复添加
      if (!boardData.objects.find((o) => o.id === data.id)) {
        boardData.objects.push(data)
      }
    } else if (action === 'modify') {
      const idx = boardData.objects.findIndex((o) => o.id === data.id)
      if (idx !== -1) {
        // 合并修改字段，保留未修改字段
        boardData.objects[idx] = { ...boardData.objects[idx], ...data }
      } else {
        // 如果没有找到，作为回退：追加
        boardData.objects.push(data)
      }
    } else if (action === 'remove') {
      const removeId = data && data.id ? data.id : data
      boardData.objects = boardData.objects.filter((o) => o.id !== removeId)
    } else if (action === 'refresh') {
      // refresh 可以替换为完整数据（慎用）
      boardData = data || { objects: [] }
    } else {
      // 其它动作（moving/drawing 等）不持久化对象形态
      return
    }

    const now = new Date()
    const sql = `
      INSERT INTO boards (id, data, updated_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)
    `
    await query(sql, [roomId, JSON.stringify(boardData), now])
  } catch (err) {
    console.error('[applyDeltaToBoard] error:', err)
  }
}
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
  socket.on('draw', async (payload) => {
    try {
      const { roomId, action, data } = payload || {}
      if (!roomId) return

      // 广播给房间内的其他人（发送者不会收到自己发的）
      socket.to(roomId).emit('draw', payload)

      // 仅对增删改/refresh 做持久化（避免把频繁的移动/绘制中间态存库）
      if (['add', 'modify', 'remove', 'refresh'].includes(action)) {
        await applyDeltaToBoard(roomId, action, data)
      }
    } catch (err) {
      console.error('[socket draw] error:', err)
    }
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
