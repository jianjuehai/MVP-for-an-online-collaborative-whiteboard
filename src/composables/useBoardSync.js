// 负责白板数据的“生命周期流程”，例如：
// handleLoad()：加载（云端 -> 本地兜底 -> 状态更新）
// handleManualSave()：手动保存（序列化 -> 调 store action -> 状态反馈）
// verifyAndLoad()：密码校验并加载（把“弹窗输入密码”与加载流程连接）
// saveShareSettings()：保存分享设置并复制链接

import { updateShareSettings, getBoard } from '../api/board'
import { copyToClipboard } from '../utils/clipboard'
import { useRouter } from 'vue-router'

export function useBoardSync({
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
}) {
  const router = useRouter()

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

    // 登录用户访问 local 画板时，自动生成新 ID 并跳转 ---
    // 这样后续会重新触发 handleLoad，进入 Branch B 的“云端无数据”检测逻辑，
    // 从而自动把 board_data_local 的数据同步到这个新 ID 上。
    if (!isGuest.value && store.boardId === 'local') {
      const newId = Math.random().toString(36).substring(2, 8)
      console.log('登录用户访问 local，自动迁移至新 ID:', newId)
      router.replace(`/board/${newId}`)
      store.isLoading = false
      return
    }

    try {
      // --- 分支 A: 游客模式 (读本地) ---
      if (isGuest.value && isLocalBoard.value) {
        const localKey = `board_data_local`
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
          const guestLocalKey = `board_data_local`
          const guestDataStr = localStorage.getItem(guestLocalKey)

          if (guestDataStr) {
            console.log('检测到本地缓存，正在同步到云端...')
            const json = JSON.parse(guestDataStr)
            // 加载到画布
            loadFromJSON(json)

            // 立即触发一次保存到云端
            await store.save(json)

            // 同步完成后清除本地缓存，避免混淆
            localStorage.removeItem(guestLocalKey)

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

  return {
    handleLoad,
    handleManualSave,
    saveShareSettings,
    verifyAndLoad,
  }
}
