import { io } from 'socket.io-client'
import { ref } from 'vue'

// 动态构建 Socket 地址
const getSocketUrl = () => {
  if (import.meta.env.PROD) return '/'
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:3000`
}

const socket = io(getSocketUrl(), {
  autoConnect: false,
  transports: ['websocket'],
})

const isConnected = ref(false)
// 远程锁状态: { [objectId]: userId }
const remoteLocks = ref({})

// --- (全局单例区域) ---
socket.on('connect', () => {
  isConnected.value = true
  console.log('✅ Socket connected:', socket.id)
})

socket.on('disconnect', () => {
  isConnected.value = false
  remoteLocks.value = {} // 断开连接清空锁状态
  console.log('❌ Socket disconnected')
})

socket.on('init-locks', (locks) => {
  // locks 结构: { [objectId]: { userId, timestamp } }
  // 转换为简单的 { [objectId]: userId }
  const simpleLocks = {}
  for (const key in locks) {
    simpleLocks[key] = locks[key].userId
  }
  remoteLocks.value = simpleLocks
})

socket.on('object-locked', ({ objectId, userId }) => {
  remoteLocks.value[objectId] = userId
})

socket.on('object-unlocked', ({ objectId }) => {
  delete remoteLocks.value[objectId]
})

socket.on('sys_msg', (msg) => {
  console.log('📢 System Message:', msg)
})

export function useSocket() {
  const connect = () => {
    if (socket.connected) {
      isConnected.value = true // 修正状态
      return
    }
    socket.connect()
  }

  const joinRoom = (roomId) => {
    if (socket.connected) {
      socket.emit('join', roomId)
    }
  }

  const requestLock = (boardId, objectId) => {
    if (socket.connected) {
      socket.emit('request-lock', { boardId, objectId })
    }
  }

  const releaseLock = (boardId, objectId) => {
    if (socket.connected) {
      socket.emit('release-lock', { boardId, objectId })
    }
  }

  return {
    socket,
    isConnected,
    remoteLocks,
    connect,
    joinRoom,
    requestLock,
    releaseLock,
  }
}
