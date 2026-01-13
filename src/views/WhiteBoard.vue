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
      :is-restricted="isRestrictedGuest"
      :board-owner-id="boardOwnerId"
      :board-owner-name="boardOwnerName"
      :has-active-object="!!activeObject"
      @set-tool="handleSetTool"
      @undo="undo"
      @redo="redo"
      @add-shape="handleAddShape"
      @save="handleManualSave"
      @load="handleLoad"
      @download="downloadImage"
      @copy-link="copyLink"
      @clear="handleClear"
      @new-board="handleNewBoard"
      @open-sidebar="store.isSidebarOpen = true"
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
        :is-locked="isSidebarLocked"
        @update-attribute="syncAttribute"
        @delete="deleteSelected"
        @close="handleSidebarClose"
        @focus-attribute="handleAttributeFocus"
        @blur-attribute="handleAttributeBlur"
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
import { ElMessage } from 'element-plus'
import { useBoardPermissions } from '../composables/useBoardPermissions'
import { useBoardSync } from '../composables/useBoardSync'

// --- 初始化 Store ---
const store = useBoardStore()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isGuest = computed(() => !userStore.token)

// --- Composables ---
const {
  canvas,
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
  setOnError,
  applyRemoteUpdate,
  undo,
  redo,
  historyStack,
  redoStack,
  beginAttributeEdit,
  commitAttributeEdit,
} = useCanvas()

const {
  socket,
  isConnected,
  connect,
  joinRoom,
  remoteLocks,
  requestLock,
  releaseLock,
} = useSocket()

const { isLocalBoard, isRestrictedGuest, isSidebarLocked } =
  useBoardPermissions({
    store,
    isGuest,
    activeObject,
    remoteLocks,
  })

// --- 本地状态 (仅保留与 DOM 相关的) ---
const canvasWrapperRef = ref(null)
const showShareDialog = ref(false)
const showPasswordDialog = ref(false)
const passwordErrorMsg = ref('')
const boardOwnerId = ref(null)
const boardOwnerName = ref('')

const { handleLoad, handleManualSave, saveShareSettings, verifyAndLoad } =
  useBoardSync({
    store,
    isGuest,
    isLocalBoard,
    canvas,
    historyStack,
    redoStack,
    toJSON,
    loadFromJSON,
    clearCanvas,
    boardOwnerId,
    boardOwnerName,
    showPasswordDialog,
    passwordErrorMsg,
    showShareDialog,
  })

// 自动保存逻辑
const autoSave = (json = toJSON()) => {
  store.triggerAutoSave(json, isRestrictedGuest.value)
}

// 工具切换
const handleSetTool = (tool) => {
  // 游客限制：只能用 pen
  const result = store.setActiveTool(tool, isRestrictedGuest.value)
  if (!result.success) {
    ElMessage.warning(result.message)
    return
  }
  if (tool === 'pen') {
    setMode('pen', store.attributes.stroke, store.attributes.strokeWidth)
  } else if (tool === 'eraser') {
    setMode('eraser')
  } else {
    setMode('select')
  }
}
const handleClear = () => {
  if (isRestrictedGuest.value) {
    ElMessage.warning('游客模式无法清空画布')
    return
  }
  clearCanvas()
}

const handleAddShape = (type) => {
  // 临时允许切换到 select 模式，以便操作新形状
  // 注意：handleSetTool 会拦截游客的 select 请求，所以这里手动设置 store 和 canvas mode
  store.currentTool = 'select'
  setMode('select')

  addShape(type, {
    fill: store.attributes.fill,
    stroke: store.attributes.stroke,
    strokeWidth: store.attributes.strokeWidth,
  })
  const obj = canvas.value.getActiveObject()
  if (obj && isRestrictedGuest.value) {
    obj.set({
      selectable: true,
      evented: true,
    })
    canvas.value.requestRenderAll()
  }
}

const syncAttribute = (key, value) => {
  store.attributes[key] = value // 更新 Store
  updateActiveObject(key, value) // 更新 Canvas
  if (store.currentTool === 'pen') {
    handleSetTool('pen')
  }
}

const copyLink = () => {
  showShareDialog.value = true
}

