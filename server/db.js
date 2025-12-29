const mysql = require('mysql2/promise')

// 创建连接池
const pool = mysql.createPool({
  host: 'localhost',
  user: 'root', // 替换为你的 MySQL 用户名
  password: '201029zmc', // 替换为你的 MySQL 密码
  database: 'whiteboard_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
})

// 封装通用查询方法
async function query(sql, params) {
  const [rows] = await pool.execute(sql, params)
  return rows
}

module.exports = { query }
