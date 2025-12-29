<template>
  <div class="auth-container">
    <div class="auth-card">
      <h2>{{ isLogin ? '登录' : '注册' }}</h2>
      <p class="subtitle">在线协作白板 MVP Demo</p>
      <!-- 登录表单 -->
      <el-form
        :model="form"
        :rules="rules"
        ref="formtable"
        label-position="top"
        size="large"
        v-if="isLogin"
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            :prefix-icon="User"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :prefix-icon="Lock"
            placeholder="请输入密码"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-button
          type="primary"
          class="submit-btn"
          :loading="loading"
          @click="handleSubmit"
        >
          登录
        </el-button>
      </el-form>
      <!-- 注册表单 -->
      <el-form
        :model="form"
        :rules="rules"
        ref="formtable"
        label-position="top"
        size="large"
        v-else
      >
        <el-form-item prop="username">
          <el-input
            v-model="form.username"
            placeholder="请输入用户名"
            :prefix-icon="User"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :prefix-icon="Lock"
            placeholder="请输入密码"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>
        <el-form-item prop="repassword">
          <el-input
            v-model="form.repassword"
            type="password"
            :prefix-icon="Lock"
            placeholder="请再次输入密码"
            @keyup.enter="handleSubmit"
          />
        </el-form-item>

        <el-button
          type="primary"
          class="submit-btn"
          :loading="loading"
          @click="handleSubmit"
        >
          注册
        </el-button>
      </el-form>

      <div class="footer-links">
        <span v-if="isLogin">
          还没有账号？ <router-link to="/register">去注册</router-link>
        </span>
        <span v-else>
          已有账号？ <router-link to="/login">去登录</router-link>
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '../stores/userStore'
import { ElMessage } from 'element-plus'
import { Lock, User } from '@element-plus/icons-vue'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()

const loading = ref(false)
const formtable = ref(null)
//用于提交的数据
const form = reactive({
  username: '',
  password: '',
  repassword: '',
})
// 表单验证规则
const rules = {
  username: [
    { required: true, message: '请输入用户名', trigger: 'blur' },
    {
      min: 3,
      max: 20,
      message: '用户名长度在3到20个字符之间',
      trigger: 'blur',
    },
  ],
  password: [
    { required: true, message: '请输入密码', trigger: 'blur' },
    {
      pattern: /^\S{6,20}$/,
      message: '密码必须是 6到20位 非空字符',
      trigger: 'blur',
    },
  ],
  repassword: [
    { required: true, message: '请再次输入密码', trigger: 'blur' },
    {
      validator: (rule, value, callback) => {
        if (value !== form.password) {
          callback(new Error('两次输入的密码不一致'))
        } else {
          callback()
        }
      },
      trigger: 'blur',
    },
  ],
}

// 根据路由判断当前模式
const isLogin = computed(() => route.path === '/login')

watch(isLogin, () => {
  // 切换模式时重置表单
  form.username = ''
  form.password = ''
  form.repassword = ''
})

const handleSubmit = async () => {
  await formtable.value.validate()

  loading.value = true
  try {
    if (isLogin.value) {
      // 登录逻辑
      const success = await userStore.login(form)
      if (success) {
        ElMessage.success('登录成功')
        // 跳转回之前的页面，或者创建白板
        const redirect = route.query.redirect
        if (redirect) {
          router.push(redirect)
        } else {
          // 如果没有重定向，则生成随机 ID 进入新白板
          const newId = Math.random().toString(36).substring(2, 8)
          router.push(`/board/${newId}`)
        }
      } else {
        ElMessage.error('登录失败，请检查用户名或密码')
      }
    } else {
      // 注册逻辑
      const success = await userStore.register(form)
      if (success) {
        ElMessage.success('注册成功，请登录')
        router.push('/login')
      } else {
        ElMessage.error('注册失败，用户名可能已存在')
      }
    }
  } catch (err) {
    console.error(err)
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.auth-container {
  height: 100vh;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #f0f2f5;
  background-image: radial-gradient(#e1e1e1 1px, transparent 1px);
  background-size: 20px 20px;
}

.auth-card {
  width: 100%;
  max-width: 400px;
  padding: 40px;
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

h2 {
  text-align: center;
  margin-bottom: 10px;
  color: #333;
}

.subtitle {
  text-align: center;
  color: #666;
  margin-bottom: 30px;
  font-size: 14px;
}

.submit-btn {
  width: 100%;
  margin-top: 20px;
}

.footer-links {
  margin-top: 20px;
  text-align: center;
  font-size: 14px;
}

.footer-links a {
  color: #409eff;
  text-decoration: none;
}
</style>
