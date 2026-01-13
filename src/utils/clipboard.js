// 保存分享设置的回调
export async function copyToClipboard(text) {
  // 1. 优先尝试标准 API (需要 HTTPS 或 localhost)
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }

  // 2. 降级方案：使用传统的 document.execCommand (兼容 HTTP)
  // 创建一个隐藏的输入框来选中文本
  const textArea = document.createElement('textarea')
  textArea.value = text

  // 防止在移动端唤起键盘
  textArea.style.position = 'fixed'
  textArea.style.left = '-9999px'
  textArea.setAttribute('readonly', '')

  document.body.appendChild(textArea)
  textArea.focus()
  textArea.select()

  try {
    const successful = document.execCommand('copy')
    if (!successful) throw new Error('Copy failed')
  } catch (err) {
    throw new Error('浏览器不支持自动复制，' + err)
  } finally {
    document.body.removeChild(textArea)
  }
}
