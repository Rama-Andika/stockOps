import { createTestSchema } from './lib/test-db.mjs'

createTestSchema({ log: console.log })
  .then((config) => {
    console.log(`\nSchema uji siap dipakai: ${config.test}`)
  })
  .catch((error) => {
    console.error('[setup-test-db] gagal:', error)
    process.exit(1)
  })
