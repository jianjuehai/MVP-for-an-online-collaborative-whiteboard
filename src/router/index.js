import { createRouter, createWebHistory } from 'vue-router'
import Whiteboard from '../views/WhiteBoard.vue'
import Auth from '../views/LogIn.vue'
import { useUserStore } from '../stores/userStore'

const routes = [
  {
    path: '/',
    redirect: () => {
      // 游客从根路径访问时，直接跳转到本地白板
      return { path: '/board/local' }
    },
  },
  {
    path: '/login',
    name: 'Login',
    component: Auth,
  },
  {
    path: '/register',
    name: 'Register',
    component: Auth,
  },
  {
    path: '/board/:id',
    name: 'Board',
    component: Whiteboard,
    meta: { requiresAuth: false }, // 允许游客访问
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// 全局前置守卫
router.beforeEach((to, from, next) => {
  const userStore = useUserStore()
  const isAuthenticated = !!userStore.token

  if (to.meta.requiresAuth && !isAuthenticated) {
    // 如果需要登录但没登录，跳转到登录页，并记录想去的页面
    next({
      path: '/login',
      query: { redirect: to.fullPath },
    })
  } else if (
    (to.path === '/login' || to.path === '/register') &&
    isAuthenticated
  ) {
    // 如果已登录还想去登录页，直接踢回首页
    next('/')
  } else {
    next()
  }
})

export default router
