<template>
  <div class="sidebar-container" :class="{ open: isOpen }">
    <!-- 遮罩层 (点击关闭) -->
    <div class="sidebar-overlay" @click="$emit('close')" v-if="isOpen"></div>

    <div class="sidebar" v-if="activeObject">
      <!-- 移动端顶部拖拽条/标题栏 -->
      <div class="sidebar-header">
        <div class="drag-handle"></div>
        <span class="sidebar-title">属性设置</span>
        <span class="close-btn" @click="$emit('close')">×</span>
      </div>

      <el-form label-position="top" size="small" class="sidebar-content">
        <el-form-item label="ID">
          <el-input :value="activeObject.id" disabled />
        </el-form-item>

        <div class="form-row">
          <el-form-item label="填充颜色" v-if="supportsFill">
            <el-color-picker
              :model-value="attributes.fill"
              :disabled="isLocked"
              @active-change="handleInputStart"
              @change="
                (val) => {
                  $emit('update-attribute', 'fill', val)
                  handleInputEnd()
                }
              "
              show-alpha
            />
          </el-form-item>

          <el-form-item :label="strokeLabel">
            <el-color-picker
              :model-value="attributes.stroke"
              :disabled="isLocked"
              @active-change="handleInputStart"
              @change="
                (val) => {
                  $emit('update-attribute', 'stroke', val)
                  handleInputEnd()
                }
              "
              show-alpha
            />
          </el-form-item>
        </div>

        <el-form-item label="线宽">
          <el-slider
            :model-value="attributes.strokeWidth"
            :min="2"
            :max="20"
            :disabled="isLocked"
            @input="
              (val) => {
                handleInputStart()
                $emit('update-attribute', 'strokeWidth', val)
              }
            "
            @change="handleInputEnd"
          />
        </el-form-item>
      </el-form>

      <div class="sidebar-footer">
        <el-button
          type="danger"
          plain
          style="width: 100%"
          :disabled="isLocked"
          @click="$emit('delete')"
        >
          删除选中物体
        </el-button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  isOpen: Boolean,
  activeObject: Object,
  attributes: Object,
  isLocked: Boolean,
})

const emit = defineEmits([
  'update-attribute',
  'delete',
  'close',
  'focus-attribute',
  'blur-attribute',
])

const isEditing = ref(false)

const handleInputStart = () => {
  if (!isEditing.value) {
    isEditing.value = true
    emit('focus-attribute')
  }
}

const handleInputEnd = () => {
  if (isEditing.value) {
    isEditing.value = false
    emit('blur-attribute')
  }
}

// 线条不支持填充；形状支持
const supportsFill = computed(() => {
  const obj = props.activeObject
  if (!obj) return false
  const t = obj.type
  // 将线条和自由绘制路径视为仅描边
  if (t === 'line' || t === 'path') return false
  // 典型支持填充的类型
  return [
    'rect',
    'circle',
    'triangle',
    'polygon',
    'ellipse',
    'textbox',
    'i-text',
  ].includes(t)
})

// 动态切换边框颜色标签
const strokeLabel = computed(() => {
  const obj = props.activeObject
  if (!obj) return '边框颜色'
  const t = obj.type
  return t === 'line' || t === 'path' ? '线条颜色' : '边框颜色'
})
</script>

<style scoped>
.sidebar-container {
  position: absolute;
  inset: 0; /* 占满全屏，为了放遮罩层 */
  z-index: 100;
  pointer-events: none; /* 默认不阻挡点击 */
  overflow: hidden;
}

.sidebar-container.open {
  pointer-events: auto;
}

/* 遮罩层 */
.sidebar-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  opacity: 0;
  transition: opacity 0.3s;
}

.sidebar-container.open .sidebar-overlay {
  opacity: 1;
}

/* 侧边栏主体 */
.sidebar {
  position: absolute;
  background: rgba(255, 255, 255, 0.98);
  backdrop-filter: blur(10px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 0 20px rgba(0, 0, 0, 0.15);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

/* 桌面端样式 (默认) */
@media (min-width: 769px) {
  .sidebar {
    top: 0;
    right: 0;
    bottom: 0;
    width: 280px;
    transform: translateX(100%);
    border-left: 1px solid #e0e0e0;
  }

  .sidebar-container.open .sidebar {
    transform: translateX(0);
  }

  .sidebar-header {
    display: none; /* 桌面端不需要标题栏 */
  }

  .sidebar-content {
    padding: 20px;
    flex: 1;
    overflow-y: auto;
  }

  .sidebar-footer {
    padding: 20px;
    border-top: 1px solid #eee;
  }
}

/* 移动端样式 */
@media (max-width: 768px) {
  .sidebar {
    left: 0;
    right: 0;
    bottom: 0;
    height: auto;
    max-height: 80vh; /* 最多占屏幕 80% */
    border-radius: 16px 16px 0 0;
    transform: translateY(100%);
    padding-bottom: env(safe-area-inset-bottom); /* 适配 iPhone 底部横条 */
  }

  .sidebar-container.open .sidebar {
    transform: translateY(0);
  }

  .sidebar-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid #f0f0f0;
    position: relative;
  }

  .drag-handle {
    position: absolute;
    top: 6px;
    left: 50%;
    transform: translateX(-50%);
    width: 36px;
    height: 4px;
    background-color: #e0e0e0;
    border-radius: 2px;
  }

  .sidebar-title {
    font-weight: 600;
    font-size: 16px;
    margin-top: 8px;
  }

  .close-btn {
    font-size: 24px;
    color: #999;
    cursor: pointer;
    line-height: 1;
    margin-top: 4px;
  }

  .sidebar-content {
    padding: 16px;
    overflow-y: auto;
  }

  .form-row {
    display: flex;
    gap: 16px;
  }

  .form-row .el-form-item {
    flex: 1;
    margin-bottom: 0;
  }

  .sidebar-footer {
    padding: 16px;
    background: white;
    border-top: 1px solid #f5f5f5;
  }
}
</style>
