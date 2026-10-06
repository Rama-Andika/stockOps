import type { ReactNode } from 'react'
import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { AppStoreProvider } from '~/client/state/store/app-store-provider'
import { AppShell } from '~/components/app-shell'
import appCss from '~/styles/app.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      // Must match --color-ground in src/styles/app.css and theme_color in
      // public/manifest.webmanifest: a meta tag cannot read var(), so this value is duplicated in
      // three places and all three change together.
      { name: 'theme-color', content: '#0b1220' },
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
      <AppStoreProvider>
        <AppShell>
          <Outlet />
        </AppShell>
      </AppStoreProvider>
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
