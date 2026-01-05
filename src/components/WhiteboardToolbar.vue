<template>
  <div class="toolbar-wrapper">
    <el-card
      shadow="hover"
      :body-style="{
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }"
    >
      <!-- 工具组 1: 基础工具 -->
      <el-button-group>
        <!-- 游客模式下禁用选择工具 (防止移动/修改他人图形) -->
        <el-tooltip content="选择模式 (V)" placement="bottom" :hide-after="0">
          <el-button
            :type="currentTool === 'select' ? 'primary' : 'default'"
            @click="$emit('set-tool', 'select')"
            :disabled="isRestricted"
          >
            <el-icon><Pointer /></el-icon>
          </el-button>
        </el-tooltip>

        <el-tooltip content="画笔模式 (P)" placement="bottom" :hide-after="0">
          <el-button
            :type="currentTool === 'pen' ? 'primary' : 'default'"
            @click="$emit('set-tool', 'pen')"
          >
            <el-icon><EditPen /></el-icon>
          </el-button>
        </el-tooltip>

        <!-- 游客模式下禁用橡皮擦 -->
        <el-tooltip content="橡皮擦" placement="bottom" :hide-after="0">
          <el-button
            :type="currentTool === 'eraser' ? 'primary' : 'default'"
            @click="$emit('set-tool', 'eraser')"
            :disabled="isRestricted"
          >
            🧽
          </el-button>
        </el-tooltip>
      </el-button-group>
      <el-divider direction="vertical" />

      <!-- 工具组 2: 撤销重做 (游客禁用，防止撤销他人操作) -->
      <el-button-group>
        <el-tooltip content="撤销 (Ctrl+Z)" placement="bottom" :hide-after="0">
          <el-button
            @click="$emit('undo')"
            :disabled="!canUndo || isRestricted"
          >
            <el-icon><RefreshLeft /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="重做 (Ctrl+Y)" placement="bottom" :hide-after="0">
          <el-button
            @click="$emit('redo')"
            :disabled="!canRedo || isRestricted"
          >
            <el-icon><RefreshRight /></el-icon>
          </el-button>
        </el-tooltip>
      </el-button-group>

      <el-divider direction="vertical" />

      <!-- 工具组 3: 形状 -->
      <el-dropdown trigger="click" @command="(cmd) => $emit('add-shape', cmd)">
        <el-button>
          添加形状 <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="rect">⬜ 矩形</el-dropdown-item>
            <el-dropdown-item command="circle">⚪ 圆形</el-dropdown-item>
            <el-dropdown-item command="triangle">🔺 三角形</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>

      <el-divider direction="vertical" />

      <!-- 属性面板按钮 -->
      <el-tooltip content="属性面板" placement="bottom" :hide-after="0">
        <el-button @click="$emit('open-sidebar')" :disabled="!hasActiveObject">
          <el-icon><Setting /></el-icon>
        </el-button>
      </el-tooltip>

      <el-divider direction="vertical" />

      <!-- 工具组 4: 保存与操作 -->
      <el-button-group>
        <el-tooltip content="新建白板" placement="bottom" :hide-after="0">
          <el-button @click="$emit('new-board')">
            <el-icon><Plus /></el-icon>
          </el-button>
        </el-tooltip>
        <!-- 保存按钮：如果是游客，点击弹出登录提示 -->
        <el-tooltip
          :content="userStore.token ? '保存到云端' : '保存到云端 (需登录)'"
          placement="bottom"
        >
          <el-button @click="handleSaveClick" :loading="isBusy">
            <el-icon><Upload /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="刷新数据" placement="bottom" :hide-after="0">
          <el-button @click="$emit('load')" :loading="isLoading">
            <el-icon><Refresh /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="导出图片" placement="bottom" :hide-after="0">
          <el-button @click="$emit('download')">
            <el-icon><Picture /></el-icon>
          </el-button>
        </el-tooltip>
      </el-button-group>

      <!-- 分享按钮 -->
      <el-tooltip
        v-if="isOwner"
        :content="userStore.token ? '分享链接' : '分享链接 (需登录)'"
        placement="bottom"
      >
        <el-button
          type="success"
          plain
          @click="handleShareClick"
          style="margin-left: 8px"
        >
          <el-icon style="margin-right: 4px"><Share /></el-icon> 分享
        </el-button>
      </el-tooltip>

      <!-- 状态展示区 (右侧) -->
      <div class="toolbar-right">
        <el-tag
          v-if="isRestricted"
          type="warning"
          size="small"
          effect="plain"
          style="margin-right: 8px"
        >
          游客模式：仅可新增，不可修改
        </el-tag>
        <el-tag
          v-else-if="!userStore.token"
          type="info"
          size="small"
          effect="plain"
          style="margin-right: 8px"
        >
          本地模式 (未登录)
        </el-tag>
        <el-tag
          v-if="statusMessage"
          :type="isError ? 'danger' : 'success'"
          size="small"
          effect="light"
        >
          {{ statusMessage }}
        </el-tag>
        <el-tag v-else type="info" size="small" effect="plain">✅ 就绪</el-tag>

        <el-tag
          :type="isConnected ? 'success' : 'info'"
          effect="dark"
          round
          size="small"
          style="margin-left: 8px"
        >
          {{ isConnected ? 'Online' : 'Offline' }}
        </el-tag>
        <!-- 只显示一组 room-info，根据是否房主切换内容 -->
        <span class="room-info" v-if="isOwner">ID: {{ boardId }}</span>
        <span class="room-info" v-else
          >Owner: {{ boardOwnerName || 'Unknown' }}</span
        >

        <!-- 游客禁用清空画布 -->
        <el-popconfirm title="确定要清空画布吗？" @confirm="$emit('clear')">
          <template #reference>
            <el-button
              type="danger"
              circle
              size="small"
              :disabled="isRestricted"
            >
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-popconfirm>

        <!-- 用户头像与下拉菜单 (已登录) -->
        <el-dropdown
          v-if="userStore.token"
          trigger="click"
          @command="handleUserCommand"
        >
          <div class="user-profile">
            <el-avatar :size="32" :style="{ backgroundColor: '#409eff' }">
              {{ userInitial }}
            </el-avatar>
            <span class="username">{{
              userStore.userInfo?.username || 'User'
            }}</span>
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="my-boards" :icon="List">
                我的画板
              </el-dropdown-item>
              <el-dropdown-item command="logout" :icon="SwitchButton">
                退出账户
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <!-- 登录按钮 (未登录) -->
        <el-button v-else type="primary" size="small" @click="handleLogin">
          登录
        </el-button>
      </div>
    </el-card>
    <!-- 历史画板列表弹窗 -->
    <el-dialog
      v-model="showHistoryDialog"
      title="我的画板"
      width="500px"
      align-center
    >
      <div v-loading="loadingHistory" class="history-list">
        <el-empty
          v-if="!historyList.length && !loadingHistory"
          description="暂无历史画板"
        />

        <div
          v-for="board in historyList"
          :key="board.id"
          class="history-item"
          @click="handleOpenBoard(board.id)"
        >
          <div class="history-info">
            <span class="history-id">ID: {{ board.id }}</span>
            <div class="history-meta">
              <span class="history-time"
                >更新时间：{{ formatDate(board.updated_at) }}</span
              >
              <span class="history-time"
                >创建时间：{{ formatDate(board.created_at) }}</span
              >
            </div>
          </div>
          <div
            class="history-actions"
            style="display: flex; align-items: center; gap: 8px"
          >
            <el-button
              type="danger"
              link
              :icon="Delete"
              @click.stop="handleDeleteBoard(board.id)"
            />
            <el-icon><ArrowRight /></el-icon>
          </div>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUserStore } from '../stores/userStore'
