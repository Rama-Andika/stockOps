import 'dotenv/config'
import '@testing-library/jest-dom/vitest'

// All tests run against a dedicated test schema, NOT the admin `demo` database.
process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'stockops_test'
process.env.CREDENTIAL_HMAC_SECRET ??= 'test-credential-secret'
process.env.SESSION_TTL_DAYS ??= '7'
process.env.PDT_APP_ID_INDEX ??= '2'
process.env.ADMIN_APP_ID_INDEX ??= '1'
process.env.TZ ??= 'Asia/Makassar'

/**
 * jsdom has no ResizeObserver, and @tanstack/react-virtual constructs one as soon as it has a
 * scroll element — which the item picker and the scan cockpit provide from inside their own
 * components.
 *
 * virtual-core 3.17 guards on `targetWindow.ResizeObserver` and simply stops observing when it is
 * missing, so the tests survive without this. It is here because virtual-core is a TRANSITIVE
 * dependency on `^3`: a minor release that drops that guard would turn every component test red at
 * once, and six no-op lines are cheaper than diagnosing that later.
 *
 * A no-op is enough on purpose, and it hides nothing: it never calls its callback, so nothing is
 * ever re-measured because of it. The one test that really exercises the virtual window fakes
 * layout itself — see tests/component/virtual-layout.tsx, which fakes `offsetHeight`, the property
 * virtual-core actually measures with. Defined here rather than in a component setup file because
 * vitest uses one setupFiles list for every environment, and this is harmless under `node`.
 */
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??= NoopResizeObserver as unknown as typeof ResizeObserver

