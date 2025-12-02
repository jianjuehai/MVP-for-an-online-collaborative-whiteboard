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
        <el-tooltip content="选择模式 (V)" placement="bottom" :hide-after="0">
          <el-button
            :type="currentTool === 'select' ? 'primary' : 'default'"
            @click="$emit('set-tool', 'select')"
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

        <el-tooltip content="橡皮擦" placement="bottom" :hide-after="0">
          <el-button
            :type="currentTool === 'eraser' ? 'primary' : 'default'"
            @click="$emit('set-tool', 'eraser')"
          >
            🧽
          </el-button>
        </el-tooltip>
      </el-button-group>
      <el-divider direction="vertical" />

      <!-- 工具组 2: 撤销重做 -->
      <el-button-group>
        <el-tooltip content="撤销 (Ctrl+Z)" placement="bottom" :hide-after="0">
          <el-button @click="$emit('undo')" :disabled="!canUndo">
            <el-icon><RefreshLeft /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="重做 (Ctrl+Y)" placement="bottom" :hide-after="0">
          <el-button @click="$emit('redo')" :disabled="!canRedo">
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

      <!-- 工具组 4: 保存与操作 -->
      <el-button-group>
        <el-tooltip content="新建白板" placement="bottom" :hide-after="0">
          <el-button @click="$emit('new-board')">
            <el-icon><Plus /></el-icon>
          </el-button>
        </el-tooltip>
        <el-tooltip content="保存到云端" placement="bottom" :hide-after="0">
          <el-button @click="$emit('save')" :loading="isBusy">
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
      <el-button
        type="success"
        plain
        @click="$emit('copy-link')"
        style="margin-left: 8px"
      >
        <el-icon style="margin-right: 4px"><Share /></el-icon> 分享
      </el-button>

      <!-- 状态展示区 (右侧) -->
      <div class="toolbar-right">
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

        <span class="room-info">ID: {{ boardId }}</span>

        <el-popconfirm title="确定要清空画布吗？" @confirm="$emit('clear')">
          <template #reference>
            <el-button type="danger" circle size="small">
              <el-icon><Delete /></el-icon>
            </el-button>
          </template>
        </el-popconfirm>
      </div>
    </el-card>
  </div>
</template>

<script setup>
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
} from '@element-plus/icons-vue'

defineProps({
  currentTool: String,
  canUndo: Boolean,
  canRedo: Boolean,
  isBusy: Boolean, // saving or loading
  isLoading: Boolean,
  isConnected: Boolean,
  statusMessage: String,
  isError: Boolean,
  boardId: String,
})

defineEmits([
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
])
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
}
</style>