import { getUserBoards, deleteBoard } from '../api/board' // 引入 API
import {
  Pointer,
  EditPen,
  RefreshLeft,
  RefreshRight,
  ArrowDown,
  Upload,
  Refresh,
  Picture,
  Share,
  Delete,
  Plus,
  SwitchButton,
  List,
  ArrowRight,
  Setting,
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'

const props = defineProps({
  currentTool: String,
  canUndo: Boolean,
  canRedo: Boolean,
  isBusy: Boolean,
  isLoading: Boolean,
  isConnected: Boolean,
  statusMessage: String,
  isError: Boolean,
  boardId: String,
  isRestricted: Boolean,
  boardOwnerId: [Number, String],
  boardOwnerName: String,
  hasActiveObject: Boolean,
})

const emit = defineEmits([
  'set-tool',
  'undo',
  'redo',
  'add-shape',
  'save',
  'load',
  'download',
  'copy-link',
  'clear',
  'new-board',
  'open-sidebar',
])

const userStore = useUserStore()
const router = useRouter()
const route = useRoute()

const showHistoryDialog = ref(false)
const loadingHistory = ref(false)
const historyList = ref([])

// 获取用户名首字母用于头像显示
const userInitial = computed(() => {
  const name = userStore.userInfo?.username || 'U'
  return name.charAt(0).toUpperCase()
})

// 判断当前用户是否是房主
const isOwner = computed(() => {
  // 如果没有房主信息（比如本地新建未保存），或者是游客自己创建的本地画板，视为房主
  if (!props.boardOwnerId) return true
  // 如果已登录，比较 ID
  if (userStore.userInfo?.id) {
    return Number(userStore.userInfo.id) === Number(props.boardOwnerId)
  }
  // 游客模式下，如果是本地画板，视为房主 (isRestricted 为 false)
  // 但这里 props.boardOwnerId 只有从后端获取才有，本地画板通常没有 ownerId
  return false
})

const handleLogin = () => {
  // 跳转登录页，并带上当前页面的路径，以便登录后跳回
  router.push(`/login?redirect=${route.fullPath}`)
}

const handleUserCommand = (command) => {
  if (command === 'logout') {
    userStore.logout()
    ElMessage.success('已退出登录，切换为游客模式')
  } else if (command === 'my-boards') {
    // 打开历史记录弹窗
    showHistoryDialog.value = true
    fetchHistory()
  }
}

const fetchHistory = async () => {
  loadingHistory.value = true
  try {
    const res = await getUserBoards()
    if (res.data.code === 0) {
      historyList.value = res.data.data
    }
  } catch (err) {
    ElMessage.error('获取列表失败：' + (err.message || err))
  } finally {
    loadingHistory.value = false
  }
}

const handleDeleteBoard = (id) => {
  ElMessageBox.confirm('确定要删除这个画板吗？此操作无法撤销。', '警告', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning',
  })
    .then(async () => {
      try {
        const res = await deleteBoard(id)
        if (res.data.code === 0) {
          ElMessage.success('删除成功')
          // 刷新列表
          fetchHistory()
          // 如果删除的是当前画板，可能需要跳转或者提示
          if (id === props.boardId) {
            router.push(`/board/${Math.random().toString(36).slice(2, 8)}`)
          }
        } else {
          ElMessage.error(res.data.message || '删除失败')
        }
      } catch (err) {
        ElMessage.error('删除失败：' + (err.message || err))
      }
    })
    .catch(() => {
      // cancel
    })
}

