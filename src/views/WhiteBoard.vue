<template>
  <div class="whiteboard-container">
    <!-- 1. 工具栏组件 -->
    <WhiteboardToolbar
      :current-tool="store.currentTool"
      :can-undo="historyStack.length >= 2"
      :can-redo="redoStack.length > 0"
      :is-busy="store.isSaving || store.isLoading"
      :is-loading="store.isLoading"
      :is-connected="isConnected"
      :status-message="store.statusMessage"
      :is-error="store.isError"
      :board-id="store.boardId"
      @set-tool="handleSetTool"
      @undo="undo"
      @redo="redo"
      @add-shape="handleAddShape"
      @save="handleManualSave"
      @load="handleLoad"
      @download="downloadImage"
      @copy-link="copyLink"
      @clear="clearCanvas"
      @new-board="handleNewBoard"
    />

    <div class="main-content">
      <!-- 2. 画布区域 -->
      <div class="canvas-wrapper" ref="canvasWrapperRef">
        <canvas id="c"></canvas>
        <!-- isLoading -> store.isLoading -->
        <div class="loading-overlay" v-if="store.isLoading">
          <div class="spinner">加载中...</div>
        </div>
      </div>

      <!-- 3. 属性侧边栏组件 -->
      <!-- 这里的变量都需要加 store. 前缀 -->
      <PropertySidebar
        :is-open="store.isSidebarOpen"
        :active-object="activeObject"
        :attributes="store.attributes"
        @update-attribute="syncAttribute"
        @delete="deleteSelected"
        @close="store.isSidebarOpen = false"
      />
    </div>
  </div>
</template>

<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useBoardStore } from '../stores/boardStore'
import { useCanvas } from '../composables/useCanvas'
import { useSocket } from '../composables/useSocket'
import WhiteboardToolbar from '../components/WhiteboardToolbar.vue'
import PropertySidebar from '../components/PropertySidebar.vue'
import { useRoute, useRouter } from 'vue-router'

// --- 初始化 Store ---
const store = useBoardStore()
const route = useRoute()
const router = useRouter()

// --- Composables ---
const {
  initCanvas,
  addShape,
  setMode,
  deleteSelected,
  clearCanvas,
  activeObject,
  updateActiveObject,
  toJSON,
  loadFromJSON,
  exportAsImage,
  setEventCallback,
  applyRemoteUpdate,
  undo,
  redo,
  historyStack,
  redoStack,
} = useCanvas()

const { socket, isConnected, connect, joinRoom } = useSocket()

// --- 本地状态 (仅保留与 DOM 相关的) ---
const canvasWrapperRef = ref(null)

// --- 逻辑桥接 (连接 Store 和 Canvas) ---

