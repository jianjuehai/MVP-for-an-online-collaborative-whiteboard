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

// --- (全局单例区域) ---
socket.on('connect', () => {
  isConnected.value = true
  console.log('✅ Socket connected:', socket.id)
})

socket.on('disconnect', () => {
  isConnected.value = false
  console.log('❌ Socket disconnected')
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

  return {
    socket,
    isConnected,
    connect,
    joinRoom,
  }
}
