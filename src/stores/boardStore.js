import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { saveBoard } from '../api/board'
import { useUserStore } from './userStore'
import { debounce } from '../utils/debounce'

export const useBoardStore = defineStore('board', () => {
  // --- 状态 (State) ---
  // 优先使用 URL 中的 id。如果没有，则判断：登录用户生成随机 ID，游客使用 'default'
  const urlId = new URLSearchParams(window.location.search).get('id')
  const boardId = ref(urlId || Math.random().toString(36).slice(2, 8))
  const currentTool = ref('select')
  const isSidebarOpen = ref(false)
  const isLoading = ref(false)
  const isSaving = ref(false)

  // 属性状态 (画笔颜色、粗细等)
  const attributes = reactive({
    fill: '#ffa500',
    stroke: '#000000',
    strokeWidth: 3,
  })

  // 状态消息
  const statusMessage = ref('')
  const isError = ref(false)
  let statusTimeout = null

  // --- 动作 (Actions) ---

  const setActiveTool = (tool, isRestrictedGuest) => {
    // 游客限制逻辑移到这里
    if (isRestrictedGuest && tool !== 'pen') {
      return { success: false, message: '游客模式仅可使用画笔和添加形状' }
    }

    currentTool.value = tool
    return { success: true }
  }

  // 封装属性更新
  const updateAttribute = (key, value) => {
    attributes[key] = value
  }

  // 封装自动保存逻辑 (去抖动)
  // 注意：Store 不直接持有 canvas 数据，需要传入数据闭包或在外部调用 save
  const triggerAutoSave = debounce(async (jsonData, isRestrictedGuest) => {
    if (isRestrictedGuest) return
    await save(jsonData)
  }, 1000)

  const setStatus = (message, error = false) => {
    statusMessage.value = message
    isError.value = error
    clearTimeout(statusTimeout)
    statusTimeout = setTimeout(() => {
      statusMessage.value = ''
      isError.value = false
    }, 3000)
  }

  const save = async (jsonData) => {
    if (!boardId.value) return
    isSaving.value = true

    const userStore = useUserStore()

    try {
      if (userStore.token) {
        // 已登录：保存到云端
        await saveBoard(boardId.value, jsonData)
        console.log('[AutoSave] Cloud Success')
      } else {
        // 未登录：保存到本地 LocalStorage
        // 使用 boardId 作为 key，实现不同房间数据隔离
        const key = `board_data_${boardId.value}`
        localStorage.setItem(key, JSON.stringify(jsonData))
        console.log('[AutoSave] Local Success')
      }
    } catch (err) {
      console.error('[AutoSave] Failed', err)
      setStatus('自动保存失败', true)
    } finally {
      isSaving.value = false
    }
  }

  return {
    boardId,
    currentTool,
    isSidebarOpen,
    isLoading,
    isSaving,
    attributes,
    statusMessage,
    isError,
    setActiveTool,
    updateAttribute,
    triggerAutoSave,
    setStatus,
    save,
  }
})
