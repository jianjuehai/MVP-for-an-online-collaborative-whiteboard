import axios from 'axios'

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

export const getBoard = async (boardId) => {
  return axios.get(`${API_BASE}/board/${boardId}`)
}
