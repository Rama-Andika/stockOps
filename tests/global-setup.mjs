import { createTestSchema } from '../scripts/lib/test-db.mjs'

/** Runs once before all tests (Vitest globalSetup). */
export default async function globalSetup() {
  await createTestSchema({ log: (message) => console.log(`[test-db] ${message}`) })
}
