import 'dotenv/config'
import '@testing-library/jest-dom/vitest'

// Semua test berjalan melawan schema uji terpisah, BUKAN database admin `demo`.
process.env.DB_NAME = process.env.DB_TEST_NAME ?? 'stockops_test'
process.env.CREDENTIAL_HMAC_SECRET ??= 'test-credential-secret'
process.env.SESSION_TTL_DAYS ??= '7'
process.env.PDT_APP_ID_INDEX ??= '2'
process.env.ADMIN_APP_ID_INDEX ??= '1'
process.env.TZ ??= 'Asia/Makassar'
