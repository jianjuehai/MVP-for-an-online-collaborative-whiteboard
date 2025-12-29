import request from '@/utils/request'

// 更新分享设置
export const updateShareSettings = async (boardId, settings) => {
  const res = await request.post(`/board/${boardId}/share`, settings)
  return res.data
}

export const saveBoard = async (boardId, data) => {
  return request.post(`/board/${boardId}`, data)
}

// 支持传入密码
export const getBoard = async (boardId, password = '') => {
  const res = await request.get(`/board/${boardId}`, {
    params: { password },
  })
  return res.data
}

// 获取我的白板列表
export const getUserBoards = () => {
  return request.get('/user/boards')
}

// 删除白板
export const deleteBoard = (boardId) => {
  return request.delete(`/board/${boardId}`)
}
// 单独验证密码，不下载数据
// export const verifyPassword = async (boardId, password) => {
//   const res = await request.post(`/board/${boardId}/verify`, {
//     password,
//   })
//   return res.data
// }