const debounce = (func, wait) => {
  let timeout
  return function (...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

// 自动保存逻辑
const autoSave = debounce(async () => {
  const json = toJSON()
  await store.save(json)
}, 1000)

const handleManualSave = async () => {
  const json = toJSON()
  await store.save(json)
  store.setStatus('已保存到云端')
}

const handleLoad = () => {
  store.load((data) => loadFromJSON(data))
}

// 工具切换
const handleSetTool = (tool) => {
  store.setTool(tool)
  if (tool === 'pen') {
    setMode('pen', store.attributes.stroke, store.attributes.strokeWidth)
  } else if (tool === 'eraser') {
    setMode('eraser')
  } else {
    setMode('select')
  }
}

const handleAddShape = (type) => {
  handleSetTool('select')
  addShape(type, {
    fill: store.attributes.fill,
    stroke: store.attributes.stroke,
    strokeWidth: store.attributes.strokeWidth,
  })
}

const syncAttribute = (key, value) => {
  store.attributes[key] = value // 更新 Store
  updateActiveObject(key, value) // 更新 Canvas
  if (store.currentTool === 'pen') {
    setMode('pen', store.attributes.stroke, store.attributes.strokeWidth)
  }
}

const copyLink = async () => {
  // ... 复制链接逻辑 (可以使用 store.setStatus 替代本地 setStatus) ...
  const url = window.location.href
  try {
    await navigator.clipboard.writeText(url)
    store.setStatus('🔗 链接已复制')
  } catch (err) {
    store.setStatus('❌ 复制失败', err)
  }
}

const handleNewBoard = () => {
  // 生成一个 6 位随机字符串作为 ID
  const newId = Math.random().toString(36).substring(2, 8)
  // 跳转路由，watch 会自动处理剩下的逻辑（重置画布、加入新房间）
  router.push(`/board/${newId}`)
}

const downloadImage = () => {
  const dataURL = exportAsImage()
  if (!dataURL) return
  const link = document.createElement('a')
  link.download = `whiteboard-${store.boardId}-${Date.now()}.png`
  link.href = dataURL
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

// --- 监听 ---
// 监听路由参数变化，自动切换房间
watch(
  () => route.params.id,
  async (newId) => {
    // [修改] 加上 async
    if (newId) {
      store.boardId = newId

      // [新增] 1. 重新加载云端数据
      await handleLoad()

      // [新增] 2. 切换 Socket 房间
      if (isConnected.value) {
        joinRoom(newId)
      }
    }
  },
  { immediate: true },
)

watch(activeObject, (newObj) => {
  if (newObj) {
    store.isSidebarOpen = true
    if (newObj.fill) store.attributes.fill = newObj.fill
    if (newObj.stroke) store.attributes.stroke = newObj.stroke
    if (newObj.strokeWidth !== undefined)
      store.attributes.strokeWidth = newObj.strokeWidth
  } else {
    store.isSidebarOpen = false
  }
})

watch(
  isConnected,
  (connected) => {
    if (connected) {
      console.log('[Socket] Connected, joining room:', store.boardId)
      joinRoom(store.boardId)
    }
  },
  { immediate: true },
)

// 提取键盘事件处理函数，方便移除
const handleKeydown = (e) => {
  const target = e.target
  if (
    ['INPUT', 'TEXTAREA'].includes(target.tagName) ||
    target.isContentEditable
  )
    return
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault()
    undo()
    return
  }
  if (
    (e.ctrlKey || e.metaKey) &&
    (e.key === 'y' || (e.shiftKey && e.key === 'Z'))
  ) {
    e.preventDefault()
    redo()
    return
  }
  if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
  if (e.key.toLowerCase() === 'v') handleSetTool('select')
  if (e.key.toLowerCase() === 'p') handleSetTool('pen')
}

// --- 生命周期 ---
onMounted(async () => {
  initCanvas('c')

  window.addEventListener('keydown', handleKeydown) // 使用命名函数

  setEventCallback((eventPayload) => {
    if (isConnected.value) {
      socket.emit('draw', { roomId: store.boardId, ...eventPayload })
    }
    autoSave()
  })

  socket.on('draw', (payload) => applyRemoteUpdate(payload))

  // 加载初始数据
  await handleLoad()

  connect()
  if (socket.connected) joinRoom(store.boardId)
  else socket.once('connect', () => joinRoom(store.boardId))
})

// [新增] 组件销毁时的清理逻辑
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  socket.off('draw') // 移除监听，防止内存泄漏
})
</script>

<style scoped>
/* 基础布局 */
.whiteboard-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  height: 100vh;
  margin: 0;
  padding: 12px;
  box-sizing: border-box;
  font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  background-color: #f5f5f7;
}

/* 主内容区 */
.main-content {
  display: flex;
  flex: 1;
  gap: 16px;
  min-height: 0;
  position: relative;
  overflow: hidden;
}

.canvas-wrapper {
  flex: 1;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
  background: white;
  position: relative;
  overflow: hidden;
  z-index: 1;
}

.helper-item {
  background: rgba(0, 0, 0, 0.6);
  color: white;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  backdrop-filter: blur(4px);
}

.loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 10;
  backdrop-filter: blur(2px);
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f3f3f3;
  border-top: 3px solid #409eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}
</style>
