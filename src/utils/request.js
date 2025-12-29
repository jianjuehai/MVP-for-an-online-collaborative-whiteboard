import axios from 'axios'
import { ElMessage } from 'element-plus'
import { useUserStore } from '../stores/userStore' // 引入 store
import router from '../router'

// 动态构建后端地址
const getBaseUrl = () => {
  if (import.meta.env.PROD) return '/api'
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:3000/api`
}

// 创建 axios 实例
const service = axios.create({
  baseURL: getBaseUrl(),
  timeout: 10000, // 请求超时时间
  headers: {
    'Content-Type': 'application/json',
  },
})

// 请求拦截器
service.interceptors.request.use(
  (config) => {
    const userStore = useUserStore()
    if (userStore.token) {
      config.headers['Authorization'] = `Bearer ${userStore.token}`
    }
    return config
  },
  (error) => {
    // 对请求错误做些什么
    console.error('Request Error:', error)
    return Promise.reject(error)
  },
)

// 响应拦截器
service.interceptors.response.use(
  (response) => {
    // 对响应数据做点什么
    // 这里可以根据后端返回的状态码统一处理
    // 假设后端返回格式为 { code: 0, data: ..., message: ... }
    // const res = response.data

    // 如果需要统一解包，可以直接返回 res
    // 或者返回 response，由调用方处理
    return response
  },
  (error) => {
    // 对响应错误做点什么
    console.error('Response Error:', error)

    // 统一错误提示
    let message = '请求失败'
    if (error.response) {
      switch (error.response.status) {
        case 400:
          message = '请求参数错误'
          break
        case 401:
          message = '未授权，请登录'
          break
        case 403:
          message = '拒绝访问'
          break
        case 404:
          message = '请求地址出错'
          break
        case 500:
          message = '服务器内部错误'
          break
        default:
          message = `连接错误 ${error.response.status}`
      }
    } else if (error.message.includes('timeout')) {
      message = '请求超时'
    } else if (error.message.includes('Network Error')) {
      message = '网络连接错误'
    }

    ElMessage.error(message)
    // 处理 Token 过期
    if (error.response && error.response.status === 401) {
      const userStore = useUserStore()
      userStore.logout()
      router.push('/login')
      ElMessage.error('登录已过期，请重新登录')
    }
    return Promise.reject(error)
  },
)

export default service
