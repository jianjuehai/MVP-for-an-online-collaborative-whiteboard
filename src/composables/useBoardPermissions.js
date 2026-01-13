import { computed } from 'vue'

export function useBoardPermissions({
  store,
  isGuest,
  activeObject,
  remoteLocks,
}) {
  // --- 判断是否是本地创建的画板 ---
  const isLocalBoard = computed(() => {
    if (!isGuest.value) return false // 登录用户走云端逻辑
    return store.boardId === 'local'
  })

  // --- 核心权限判断 ---
  // 只有当是游客，且不是自己创建的画板时，才进行限制
  const isRestrictedGuest = computed(() => isGuest.value && !isLocalBoard.value)

  // 侧边栏锁定状态：被远程锁定 或 受限游客
  const isSidebarLocked = computed(() => {
    if (!activeObject.value) return false
    // 1. 如果被远程锁定（协同锁），强制锁定
    if (remoteLocks.value?.[activeObject.value.id]) return true
    // 2. 如果是受限游客
    if (isRestrictedGuest.value) {
      // 只有当对象显式被设为“不可选”时，才锁定面板
      // 我们在 Whiteboard.vue 里规定：刚添加的形状 selectable=true，历史对象 selectable=false
      // 所以如果是刚添加的，selectable 为 true -> 不锁 -> 允许编辑
      return activeObject.value.selectable === false
    }
    return false
  })

  return { isLocalBoard, isRestrictedGuest, isSidebarLocked }
}
