import { defineStore } from 'pinia'
import { ref } from 'vue'
import { login as loginApi, register as registerApi } from '../api/auth'

export const useUserStore = defineStore('user', () => {
  // 从 localStorage 初始化，防止刷新丢失登录状态
  const token = ref(localStorage.getItem('token') || '')
  const userInfo = ref(JSON.parse(localStorage.getItem('userInfo') || 'null'))

  const login = async (form) => {
    const res = await loginApi(form)
    if (res.data.code === 0) {
      const { token: newToken, ...user } = res.data.data
      token.value = newToken
      userInfo.value = user

      // 持久化
      localStorage.setItem('token', newToken)
      localStorage.setItem('userInfo', JSON.stringify(user))
      return true
    }
    return false
  }

  const register = async (form) => {
    const res = await registerApi(form)
    return res.data.code === 0
  }

  const logout = () => {
    token.value = ''
    userInfo.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('userInfo')
  }

  return { token, userInfo, login, register, logout }
})
