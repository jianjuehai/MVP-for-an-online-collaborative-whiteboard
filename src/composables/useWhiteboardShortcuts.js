// 键盘快捷键处理函数
export function createHandleKeydown({
  undo,
  redo,
  deleteSelected,
  handleSetTool,
}) {
  return function (e) {
    const target = e.target
    if (
      ['INPUT', 'TEXTAREA'].includes(target.tagName) ||
      target.isContentEditable
    )
      return
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault()
      undo()
      return
    }
    if (
      (e.ctrlKey || e.metaKey) &&
      (e.key === 'y' || (e.shiftKey && e.key === 'Z'))
    ) {
      e.preventDefault()
      redo()
      return
    }
    if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected()
    if (e.key.toLowerCase() === 'v') handleSetTool('select')
    if (e.key.toLowerCase() === 'p') handleSetTool('pen')
  }
}
