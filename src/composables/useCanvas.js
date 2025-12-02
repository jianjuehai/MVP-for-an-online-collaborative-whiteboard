import { ref, markRaw, onUnmounted } from 'vue'
import { fabric } from 'fabric'

// [全局补丁] 彻底解决 Canvas2D 性能警告
// 劫持 Fabric 内部创建 Canvas 的工具方法
// 这样无论是主画布、上层交互画布，还是对象内部的缓存画布，都会自动开启优化
const originalCreateCanvas = fabric.util.createCanvasElement
fabric.util.createCanvasElement = function () {
  const canvas = originalCreateCanvas.apply(this, arguments)
  canvas.getContext('2d', { willReadFrequently: true })
  return canvas
}

export function useCanvas() {
  const canvas = ref(null)
  const activeObject = ref(null)
  let isReceivingRemote = false
  let onEventCallback = null

  // 历史记录相关
  const historyStack = ref([])
  const redoStack = ref([])
  let isUndoRedoing = false
  const MAX_HISTORY = 50

  // [Day 11 新增] 橡皮擦待删除列表
  // 使用 Set 防止重复添加同一个物体
  const erasingCandidates = new Set()
  // 标记当前是否处于橡皮擦模式
  let isEraserMode = false
  // [新增] 标记鼠标是否按下
  let isMouseDown = false
  // [新增] 记录上一次鼠标位置，用于连线检测
  let lastPointer = null
  // [新增] 批量操作锁：防止批量删除时触发多次 saveHistory
  let isBatchOperation = false

  const generateId = () => {
    return 'obj_' + Math.random().toString(36).substring(2, 9)
  }

  const saveHistory = () => {
    if (!canvas.value || isUndoRedoing || isReceivingRemote) return
    const json = canvas.value.toJSON(['id'])
    if (historyStack.value.length >= MAX_HISTORY) {
      historyStack.value.shift()
    }
    historyStack.value.push(json)
    redoStack.value = []
  }

  const initCanvas = (canvasId) => {
    const canvasEl = document.getElementById(canvasId)
    // 手动获取 2d context 并开启 willReadFrequently 优化
    // 注意：这一步必须在 new fabric.Canvas 之前做
    if (canvasEl) {
      canvasEl.getContext('2d', { willReadFrequently: true })
    }
    //初始化时不定死宽高，而是自适应父容器
    const c = new fabric.Canvas(canvasId, {
      backgroundColor: '#ffffff',
      isDrawingMode: false,
      preserveObjectStacking: true,
    })

    fabric.Object.prototype.set({
      transparentCorners: false,
      cornerColor: '#ffffff',
      cornerStrokeColor: '#42b883',
      borderColor: '#42b883',
      cornerSize: 10,
      padding: 5,
    })

    canvas.value = markRaw(c)
    bindEvents(c)
    // [Day 12] 启动响应式监听
    window.addEventListener('resize', resizeCanvas)
    resizeCanvas() // 初始化执行一次
    saveHistory()
    return c
  }

  // [Day 12] 响应式调整画布大小
  const resizeCanvas = () => {
    if (!canvas.value) return
    const c = canvas.value
    // 获取父容器的大小（或者直接占满窗口）
    // 假设我们希望画布占据整个剩余屏幕，或者固定在某个 wrapper 里
    const wrapper = c.wrapperEl.parentNode
    c.setWidth(wrapper.clientWidth)
    c.setHeight(wrapper.clientHeight)
    c.renderAll()
  }

  const bindEvents = (c) => {
    const handleSelection = (e) => {
      const obj = e.selected ? e.selected[0] : null
      activeObject.value = obj ? markRaw(obj) : null
    }

    c.on('selection:created', handleSelection)
    c.on('selection:updated', handleSelection)
    c.on('selection:cleared', () => {
      activeObject.value = null
    })

    // --- [Day 11 重构] 橡皮擦逻辑：触碰变淡，松手删除 ---

    // 1. 鼠标按下：如果是橡皮擦模式，清空待删除列表
    c.on('mouse:down', (e) => {
      isMouseDown = true
      if (isEraserMode) {
        erasingCandidates.clear()
        // [新增] 记录起始点
        lastPointer = c.getPointer(e.e)
      }
    })
    // 鼠标松开
    c.on('mouse:up', () => {
      isMouseDown = false
      lastPointer = null // [新增] 重置
    })

    // 2. 鼠标移动：实时检测碰撞
    c.on('mouse:move', (e) => {
      if (!isEraserMode || !c.isDrawingMode || !isMouseDown) return

      const pointer = c.getPointer(e.e) // 当前点
      const objects = c.getObjects()

      // 如果没有上一次的位置，就用当前位置代替（相当于原地不动）
      const startPoint = lastPointer || pointer
      const endPoint = pointer

      // 构造鼠标移动的轨迹线段
      // 注意：这里只是逻辑上的线段，不需要真的画出来
      const mouseLine = {
        p1: new fabric.Point(startPoint.x, startPoint.y),
        p2: new fabric.Point(endPoint.x, endPoint.y),
      }

      for (let i = objects.length - 1; i >= 0; i--) {
        const obj = objects[i]
        if (erasingCandidates.has(obj)) continue

        // 方案 A: 包围盒检测
        const hitBox =
          obj.containsPoint(pointer) || obj.containsPoint(startPoint)

        // 方案 B: 连线相交检测
        const coords = obj.getCoords()
        const intersection = fabric.Intersection.intersectLinePolygon(
          mouseLine.p1,
          mouseLine.p2,
          coords,
        )
        const hitLine = intersection.status === 'Intersection'

        // 只要满足 A 或 B 任意一个
        if (hitBox || hitLine) {
          // 3. 终极方案：多点采样像素检测
          // 解决矛盾：
          // - 必须用像素检测 (isTargetTransparent) 才能防止交叉线误删。
          // - 必须在轨迹上多测几个点，才能防止快速移动时漏掉细线。

          // 计算鼠标移动距离
          const dist = Math.hypot(
            endPoint.x - startPoint.x,
            endPoint.y - startPoint.y,
          )
          // 设定采样步长：每 5px 测一次 (越小越精准，但性能开销大；5px 是个很好的平衡点)
          const stepSize = 5
          const steps = Math.max(1, Math.floor(dist / stepSize))

          let hasInk = false

          // 沿鼠标轨迹进行采样
          for (let j = 0; j <= steps; j++) {
            const t = j / steps
            // 线性插值计算采样点坐标
            const x = startPoint.x + (endPoint.x - startPoint.x) * t
            const y = startPoint.y + (endPoint.y - startPoint.y) * t

            // 只要有一个采样点不是透明的（碰到了墨水），就说明命中
            if (!c.isTargetTransparent(obj, x, y)) {
              hasInk = true
              break // 找到一个点就够了，不用测完
            }
          }

          // 如果整条轨迹都在透明区域（比如交叉线的空隙里），则跳过，不删除
          if (!hasInk) continue

          // 命中！
          obj.set('opacity', 0.3)
          obj.dirty = true
          erasingCandidates.add(obj)
          c.requestRenderAll()

          // ⚠️ 关键修复：删除了这里的 break
          // 允许一次鼠标移动删除多条重叠或相邻的线
        }
      }

      // [重要] 更新上一次的位置，为下一帧做准备
      lastPointer = pointer
    })

    // 3. 路径生成结束 (松开鼠标)：执行删除
    c.on('path:created', (e) => {
      const path = e.path

      // 如果是橡皮擦模式
      if (isEraserMode) {
        // --- 修复代码开始 ---

        // 1. 上锁：禁止中间过程触发 saveHistory
        isBatchOperation = true

        // A. 删除橡皮擦留下的那条红色轨迹
        // (这会触发 object:removed，但会被上面的锁拦截)
        c.remove(path)

        // B. 删除所有被标记的物体
        if (erasingCandidates.size > 0) {
          erasingCandidates.forEach((obj) => {
            // (这也会触发 object:removed，同样被拦截)
            c.remove(obj)
            // 通知服务器移除 (Socket 消息还是要发的)
            emitEvent('remove', { id: obj.id })
          })

          // 清空列表
          erasingCandidates.clear()
          c.requestRenderAll()

          // 2. 解锁
          isBatchOperation = false

          // 3. 手动保存一次最终状态
          saveHistory()
        } else {
          // 如果没删掉任何东西，也要记得解锁
          isBatchOperation = false
        }

        // --- 修复代码结束 ---
        return
      }

      // --- 普通画笔逻辑 ---
      path.set('id', generateId())
      const json = path.toJSON(['id'])
      emitEvent('add', json)
      saveHistory()
    })

    // 监听修改并通知外部 + 保存历史
    const handleAction = (action, e) => {
      if (isReceivingRemote || isBatchOperation) return
      if (!e.target) return

      const json = e.target.toJSON(['id'])
      emitEvent(action, json)
      saveHistory()
    }

    c.on('object:modified', (e) => handleAction('modify', e))

    c.on('object:added', (e) => {
      if (isReceivingRemote) return
      if (!e.target || !e.target.id) return
      handleAction('add', e)
    })

    c.on('object:removed', (e) => handleAction('remove', e))
  }

  // --- [Day 12] 辅助功能：重置视图 ---
  const resetZoom = () => {
    if (!canvas.value) return
    const c = canvas.value
    c.setViewportTransform([1, 0, 0, 1, 0, 0]) // 重置变换矩阵
    c.setZoom(1) // 重置缩放比例
  }

  const emitEvent = (action, data) => {
    if (onEventCallback) {
      onEventCallback({ action, data, objectId: data.id })
    }
  }

  // --- Undo / Redo ---
  const undo = () => {
    if (historyStack.value.length < 2 || !canvas.value) return
    isUndoRedoing = true
    const currentState = historyStack.value.pop()
    redoStack.value.push(currentState)
    const prevState = historyStack.value[historyStack.value.length - 1]
    canvas.value.loadFromJSON(prevState, () => {
      canvas.value.renderAll()
      isUndoRedoing = false
      if (onEventCallback) {
        onEventCallback({ action: 'refresh', data: prevState })
      }
    })
  }

  const redo = () => {
    if (redoStack.value.length === 0 || !canvas.value) return
    isUndoRedoing = true
    const nextState = redoStack.value.pop()
    historyStack.value.push(nextState)
    canvas.value.loadFromJSON(nextState, () => {
      canvas.value.renderAll()
      isUndoRedoing = false
      if (onEventCallback) {
        onEventCallback({ action: 'refresh', data: nextState })
      }
    })
  }

  const setEventCallback = (fn) => {
    onEventCallback = fn
  }

  const applyRemoteUpdate = (payload) => {
    if (!canvas.value) return
    const c = canvas.value
    const { action, data, objectId } = payload
    isReceivingRemote = true

    if (action === 'refresh') {
      c.loadFromJSON(data, () => {
        c.renderAll()
        isReceivingRemote = false
      })
      return
    }

    const findObjectById = (id) => c.getObjects().find((o) => o.id === id)

    try {
      if (action === 'add') {
        if (findObjectById(data.id)) {
          isReceivingRemote = false
          return
        }
        fabric.util.enlivenObjects([data], (enlivenedObjects) => {
          enlivenedObjects.forEach((obj) => c.add(obj))
          c.requestRenderAll()
          isReceivingRemote = false
        })
        return
      } else if (action === 'modify') {
        const obj = findObjectById(data.id)
        if (obj) {
          obj.set(data)
          obj.setCoords()
          c.requestRenderAll()
        }
      } else if (action === 'remove') {
        const targetId = objectId || data.id
        const obj = findObjectById(targetId)
        if (obj) {
          c.remove(obj)
          c.requestRenderAll()
        }
      }
    } catch (error) {
      console.error('[Sync Error]', error)
    } finally {
      if (action !== 'add') {
        isReceivingRemote = false
      }
    }
  }

  const addShape = (type, styles = {}) => {
    if (!canvas.value) return
    const c = canvas.value
    const vpt = c.viewportTransform
    const centerX = (c.getWidth() / 2 - vpt[4]) / vpt[0]
    const centerY = (c.getHeight() / 2 - vpt[5]) / vpt[3]

    const baseStyles = {
      left: centerX,
      top: centerY,
      originX: 'center',
      originY: 'center',
      id: generateId(),
      ...styles,
    }

    let shape
    if (type === 'rect') {
      shape = new fabric.Rect({ ...baseStyles, width: 100, height: 100 })
    } else if (type === 'circle') {
      shape = new fabric.Circle({ ...baseStyles, radius: 50 })
    } else if (type === 'triangle') {
      shape = new fabric.Triangle({ ...baseStyles, width: 100, height: 100 })
    }
    if (shape) {
      c.add(shape)
      c.setActiveObject(shape)
      c.requestRenderAll()
    }
  }

  // [Day 11 修改] 设置模式
  const setMode = (mode, brushColor = '#000000', brushWidth = 5) => {
    if (!canvas.value) return
    const c = canvas.value

    if (mode === 'pen') {
      isEraserMode = false // 标记：不是橡皮擦
      c.isDrawingMode = true
      c.freeDrawingBrush.width = brushWidth
      c.freeDrawingBrush.color = brushColor
      c.discardActiveObject()
    } else if (mode === 'eraser') {
      isEraserMode = true // 标记：是橡皮擦
      c.isDrawingMode = true
      c.freeDrawingBrush.width = 20 // 橡皮擦粗一点
      // 设置为半透明红色，让用户知道这是“删除轨迹”
      c.freeDrawingBrush.color = 'rgba(255, 0, 0, 0.3)'
      c.discardActiveObject()
    } else {
      isEraserMode = false
      c.isDrawingMode = false
    }
    c.requestRenderAll()
  }

  const deleteSelected = () => {
    if (!canvas.value) return
    const obj = canvas.value.getActiveObject()
    if (obj) {
      canvas.value.remove(obj)
      canvas.value.discardActiveObject()
      activeObject.value = null
      canvas.value.requestRenderAll()
    }
  }

  const clearCanvas = () => {
    if (!canvas.value) return
    canvas.value.clear()
    canvas.value.backgroundColor = '#ffffff'
    activeObject.value = null
  }

  const updateActiveObject = (key, value) => {
    const obj = canvas.value?.getActiveObject()
    if (obj) {
      obj.set(key, value)
      canvas.value.requestRenderAll()
      emitEvent('modify', obj.toJSON(['id']))
    }
  }

  const toJSON = () => {
    if (!canvas.value) return null
    return canvas.value.toJSON(['id'])
  }

  const loadFromJSON = (json) => {
    if (!canvas.value || !json) return
    canvas.value.loadFromJSON(json, () => {
      canvas.value.renderAll()
    })
  }

  const exportAsImage = () => {
    if (!canvas.value) return null
    return canvas.value.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: 2,
      enableRetinaScaling: true,
    })
  }

  onUnmounted(() => {
    window.removeEventListener('resize', resizeCanvas)
    if (canvas.value) canvas.value.dispose()
  })

  return {
    canvas,
    activeObject,
    initCanvas,
    addShape,
    setMode,
    deleteSelected,
    clearCanvas,
    updateActiveObject,
    toJSON,
    loadFromJSON,
    exportAsImage,
    setEventCallback,
    applyRemoteUpdate,
    undo,
    redo,
    historyStack,
    redoStack,
    resetZoom,
  }
}
