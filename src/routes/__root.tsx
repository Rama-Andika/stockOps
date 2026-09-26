import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { AppProvider } from '~/client/state/app-context'
import { AppShell } from '~/components/app-shell'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      { name: 'theme-color', content: '#0f172a' },
      { name: 'description', content: 'Pencatatan penerimaan barang berbasis PO untuk PDT (offline-first)' },
      { title: 'StockOps — Penerimaan Barang' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'icon', href: '/icon.svg', type: 'image/svg+xml' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  return (
    <RootDocument>
      <AppProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </AppProvider>
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