const handleNewBoard = () => {
  // 游客创建
  if (isGuest.value) {
    const localId = 'local'
    // 游客固定使用 'local' 标识
    // 1. 如果当前不在 local 画板，跳转过去 (watch 会处理后续)
    if (store.boardId !== localId) {
      router.push(`/board/${localId}`)
    } else {
      // 2. 如果已经在 local 画板，则清空当前内容
      // 清空本地存储中的 temporary 数据
      localStorage.removeItem(`board_data_${localId}`)
      clearCanvas()
      store.setStatus('新建本地白板')
    }
    return
  }
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

      // 加载完成后，如果是游客，强制设为画笔模式
      if (isRestrictedGuest.value) {
        handleSetTool('pen')
        ElMessage.info('游客模式：仅可新增内容')
      }
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
    // store.isSidebarOpen = true // 改为手动点击按钮打开
    if (newObj.fill) store.attributes.fill = newObj.fill
    if (newObj.stroke) store.attributes.stroke = newObj.stroke
    if (newObj.strokeWidth !== undefined)
      store.updateAttribute('strokeWidth', newObj.strokeWidth)
    // 打开侧边栏时，开始会话
    beginAttributeEdit(newObj.id)
  } else {
    store.isSidebarOpen = false
    // 失去选中时也尝试提交会话（防止用户直接点空白处关闭）
    commitAttributeEdit()
  }
})

// 替换侧边栏关闭处理，先提交会话，再关闭
// 关闭时也确保释放锁 (防止 blur 没触发)

// 替换侧边栏关闭处理，先提交会话，再关闭
const handleSidebarClose = () => {
  commitAttributeEdit()
  store.isSidebarOpen = false
  // 关闭时也确保释放锁 (防止 blur 没触发)
  if (activeObject.value) {
    releaseLock(store.boardId, activeObject.value.id)
  }
}

const handleAttributeFocus = () => {
  if (activeObject.value) {
    requestLock(store.boardId, activeObject.value.id)
  }
}

const handleAttributeBlur = () => {
  if (activeObject.value) {
    releaseLock(store.boardId, activeObject.value.id)
  }
}

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
  const c = initCanvas('c')

  // --- 游客选择限制逻辑 ---
  // 1. 监听选择被清除 (selection:cleared)
  // 当游客取消选中某个物体时，立即将其锁定，禁止再次选中
  c.on('selection:cleared', (e) => {
    if (isRestrictedGuest.value && e.deselected) {
      e.deselected.forEach((obj) => {
        obj.set({
          selectable: false,
          evented: false, // 禁止响应事件，防止 hover 效果
        })
      })
      c.requestRenderAll()
    }
  })

  // 2. 监听对象添加 (object:added)
  // 游客新增的对象，初始允许选中（以便调整），但要标记一下
  c.on('object:added', (e) => {
    // 游客模式下，默认所有进来的对象都不可选
    // 只有通过 addShape 手动添加的，我们会在那里显式设为 true
    if (isRestrictedGuest.value && e.target) {
      // 默认锁死
      e.target.set({
        selectable: false,
        evented: false,
      })
    }
  })

  // 3. 监听路径创建 (path:created) - 这是画笔画完一笔时触发
  c.on('path:created', (e) => {
    if (isRestrictedGuest.value && e.path) {
      // 画完的笔迹不允许调整
      e.path.set({
        selectable: false,
        evented: false,
      })
    }
  })

  window.addEventListener('keydown', handleKeydown) // 使用命名函数

  setEventCallback((eventPayload) => {
    const { action } = eventPayload

    // 1. 权限拦截：如果是受限游客（访问他人画板），只允许 'add' 和 'drawing'
    // 防止游客触发修改/删除事件后广播给别人
    if (isRestrictedGuest.value) {
      if (
        action !== 'add' &&
        action !== 'drawing' &&
        action !== 'modify' &&
        action !== 'moving'
      ) {
        autoSave()
        return
      }
    }

    // 2. 发送广播
    // 允许发送的条件：
    // A. 登录用户 (!isGuest)
    // B. 受限游客 (isRestrictedGuest) -> 即访问他人画板，需要协作
    // 排除：游客在自己本地画板 (isGuest && isLocalBoard) -> 纯本地，不广播
    if ((!isGuest.value || isRestrictedGuest.value) && isConnected.value) {
      socket.emit('draw', {
        roomId: store.boardId,
        token: userStore.token, // 游客此时为 undefined，后端会识别为 Guest
        ...eventPayload,
      })
    }

    autoSave()
  })

  setOnError((msg) => {
    ElMessage.warning(msg)
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
