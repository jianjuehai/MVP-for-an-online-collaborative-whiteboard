import { defineStore } from 'pinia'
import { ref, reactive } from 'vue'
import { saveBoard, getBoard } from '../api/board'

export const useBoardStore = defineStore('board', () => {
  // --- 状态 (State) ---
  const boardId = ref(
    new URLSearchParams(window.location.search).get('id') || 'default',
  )
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

  const setTool = (tool) => {
    currentTool.value = tool
  }

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
    try {
      await saveBoard(boardId.value, jsonData)
      console.log('[AutoSave] Success')
    } catch (err) {
      console.error('[AutoSave] Failed', err)
      setStatus('自动保存失败', true)
    } finally {
      isSaving.value = false
    }
  }

  const load = async (loadCallback) => {
    if (isLoading.value) return
    try {
      isLoading.value = true
      const res = await getBoard(boardId.value)
      const { data } = res.data
      if (data) {
        loadCallback(data) // 回调函数处理 Canvas 加载
        setStatus('数据已同步')
      } else {
        setStatus('新白板已创建')
      }
    } catch (err) {
      console.error(err)
      setStatus('无法连接到服务器', true)
    } finally {
      isLoading.value = false
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
    setTool,
    setStatus,
    save,
    load,
  }
})
