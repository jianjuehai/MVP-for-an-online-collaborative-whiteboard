import { ref, markRaw, onUnmounted, watch } from 'vue'
import { fabric } from 'fabric'
import { useSocket } from './useSocket'
import { useBoardStore } from '../stores/boardStore'
import { quadtree } from 'd3-quadtree'

// 解决 Canvas2D 性能警告
// 劫持 Fabric 内部创建 Canvas 的工具方法
// 这样无论是主画布、上层交互画布，还是对象内部的缓存画布，都会自动开启优化
const originalCreateCanvas = fabric.util.createCanvasElement
fabric.util.createCanvasElement = function () {
  const canvas = originalCreateCanvas.apply(this, arguments)
  canvas.getContext('2d', { willReadFrequently: true })
  return canvas
}

// 节流函数工具
function throttle(func, limit) {
  let inThrottle
  return function () {
    const args = arguments
    const context = this
    if (!inThrottle) {
      func.apply(context, args)
      inThrottle = true
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

export function useCanvas() {
  const canvas = ref(null)
  const activeObject = ref(null)
  const { remoteLocks, requestLock, releaseLock } = useSocket()
  const store = useBoardStore()
  let isReceivingRemote = false
  let onEventCallback = null
  // 错误/提示回调
  let onErrorCallback = null

  // 历史记录相关
  const historyStack = ref([])
  const redoStack = ref([])
  let isUndoRedoing = false
  const MAX_HISTORY = 50
  // 记录修改前的状态 (用于 modify 操作的撤销)
  let modifyStartJSON = null

  // 橡皮擦待删除列表
  // 使用 Set 防止重复添加同一个物体
  const erasingCandidates = new Set()
  // 标记当前是否处于橡皮擦模式
  let isEraserMode = false
  // 标记鼠标是否按下
  let isMouseDown = false
  // 记录上一次鼠标位置，用于连线检测
  let lastPointer = null
  // 批量操作锁：防止批量删除时触发多次 saveHistory
  let isBatchOperation = false

  // 实时绘图相关状态
  const remoteDrawingPaths = {} // 存储其他用户正在绘制的临时路径
  let currentDrawId = null // 当前用户正在绘制的路径ID

  // 四叉树优化
  let objectQuadtree = null
  let maxObjectRadius = 0

  const generateId = () => {
    return 'obj_' + Math.random().toString(36).substring(2, 9)
  }

  // 添加命令，用于undo/redo
  const addCommand = (cmd) => {
    // 如果正在接收远程同步，或者正在执行撤销重做，不记录历史
    if (isReceivingRemote || isUndoRedoing) return

    if (historyStack.value.length >= MAX_HISTORY) {
      historyStack.value.shift()
    }
    historyStack.value.push(cmd)
    redoStack.value = [] // 新操作清空重做栈
  }

  const initCanvas = (canvasId) => {
    const canvasEl = document.getElementById(canvasId)
    // 手动获取 2d context 并开启 willReadFrequently 优化
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
    // 启动响应式监听
    window.addEventListener('resize', resizeCanvas)
    resizeCanvas() // 初始化执行一次
    // 记录初始状态到撤销栈
    if (!isReceivingRemote && !isUndoRedoing) {
      addCommand({ type: 'init', data: c.toJSON(['id']) })
    }
    return c
  }

  // 监听远程锁状态变化，更新画布对象状态
  watch(
    remoteLocks,
    (locks) => {
      if (!canvas.value) return
      const c = canvas.value
      c.getObjects().forEach((obj) => {
        if (locks[obj.id]) {
          // 被别人锁住了
          obj.set({
            lockMovementX: true,
            lockMovementY: true,
            lockRotation: true,
            lockScalingX: true,
            lockScalingY: true,
            borderColor: 'red',
            cornerColor: 'red',
            cornerStrokeColor: 'red',
            hasControls: false, // 隐藏控制点
          })
        } else {
          // 解锁 (恢复默认)
          obj.set({
            lockMovementX: false,
            lockMovementY: false,
            lockRotation: false,
            lockScalingX: false,
            lockScalingY: false,
            borderColor: '#42b883',
            cornerColor: '#ffffff',
            cornerStrokeColor: '#42b883',
            hasControls: true,
          })
        }
      })
      c.requestRenderAll()
    },
    { deep: true },
  )

  // 响应式调整画布大小
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

    // --- 实时移动同步 (节流) ---
    // 监听物体移动、缩放、旋转过程中的变化
    // 使用 throttle 限制发送频率，减少网络压力
    const handleRealtimeModify = throttle((e) => {
      // 如果正在接收远程更新，或者是橡皮擦操作，不发送
      if (isReceivingRemote || isBatchOperation) return
      const target = e.target
      if (!target) return

      // 发送 'moving' 事件，包含当前物体的状态
      // 注意：这里我们不保存历史记录，只为了视觉同步
      emitEvent('moving', target.toJSON(['id']))
    }, 30) // 约 30fps

    c.on('object:moving', handleRealtimeModify)
    c.on('object:scaling', handleRealtimeModify)
    c.on('object:rotating', handleRealtimeModify)

    // --- 橡皮擦逻辑：触碰变淡，松手删除 ---

    // 1. 鼠标按下：如果是橡皮擦模式，清空待删除列表
    c.on('mouse:down', (e) => {
      isMouseDown = true

      // --- 锁机制 ---
      if (e.target && !isEraserMode && !c.isDrawingMode) {
        // 如果对象没有被远程锁定，尝试获取锁
        if (!remoteLocks.value[e.target.id]) {
          requestLock(store.boardId, e.target.id)
        }
      }

      // 记录起始点
      const pointer = c.getPointer(e.e)

      // 如果点击了物体，记录当前状态作为 "before" 状态
      if (e.target && !isEraserMode && !c.isDrawingMode) {
        modifyStartJSON = e.target.toJSON(['id'])
      }

      if (isEraserMode) {
        erasingCandidates.clear()
        lastPointer = pointer
        // --- 构建四叉树 ---
        const objects = c.getObjects()
        maxObjectRadius = 0
        const data = objects.map((obj) => {
          const center = obj.getCenterPoint()
          // 计算物体最大半径 (包围盒对角线的一半)
          const br = obj.getBoundingRect()
          const radius = Math.hypot(br.width, br.height) / 2
          if (radius > maxObjectRadius) maxObjectRadius = radius
          return {
            x: center.x,
            y: center.y,
            obj: obj,
          }
        })

        objectQuadtree = quadtree()
          .x((d) => d.x)
          .y((d) => d.y)
          .addAll(data)
      } else if (c.isDrawingMode) {
        // --- 实时画笔：开始绘制 ---
        currentDrawId = generateId()
        // 发送绘制开始信号
        emitEvent('drawing', {
          id: currentDrawId,
          status: 'start',
          x: pointer.x,
          y: pointer.y,
          width: c.freeDrawingBrush.width,
          color: c.freeDrawingBrush.color,
        })
      }
    })
    // 鼠标松开
    c.on('mouse:up', (e) => {
      isMouseDown = false

      // --- 锁机制 ---
      if (e.target) {
        releaseLock(store.boardId, e.target.id)
      }

      lastPointer = null // 重置
      objectQuadtree = null // 释放内存
      // --- 实时画笔：结束绘制 ---
      if (currentDrawId) {
        // 发送结束信号 (接收端会移除临时轨迹，等待 path:created 的最终结果)
        emitEvent('drawing', { id: currentDrawId, status: 'end' })
        currentDrawId = null
      }
    })

    // 定义画笔移动的节流函数
    const handleRealtimeDrawMove = throttle((pointer) => {
      if (currentDrawId) {
        emitEvent('drawing', {
          id: currentDrawId,
          status: 'move',
          x: pointer.x,
          y: pointer.y,
        })
      }
    }, 30)

    // 2. 鼠标移动：实时检测碰撞
    c.on('mouse:move', (e) => {
      // 必须是按下状态
      if (!isMouseDown) return

      const pointer = c.getPointer(e.e)

      if (isEraserMode && c.isDrawingMode) {
        // 如果没有上一次的位置，就用当前位置代替（相当于原地不动）
        const startPoint = lastPointer || pointer
        const endPoint = pointer

        // 构造鼠标移动的轨迹线段
        // 注意：这里只是逻辑上的线段，不需要真的画出来
        const mouseLine = {
          p1: new fabric.Point(startPoint.x, startPoint.y),
          p2: new fabric.Point(endPoint.x, endPoint.y),
        }

        // --- 四叉树区域搜索 ---
        // 1. 计算搜索包围盒 (鼠标轨迹 + 橡皮擦半径 + 物体最大半径)
        const eraserRadius = c.freeDrawingBrush.width / 2
        const searchPadding = eraserRadius + maxObjectRadius
        const minX = Math.min(startPoint.x, endPoint.x) - searchPadding
        const minY = Math.min(startPoint.y, endPoint.y) - searchPadding
        const maxX = Math.max(startPoint.x, endPoint.x) + searchPadding
        const maxY = Math.max(startPoint.y, endPoint.y) + searchPadding

        const candidates = []
        if (objectQuadtree) {
          objectQuadtree.visit((node, x1, y1, x2, y2) => {
            if (!node.length) {
              do {
                const d = node.data
                // 检查点 d 是否在搜索范围内
                if (d.x >= minX && d.x < maxX && d.y >= minY && d.y < maxY) {
                  candidates.push(d.obj)
                }
              } while ((node = node.next))
            }
            // 如果当前四叉树节点范围与搜索范围不相交，停止遍历该分支
            return x1 >= maxX || y1 >= maxY || x2 < minX || y2 < minY
          })
        }

        // 遍历候选物体 (数量远小于 objects.length)
        for (let i = candidates.length - 1; i >= 0; i--) {
          const obj = candidates[i]
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
            // 多点采样像素检测
            // 解决矛盾：
            // - 必须用像素检测才能防止误删。
            // - 必须在轨迹上多测几个点，才能防止快速移动时漏掉细线。

            // 计算鼠标移动距离
            const dist = Math.hypot(
              endPoint.x - startPoint.x,
              endPoint.y - startPoint.y,
            )
            // 设定采样步长：每 5px 测一次 (越小越精准，但性能开销大；5px 是个很好的平衡点)
            const stepSize = 4
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

            // 允许一次鼠标移动删除多条重叠或相邻的线
          }
        }

        // 更新上一次的位置，为下一帧做准备
        lastPointer = pointer
      } else if (c.isDrawingMode && !isEraserMode && currentDrawId) {
        // --- 实时画笔：移动 ---
        handleRealtimeDrawMove(pointer)
        // 更新 lastPointer 供可能的逻辑使用
        lastPointer = pointer
      }
    })

    // 3. 路径生成结束 (松开鼠标)：执行删除
    c.on('path:created', (e) => {
      const path = e.path

      // 如果是橡皮擦模式
      if (isEraserMode) {
        // 1. 上锁：禁止中间过程触发 saveHistory
        isBatchOperation = true

        // A. 删除橡皮擦留下的那条红色轨迹
        // (这会触发 object:removed，但会被上面的锁拦截)
        c.remove(path)

        // B. 删除所有被标记的物体
        if (erasingCandidates.size > 0) {
          // 橡皮擦批量删除记录历史 (一次性记录)
          const removedData = []
          erasingCandidates.forEach((obj) => {
            obj.set('opacity', 1)
            obj.dirty = true
            removedData.push(obj.toJSON(['id'])) // 记录被删对象详情
            // (这也会触发 object:removed，同样被拦截)
            c.remove(obj)
            // 通知服务器移除 (Socket 消息还是要发的)
            emitEvent('remove', { id: obj.id })
          })
          //保存一次性删除命令
          addCommand({ type: 'batch-remove', data: removedData })

          // 清空列表
          erasingCandidates.clear()
          c.requestRenderAll()

          // 2. 解锁
          isBatchOperation = false
        } else {
          // 如果没删掉任何东西，也要记得解锁
          isBatchOperation = false
        }

        return
      }

      // --- 普通画笔逻辑 ---
      path.set('id', generateId())
      const json = path.toJSON(['id'])
      emitEvent('add', json)
      addCommand({ type: 'add', data: json })
    })

    // 通用 Action 处理改为命令模式
    const handleAction = (action, e) => {
      if (isReceivingRemote || isBatchOperation) return
      if (!e.target) return
      const json = e.target.toJSON(['id'])

      // 同步消息
      emitEvent(action, json)

      // 记录历史 (如果不是正在 Undo/Redo)
      if (!isUndoRedoing) {
        if (action === 'add') {
          // 注意：path:created 已经处理了画笔历史，这里只处理 addShape 等操作
          // 画笔产生的对象在 object:added 时还没有 ID (在 path:created 才生成)，所以会被这里的 !e.target.id 拦截
          // 只有 addShape 产生的对象在这里记录
          addCommand({ type: 'add', data: json })
        } else if (action === 'remove') {
          addCommand({ type: 'remove', data: json })
        } else if (action === 'modify') {
          if (modifyStartJSON) {
            addCommand({
              type: 'modify',
              id: json.id,
              before: modifyStartJSON,
              after: json,
            })
            // 更新起始状态，以防连续修改
            modifyStartJSON = json
          }
        }
      }
    }

    c.on('object:modified', (e) => handleAction('modify', e))

    c.on('object:added', (e) => {
      if (isReceivingRemote) return
      if (!e.target || !e.target.id) return
      handleAction('add', e)
    })

    c.on('object:removed', (e) => handleAction('remove', e))
  }

  const emitEvent = (action, data) => {
    if (onEventCallback) {
      onEventCallback({ action, data, objectId: data.id })
    }
  }

  // --- Undo / Redo ---

  // 辅助：按 id 查找
  const findById = (c, id) => c.getObjects().find((o) => o.id === id)

  // 判断撤回是否可生效（当前画布状态下）
  const isApplicableForUndo = (cmd, c) => {
    switch (cmd.type) {
      case 'add': // 撤销添加 = 删除该对象，只有对象还在时才有意义
        return !!findById(c, cmd.data.id)
      case 'remove': // 撤销删除 = 恢复对象，只有对象当前不在时才有意义
        return !findById(c, cmd.data.id)
      case 'modify': // 撤销修改 = 恢复前态，只有对象存在才有意义
        return !!findById(c, cmd.id)
      case 'batch-remove': // 撤销批量删除 = 批量恢复，至少有一个缺失才有意义
        return cmd.data.some((item) => !findById(c, item.id))
      case 'clear': // 撤销清空 = 批量恢复，总是可尝试；内部做去重
        return true
      default:
        return true
    }
  }

  // 判断重做是否可生效
  const isApplicableForRedo = (cmd, c) => {
    switch (cmd.type) {
      case 'add': // 重做添加 = 添加对象，只有对象当前不存在才有意义
        return !findById(c, cmd.data.id)
      case 'remove': // 重做删除 = 删除对象，只有对象当前存在才有意义
        return !!findById(c, cmd.data.id)
      case 'modify': // 重做修改 = 应用后态，只有对象存在才有意义
        return !!findById(c, cmd.id)
      case 'batch-remove': // 重做批量删除 = 批量删除，至少有一个当前存在才有意义
        return cmd.data.some((item) => !!findById(c, item.id))
      case 'clear':
        return true
      default:
        return true
    }
  }

  const undo = () => {
    if (!canvas.value || historyStack.value.length === 0) return
    const c = canvas.value
    isUndoRedoing = true

    let skipped = 0
    let cmd = null

    // 向后查找“当前仍可生效的最近一次操作”
    while (historyStack.value.length) {
      const top = historyStack.value.pop()
      if (isApplicableForUndo(top, c)) {
        cmd = top
        break
      }
      skipped++
      // 跳过的失效记录不进入 redoStack
    }

    if (!cmd) {
      isUndoRedoing = false
      if (skipped && onErrorCallback)
        onErrorCallback('部分操作因对象已被删除，已自动跳过')
      return
    }

    // 仅对生效的这条操作入 redo 栈
    redoStack.value.push(cmd)

    const onComplete = () => {
      isUndoRedoing = false
      if (skipped && onErrorCallback)
        onErrorCallback('部分操作因对象已被删除，已自动跳过')
    }

    if (cmd.type === 'add') {
      const obj = findById(c, cmd.data.id)
      if (obj) {
        c.remove(obj)
        c.requestRenderAll()
      }
      onComplete()
    } else if (cmd.type === 'remove') {
      const payload = [cmd.data].filter((item) => !findById(c, item.id))
      fabric.util.enlivenObjects(payload, (objs) => {
        objs.forEach((o) => c.add(o))
        c.requestRenderAll()
        onComplete()
      })
    } else if (cmd.type === 'modify') {
      const obj = findById(c, cmd.id)
      if (obj) {
        obj.set(cmd.before)
        obj.setCoords()
        c.requestRenderAll()
        emitEvent('modify', obj.toJSON(['id']))
      }
      onComplete()
    } else if (cmd.type === 'batch-remove') {
      const payload = cmd.data.filter((item) => !findById(c, item.id))
      fabric.util.enlivenObjects(payload, (objs) => {
        objs.forEach((o) => c.add(o))
        c.requestRenderAll()
        onComplete()
      })
    } else if (cmd.type === 'clear') {
      const payload = cmd.data.filter((item) => !findById(c, item.id))
      fabric.util.enlivenObjects(payload, (objs) => {
        objs.forEach((o) => c.add(o))
        c.backgroundColor = '#ffffff'
        c.requestRenderAll()
        onComplete()
      })
    } else {
      onComplete()
    }
  }

  const redo = () => {
    if (!canvas.value || redoStack.value.length === 0) return
    const c = canvas.value
    isUndoRedoing = true

    let skipped = 0
    let cmd = null

    // 向后查找“当前仍可生效的最近一次重做”
    while (redoStack.value.length) {
      const top = redoStack.value.pop()
      if (isApplicableForRedo(top, c)) {
        cmd = top
        break
      }
      skipped++
      // 跳过的失效记录不回填到 historyStack
    }

    if (!cmd) {
      isUndoRedoing = false
      if (skipped && onErrorCallback)
        onErrorCallback('部分操作因对象已被删除，已自动跳过')
      return
    }

    // 仅回填生效的这条操作到历史栈
    historyStack.value.push(cmd)

    const onComplete = () => {
      isUndoRedoing = false
      if (skipped && onErrorCallback)
        onErrorCallback('部分操作因对象已被删除，已自动跳过')
    }

    if (cmd.type === 'add') {
      const payload = [cmd.data].filter((item) => !findById(c, item.id))
      fabric.util.enlivenObjects(payload, (objs) => {
        objs.forEach((o) => c.add(o))
        c.requestRenderAll()
        onComplete()
      })
    } else if (cmd.type === 'remove') {
      const obj = findById(c, cmd.data.id)
      if (obj) c.remove(obj)
      c.requestRenderAll()
      onComplete()
    } else if (cmd.type === 'modify') {
      const obj = findById(c, cmd.id)
      if (obj) {
        obj.set(cmd.after)
        obj.setCoords()
        c.requestRenderAll()
        emitEvent('modify', obj.toJSON(['id']))
      }
      onComplete()
    } else if (cmd.type === 'batch-remove') {
      cmd.data.forEach((item) => {
        const obj = findById(c, item.id)
        if (obj) c.remove(obj)
      })
      c.requestRenderAll()
      onComplete()
    } else if (cmd.type === 'clear') {
      c.clear()
      c.backgroundColor = '#ffffff'
      c.requestRenderAll()
      // 同步清空（逐个发 remove）
      cmd.data.forEach((item) => emitEvent('remove', { id: item.id }))
      onComplete()
    } else {
      onComplete()
    }
  }

  const setEventCallback = (fn) => {
    onEventCallback = fn
  }
  // 暴露设置错误回调的方法
  const setOnError = (fn) => {
    onErrorCallback = fn
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

    // 处理实时移动 ('moving')
    if (action === 'moving') {
      const obj = c.getObjects().find((o) => o.id === data.id)
      if (obj) {
        obj.set(data)
        obj.setCoords()
        c.requestRenderAll()
      }
      isReceivingRemote = false // 立即释放锁
      return
    }

    // 处理实时绘图 ('drawing')
    if (action === 'drawing') {
      const { id, status, x, y, width, color } = data

      if (status === 'start') {
        // 创建临时路径
        const pathData = `M ${x} ${y}`
        const path = new fabric.Path(pathData, {
          id: id,
          fill: null,
          stroke: color,
          strokeWidth: width,
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          objectCaching: false, // 关闭缓存以获得流畅的实时渲染
          selectable: false,
          evented: false,
          originX: 'left',
          originY: 'top',
          left: 0,
          top: 0,
        })
        path.pathOffset = { x: 0, y: 0 }

        c.add(path)
        remoteDrawingPaths[id] = path
      } else if (status === 'move') {
        const path = remoteDrawingPaths[id]
        if (path) {
          // 向路径添加点
          path.path.push(['L', x, y])
          // 不再重新计算 Dimensions 和 Center
          // 直接标记 dirty，因为我们使用的是绝对坐标 + 0偏移
          path.set({ dirty: true })
          c.requestRenderAll()
        }
      } else if (status === 'end') {
        // 结束绘制，移除临时路径
        // 稍后会收到 'add' 事件来添加最终的平滑路径
        const path = remoteDrawingPaths[id]
        if (path) {
          c.remove(path)
          delete remoteDrawingPaths[id]
          c.requestRenderAll()
        }
      }
      isReceivingRemote = false
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

  // 设置模式
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
      // 如果是多选删除，需要逐个处理
      if (obj.type === 'activeSelection') {
        obj.forEachObject((subObj) => {
          canvas.value.remove(subObj)
          emitEvent('remove', { id: subObj.id })
        })
        canvas.value.discardActiveObject()
      } else {
        canvas.value.remove(obj)
        emitEvent('remove', { id: obj.id })
      }
      activeObject.value = null
      canvas.value.requestRenderAll()
    }
  }

  const clearCanvas = () => {
    if (!canvas.value) return
    const allObjs = canvas.value.getObjects().map((o) => o.toJSON(['id']))

    // 记录 clear 命令
    if (allObjs.length > 0 && !isReceivingRemote && !isUndoRedoing) {
      addCommand({ type: 'clear', data: allObjs })
    }

    isBatchOperation = true
    canvas.value.clear()
    canvas.value.backgroundColor = '#ffffff'
    activeObject.value = null
    isBatchOperation = false

    // 遍历发送删除信号以同步
    allObjs.forEach((o) => emitEvent('remove', { id: o.id }))
  }

  // 属性编辑会话：只在关闭面板时入栈一次
  let attrEditSession = null // { id, before }

  const beginAttributeEdit = (objectId) => {
    if (!canvas.value || !objectId) return
    const c = canvas.value
    const obj = c.getObjects().find((o) => o.id === objectId)
    if (!obj) return
    // 记录会话起始快照
    attrEditSession = {
      id: objectId,
      before: obj.toJSON(['id']),
    }
  }

  // 简单状态比较：序列化后比对
  const isStateEqual = (a, b) => {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }

  const commitAttributeEdit = () => {
    if (!canvas.value || !attrEditSession) return
    const c = canvas.value
    const obj = c.getObjects().find((o) => o.id === attrEditSession.id)
    if (!obj) {
      // 对象不存在，直接结束会话
      attrEditSession = null
      return
    }
    const after = obj.toJSON(['id'])
    // 如果正在接收远端或撤回中，避免入栈
    if (
      !isReceivingRemote &&
      !isUndoRedoing &&
      !isStateEqual(attrEditSession.before, after)
    ) {
      addCommand({
        type: 'modify',
        id: obj.id,
        before: attrEditSession.before,
        after,
      })
    }
    attrEditSession = null
  }

  const updateActiveObject = (key, value) => {
    const obj = canvas.value?.getActiveObject()
    if (!obj) return

    // 如果值未变化，直接跳过
    if (obj.get(key) === value) return
    // 会话中：只应用与广播，不入历史
    if (attrEditSession && attrEditSession.id === obj.id) {
      obj.set(key, value)
      canvas.value.requestRenderAll()
      const after = obj.toJSON(['id'])
      emitEvent('modify', after)
      return
    }

    // 非会话：单次修改直接入历史
    const before = obj.toJSON(['id'])
    obj.set(key, value)
    canvas.value.requestRenderAll()
    const after = obj.toJSON(['id'])
    emitEvent('modify', after)
    addCommand({
      type: 'modify',
      id: obj.id,
      before,
      after,
    })
  }

  const toJSON = () => {
    if (!canvas.value) return null
    return canvas.value.toJSON(['id'])
  }

  const loadFromJSON = (json) => {
    if (!canvas.value || !json) return
    canvas.value.loadFromJSON(json, () => {
      canvas.value.renderAll()
      // 切换画板时清空撤销/重做栈
      historyStack.value = []
      redoStack.value = []
      // 记录初始状态到撤销栈
      addCommand({ type: 'init', data: canvas.value.toJSON(['id']) })
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
    beginAttributeEdit,
    commitAttributeEdit,
    toJSON,
    loadFromJSON,
    exportAsImage,
    setEventCallback,
    setOnError,
    applyRemoteUpdate,
    undo,
    redo,
    historyStack,
    redoStack,
  }
}
