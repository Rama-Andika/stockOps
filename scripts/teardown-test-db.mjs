import { dropTestSchema } from './lib/test-db.mjs'

dropTestSchema({ log: console.log })
  .then(() => console.log('Selesai.'))
  .catch((error) => {
    console.error('[teardown-test-db] gagal:', error)
    process.exit(1)
  })
