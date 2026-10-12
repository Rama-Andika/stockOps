import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'
import { APP_BASE_PATH } from '~/core/base-path'

export function getRouter() {
  return createRouter({
    routeTree,
    basepath: APP_BASE_PATH === '/' ? undefined : APP_BASE_PATH.replace(/\/$/, ''),
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPendingMs: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
