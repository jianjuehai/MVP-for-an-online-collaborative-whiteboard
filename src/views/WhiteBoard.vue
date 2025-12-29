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

    <ShareDialogs
      v-model:visibleShare="showShareDialog"
      v-model:visiblePassword="showPasswordDialog"
      v-model:passwordError="passwordErrorMsg"
      @save-settings="saveShareSettings"
      @verify-password="verifyAndLoad"
    />
    <div class="main-content">
      <!-- 2. 画布区域 -->
      <div class="canvas-wrapper" ref="canvasWrapperRef">
        <canvas id="c"></canvas>
        <!-- isLoading -> store.isLoading -->
        <div class="loading-overlay" v-if="store.isLoading">
          <div class="spinner"></div>
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
import { onMounted, onUnmounted, ref, watch, computed } from 'vue'
import { useBoardStore } from '../stores/boardStore'
import { useCanvas } from '../composables/useCanvas'
import { useSocket } from '../composables/useSocket'
import { useUserStore } from '../stores/userStore'
import WhiteboardToolbar from '../components/WhiteboardToolbar.vue'
import PropertySidebar from '../components/PropertySidebar.vue'
import { useRoute, useRouter } from 'vue-router'
import ShareDialogs from '../components/ShareDialogs.vue'
import { updateShareSettings, getBoard } from '../api/board'

// --- 初始化 Store ---
const store = useBoardStore()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isGuest = computed(() => !userStore.token)

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
const showShareDialog = ref(false)
const showPasswordDialog = ref(false)
const passwordErrorMsg = ref('')

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

// 加载逻辑，接收密码参数
const handleLoad = async (password = '') => {
  store.isLoading = true
  // 每次尝试加载前，先清空错误（如果是首次加载）
  if (!password) passwordErrorMsg.value = ''

  try {
    // --- 分支 A: 游客模式 (读本地) ---
    if (isGuest.value) {
      const localKey = `board_data_${store.boardId}`
      const localDataStr = localStorage.getItem(localKey)

      if (localDataStr) {
        const json = JSON.parse(localDataStr)
        loadFromJSON(json)
        store.setStatus('已加载本地缓存')
      } else {
        clearCanvas()
        store.setStatus('新本地白板')
      }
      store.isLoading = false
      return // 游客逻辑结束
    }

    // --- 分支 B: 登录用户 (读云端 + 同步) ---
    const res = await getBoard(store.boardId, password)

    if (res.code === 0) {
      // 切换白板时，重置历史记录栈，防止跨白板撤销
      historyStack.value = []
      redoStack.value = []

      if (res.data) {
        loadFromJSON(res.data)
        store.setStatus('云端数据已同步')
      } else {
        // 2. 云端无数据 (新白板)：检查是否有本地缓存需要同步
        // 场景：用户刚在游客模式画完，点击登录回来，此时云端是空的，但本地有刚才画的
        const localKey = `board_data_${store.boardId}`
        const localDataStr = localStorage.getItem(localKey)

        if (localDataStr) {
          console.log('检测到本地缓存，正在同步到云端...')
          const json = JSON.parse(localDataStr)

          // 加载到画布
          loadFromJSON(json)

          // 立即触发一次保存到云端
          await store.save(json)

          // 同步完成后清除本地缓存，避免混淆
          localStorage.removeItem(localKey)

          store.setStatus('本地数据已同步至云端')
        } else {
          // 真的全是新的
          clearCanvas()
          store.setStatus('新白板已创建')
        }
      }
      showPasswordDialog.value = false
      passwordErrorMsg.value = '' // 成功后清空错误
    } else if (res.code === 403) {
      if (res.error === 'password_required') {
        showPasswordDialog.value = true
        store.setStatus('需要密码')

        // 如果是用户手动输入密码后返回 403，说明密码错了
        if (password) {
          passwordErrorMsg.value = '密码错误，请重试'
        }
      } else if (res.error === 'expired') {
        alert('此白板链接已过期')
        router.push('/')
      }
    }
  } catch (err) {
    console.error('加载白板数据失败:', err)
    store.setStatus('加载失败，请检查网络')
  } finally {
    store.isLoading = false
  }
}

// 验证密码的回调
const verifyAndLoad = (password) => {
  handleLoad(password)
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

const copyLink = () => {
  showShareDialog.value = true
}

// 保存分享设置的回调
const copyToClipboard = async (text) => {
  // 1. 优先尝试标准 API (需要 HTTPS 或 localhost)
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  // 2. 降级方案：使用传统的 document.execCommand (兼容 HTTP)
  // 创建一个隐藏的输入框来选中文本
  const textArea = document.createElement('textarea')
  textArea.value = text

  // 防止在移动端唤起键盘
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.setAttribute('readonly', '')

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    const successful = document.execCommand('copy')
    if (!successful) throw new Error('Copy failed')
  } catch (err) {
    throw new Error('浏览器不支持自动复制，' + err)
  } finally {
    document.body.removeChild(textArea)
  }
}

// 保存分享设置的回调
const saveShareSettings = async (settings) => {
  // 1. 先尝试保存到后端
  try {
    await updateShareSettings(store.boardId, settings)
  } catch (err) {
    console.error(err)
    store.setStatus('保存设置失败，请检查网络')
    return // 如果后端存不进去，就直接停止
  }

  // 2. 后端保存成功后，再尝试复制链接
  try {
    const url = window.location.href
    await copyToClipboard(url)
    store.setStatus('设置已保存，链接已复制')
  } catch (err) {
    console.warn('复制失败:', err)
    // 即使复制失败，也要告诉用户设置是成功的
    store.setStatus('设置已保存 (请手动复制链接)')
  }

  showShareDialog.value = false
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
    if (newId) {
      store.boardId = newId

      // 1. 重新加载云端数据
      await handleLoad()

      // 2. 切换 Socket 房间
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
    // 只有非游客 (登录用户) 且已连接时，才发送广播
    // 游客虽然连接了 Socket，但这里不执行 emit，所以不会影响别人
    if (!isGuest.value && isConnected.value) {
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

// 组件销毁时的清理逻辑
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
