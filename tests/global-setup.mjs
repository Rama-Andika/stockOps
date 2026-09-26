import { createTestSchema } from '../scripts/lib/test-db.mjs'

/** Dijalankan sekali sebelum seluruh test (Vitest globalSetup). */
export default async function globalSetup() {
  await createTestSchema({ log: (message) => console.log(`[test-db] ${message}`) })
}
