import axios from 'axios'

// 更新分享设置
export const updateShareSettings = async (boardId, settings) => {
  const res = await fetch(`${API_BASE}/board/${boardId}/share`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  return await res.json()
}

// 动态构建后端地址：使用当前访问的 IP，但端口改成 3000
const getBaseUrl = () => {
  if (import.meta.env.PROD) return '/api'
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:3000/api`
}

const API_BASE = getBaseUrl()

export const saveBoard = async (boardId, data) => {
  return axios.post(`${API_BASE}/board/${boardId}`, data)
}

// 支持传入密码
export const getBoard = async (boardId, password = '') => {
  const url = password
    ? `${API_BASE}/board/${boardId}?password=${encodeURIComponent(password)}`
    : `${API_BASE}/board/${boardId}`

  const res = await fetch(url)
  return await res.json()
}
