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
        @close="handleSidebarClose"
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
import { ElMessage } from 'element-plus'
// --- 初始化 Store ---
const store = useBoardStore()
const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isGuest = computed(() => !userStore.token)

// --- 判断是否是本地创建的画板 ---
const isLocalBoard = computed(() => {
  if (!isGuest.value) return false // 登录用户走云端逻辑
  const myBoards = JSON.parse(localStorage.getItem('my_guest_boards') || '[]')
  return myBoards.includes(store.boardId)
})

// --- 核心权限判断 ---
// 只有当是游客，且不是自己创建的画板时，才进行限制
const isRestrictedGuest = computed(() => isGuest.value && !isLocalBoard.value)

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

const { socket, isConnected, connect, joinRoom } = useSocket()

// --- 本地状态 (仅保留与 DOM 相关的) ---
const canvasWrapperRef = ref(null)
const showShareDialog = ref(false)
const showPasswordDialog = ref(false)
const passwordErrorMsg = ref('')
const boardOwnerId = ref(null)
const boardOwnerName = ref('')

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
  // 如果是受限游客（访问他人画板），禁止全量保存，只依赖 Socket 广播
  if (isRestrictedGuest.value) return
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
    if (isGuest.value && isLocalBoard.value) {
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
      // 记录房主信息
      if (res.owner) {
        boardOwnerId.value = res.owner.id
        boardOwnerName.value = res.owner.username
      } else {
        boardOwnerId.value = null
        boardOwnerName.value = ''
      }

      // 切换白板时，重置历史记录栈，防止跨白板撤销
      historyStack.value = []
      redoStack.value = []

      if (res.data) {
        loadFromJSON(res.data)
        // --- 游客模式下，加载的数据全部锁定 ---
        if (isGuest.value && canvas.value) {
          setTimeout(() => {
            canvas.value.getObjects().forEach((obj) => {
              obj.set({ selectable: false, evented: false })
            })
            canvas.value.requestRenderAll()
          }, 100)
        }
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
  // 游客限制：只能用 pen
  if (isRestrictedGuest.value && tool !== 'pen') {
    // 如果是添加形状操作(通常不通过setTool触发，但为了保险)
    // 这里主要拦截 select 和 eraser
    ElMessage.warning('游客模式仅可使用画笔和添加形状')
    return
  }
  store.setTool(tool)
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
  store.setTool('select')
  setMode('select')
  addShape(type, {
    fill: store.attributes.fill,
    stroke: store.attributes.stroke,
    strokeWidth: store.attributes.strokeWidth,
  })
  const obj = canvas.value.getActiveObject()
  if (obj && isGuest.value) {
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
  // 游客创建时，记录 ID
  if (isGuest.value) {
    // 1. 删除当前画板的本地数据 (不保存之前的)
    if (store.boardId) {
      localStorage.removeItem(`board_data_${store.boardId}`)
    }
    // 2. 重置列表，只保留当前这个 (不保留多白板历史)
    // 这样 isLocalBoard 依然能识别当前这个是自己创建的，但之前的 ID 会失效
    localStorage.setItem('my_guest_boards', JSON.stringify([newId]))
  }
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
        setMode('pen')
        store.setTool('pen')
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
    store.isSidebarOpen = true
    if (newObj.fill) store.attributes.fill = newObj.fill
    if (newObj.stroke) store.attributes.stroke = newObj.stroke
    if (newObj.strokeWidth !== undefined)
      store.attributes.strokeWidth = newObj.strokeWidth
    // 打开侧边栏时，开始会话
    beginAttributeEdit(newObj.id)
  } else {
    store.isSidebarOpen = false
    // 失去选中时也尝试提交会话（防止用户直接点空白处关闭）
    commitAttributeEdit()
  }
})

// 替换侧边栏关闭处理，先提交会话，再关闭
const handleSidebarClose = () => {
  commitAttributeEdit()
  store.isSidebarOpen = false
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
