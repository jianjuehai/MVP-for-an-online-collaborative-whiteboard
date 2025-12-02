<template>
  <!-- 1. 分享设置对话框 -->
  <el-dialog
    :model-value="visibleShare"
    title="分享设置"
    width="400px"
    @update:model-value="$emit('update:visibleShare', $event)"
  >
    <el-form label-position="top">
      <el-form-item label="访问密码 (不填写则公开)">
        <el-input
          v-model="localShareForm.password"
          placeholder="设置访问密码"
          show-password
        />
      </el-form-item>
      <el-form-item label="有效期">
        <el-select v-model="localShareForm.expiresIn" placeholder="选择有效期">
          <el-option label="永久有效" :value="0" />
          <el-option label="1 小时" :value="1" />
          <el-option label="24 小时" :value="24" />
          <el-option label="7 天" :value="168" />
        </el-select>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="$emit('update:visibleShare', false)">取消</el-button>
      <el-button type="primary" @click="handleSave">保存并复制链接</el-button>
    </template>
  </el-dialog>

  <!-- 2. 密码输入对话框 (被动触发) -->
  <el-dialog
    :model-value="visiblePassword"
    title="加密白板"
    width="300px"
    :close-on-click-modal="false"
    :show-close="false"
    @update:model-value="$emit('update:visiblePassword', $event)"
  >
    <p>此白板受密码保护，请输入密码：</p>
    <el-input
      v-model="localInputPassword"
      type="password"
      placeholder="请输入密码"
      :class="{ 'is-error': passwordError }"
      @keyup.enter="handleVerify"
      @input="$emit('update:passwordError', '')"
    />

    <!-- 错误提示 -->
    <div v-if="passwordError" class="error-msg">{{ passwordError }}</div>

    <template #footer>
      <el-button type="primary" @click="handleVerify">确定</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({
  visibleShare: Boolean,
  visiblePassword: Boolean,
  passwordError: String,
})

const emit = defineEmits([
  'update:visibleShare',
  'update:visiblePassword',
  'update:passwordError',
  'save-settings',
  'verify-password',
])

// 本地状态
const localShareForm = ref({
  password: '',
  expiresIn: 0,
})
const localInputPassword = ref('')

// 处理保存
const handleSave = () => {
  emit('save-settings', localShareForm.value)
}

// 处理验证
const handleVerify = () => {
  emit('verify-password', localInputPassword.value)
}

// 当密码弹窗关闭时，清空输入框和错误信息
watch(
  () => props.visiblePassword,
  (val) => {
    if (!val) {
      localInputPassword.value = ''
      emit('update:passwordError', '') // 关闭时清除错误
    }
  },
)
</script>
<style scoped>
/* 错误提示样式 */
.error-msg {
  color: #f56c6c;
  font-size: 12px;
  margin-top: 6px;
  line-height: 1;
}

/* 让输入框变红 (配合 Element Plus 样式) */
:deep(.el-input.is-error .el-input__wrapper) {
  box-shadow: 0 0 0 1px #f56c6c inset;
}
</style>
