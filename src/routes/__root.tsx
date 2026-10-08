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
      // The DARK value, and the one the document starts with. A meta tag cannot read var(), so it
      // is a copy of --color-ground in src/styles/app.css; theme_color in
      // public/manifest.webmanifest is a third copy and all three change together.
      // src/client/theme.ts rewrites this tag's content when the operator switches theme (see
      // THEME_COLOR there); the manifest deliberately does NOT follow, because it is read once at
      // install time.
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
        {/* Runs before the first paint, inside the prerendered SPA shell: `data-theme` has to be on
            <html> BEFORE React mounts, or every app start shows one frame of the dark theme on a
            device set to light. On a PDT that is opened and closed all shift long, that flash is
            very visible.

            src/client/theme.ts owns the same decision for the rest of the session. The two read the
            SAME localStorage key and MUST be changed together. This is duplicated rather than
            imported on purpose: at this point in the document the application bundle has not been
            fetched, so there is nothing to import from.

            Wrapped in try/catch because localStorage throws outright in some locked-down WebViews,
            and a theme is never worth a blank screen. It only ever ADDS the attribute — dark is its
            absence — so running twice (prerender, then hydration) changes nothing. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var p=JSON.parse(localStorage.getItem('stockops.preferences')||'{}');if(p&&p.theme==='light'){document.documentElement.setAttribute('data-theme','light')}}catch(e){}",
          }}
        />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}