const handleOpenBoard = (id) => {
  if (id === props.boardId) {
    showHistoryDialog.value = false
    return
  }
  // 跳转到对应画板
  router.push(`/board/${id}`)
  showHistoryDialog.value = false
  // 触发刷新逻辑 (因为路由参数变了，组件可能复用，需要通知父组件重新加载)
}

const formatDate = (isoString) => {
  if (!isoString) return ''
  return new Date(isoString).toLocaleString()
}

const handleSaveClick = () => {
  if (!userStore.token) {
    ElMessage.warning('游客模式无法保存，请先登录')
    // 跳转登录页
    router.push(`/login?redirect=${route.fullPath}`)
    return
  }
  emit('save')
}

const handleShareClick = () => {
  if (!userStore.token) {
    ElMessage.warning('游客模式无法分享，请先登录')
    // 跳转登录页
    router.push(`/login?redirect=${route.fullPath}`)
    return
  }
  emit('copy-link')
}
</script>

<style scoped>
.toolbar-wrapper {
  flex-shrink: 0;
  z-index: 10;
  /* 防止工具栏过宽撑破布局 */
  max-width: 100%;
}

.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.room-info {
  font-size: 12px;
  color: #909399;
  font-family: monospace;
  margin: 0 8px;
  white-space: nowrap;
}
/* --- 用户资料区域 --- */
.user-profile {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.user-profile:hover {
  background-color: #f5f7fa;
}

.username {
  margin-left: 8px;
  font-size: 14px;
  color: #606266;
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-list {
  max-height: 400px;
  overflow-y: auto;
}

.history-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px;
  border-bottom: 1px solid #f0f0f0;
  cursor: pointer;
  transition: background-color 0.2s;
}

.history-item:hover {
  background-color: #f5f7fa;
}

.history-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.history-id {
  font-weight: bold;
  color: #333;
}

.history-time {
  font-size: 12px;
  color: #999;
}
.history-meta {
  display: flex;
  gap: 16px; /* 两个时间之间的间距 */
  flex-wrap: wrap; /* 空间不足时自动换行 */
}

/* --- 移动端适配 --- */
@media (max-width: 768px) {
  /* 强制 Element Plus 卡片内容横向排列并支持滚动 */
  .toolbar-wrapper :deep(.el-card__body) {
    padding: 8px 4px !important;
    overflow-x: auto;
    justify-content: flex-start;
    -webkit-overflow-scrolling: touch; /* iOS 平滑滚动 */
    /* 隐藏滚动条但保留功能 */
    scrollbar-width: none;
    gap: 8px !important;
  }

  .toolbar-wrapper :deep(.el-card__body)::-webkit-scrollbar {
    display: none;
  }

  /* 隐藏不重要的信息以节省空间 */
  .room-info {
    display: none;
  }

  /* 调整右侧状态栏，允许被挤压 */
  .toolbar-right {
    margin-left: 8px;
    flex-shrink: 0;
  }

  /* 缩小按钮间距 */
  .el-button {
    padding: 8px !important;
    margin-left: 0 !important;
  }

  .el-button-group {
    flex-shrink: 0;
  }
  /* 移动端隐藏用户名，只显示头像 */
  .username {
    display: none;
  }

  .user-profile {
    padding: 0;
  }

  .user-profile .el-icon--right {
    display: none;
  }
}
</style>
