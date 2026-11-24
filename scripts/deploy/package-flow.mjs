import { normalizeBasePath } from '../lib/base-path.mjs'
import { packageName, versionProblems } from './package-rules.mjs'

// One package from start to finish, with every outside thing (git, the build, the disk) passed in
// through `deps`. scripts/deploy/package.mjs connects the real world to this flow;
// tests/unit/package-flow.test.ts connects fakes.

/**
 * @typedef {{ ok: boolean, file: string, name: string, version: string, basePath: string }} PackageResult
 * @typedef {{ skipBuild?: boolean, localOnly?: boolean, basePath?: string }} PackageOptions
 * @typedef {{ version: string, buildTime: string, mode: string, basePath: string, tenantSlug: string }} BuildInfo
 * @typedef {{
 *   now: () => Date,
 *   log: (line: string) => void,
 *   git: { describe: () => string, isDirty: () => boolean },
 *   readPackageVersion: () => string,
 *   build: (env: string, basePath: string | undefined) => boolean,
 *   readBuildInfo: () => BuildInfo | null,
 *   checkBuild: (expected: { version: string, mode: string, basePath: string }) => { problems: string[], precacheCount: number },
 *   makePackage: (name: string) => { file: string, sizeBytes: number },
 * }} PackageDeps
 */

/** A failure with a message for the person. */
class PackageError extends Error {}

/**
 * Builds the app for one environment, checks the build, and makes the package (.tgz) to upload to a
 * server by hand.
 *
 * @param {{ env: string, options?: PackageOptions, deps: PackageDeps }} input
 * @returns {PackageResult}
 */
export function runPackage({ env, options = {}, deps }) {
  const { log, now } = deps
  let step = 0
  /** @param {string} text */
  const heading = (text) => log(`\n[${++step}] ${text}`)
  /** @type {PackageResult} */
  const result = { ok: false, file: '', name: '', version: '', basePath: '' }

  try {
    heading('Periksa permintaan dan versi')
    if (env !== 'staging' && env !== 'production') {
      throw new PackageError('lingkungan harus staging atau production')
    }
    const buildVersion = deps.git.describe()
    /** @type {string} */
    let packageVersion
    try {
      packageVersion = deps.readPackageVersion()
    } catch {
      throw new PackageError('package.json tidak bisa dibaca atau bukan JSON yang valid')
    }
    const problems = versionProblems({
      env,
      buildVersion,
      packageVersion,
      treeDirty: deps.git.isDirty(),
      localOnly: options.localOnly === true,
    })
    if (problems.length > 0) {
      throw new PackageError(`versi ini tidak bisa dipaketkan:\n  - ${problems.join('\n  - ')}`)
    }
    result.version = buildVersion
    log(`  lingkungan ${env}, versi ${buildVersion}`)

    heading('Build')
    if (options.skipBuild) {
      log('  dilewati (--skip-build): dist/ yang ada dipakai')
    } else {
      log(`  membangun untuk mode ${env} ...`)
      if (!deps.build(env, options.basePath)) throw new PackageError('build gagal')
      // The build can rewrite a tracked file (for example src/routeTree.gen.ts). A package must
      // come from exactly the commit of the tag, so a build that changed the tree is refused.
      if (options.localOnly !== true && deps.git.isDirty()) {
        throw new PackageError(
          'build mengubah file yang dilacak git (misalnya src/routeTree.gen.ts); lihat "git status", commit hasilnya lewat rilis baru, lalu ulangi',
        )
      }
    }

    heading('Periksa hasil build')
    const info = deps.readBuildInfo()
    if (!info) {
      throw new PackageError(
        'dist/build-info.json tidak ada atau tidak terbaca; jalankan build tanpa --skip-build',
      )
    }
    if (info.mode !== env) {
      throw new PackageError(
        `build di dist/ dibuat untuk mode "${info.mode}", sedangkan paket ini untuk "${env}"; build ulang tanpa --skip-build`,
      )
    }
    if (info.version !== packageVersion) {
      throw new PackageError(
        `build di dist/ berversi "${info.version}", sedangkan package.json berversi "${packageVersion}"; dist/ berasal dari commit lain, build ulang tanpa --skip-build`,
      )
    }
    if (options.basePath !== undefined && normalizeBasePath(options.basePath) !== info.basePath) {
      throw new PackageError(
        `build di dist/ memakai base path "${info.basePath}", sedangkan yang diminta "${normalizeBasePath(options.basePath)}"; build ulang tanpa --skip-build`,
      )
    }
    const check = deps.checkBuild({
      version: packageVersion,
      mode: env,
      basePath: info.basePath,
    })
    if (check.problems.length > 0) {
      throw new PackageError(
        `build ini tidak akan jalan di server:\n  - ${check.problems.join('\n  - ')}`,
      )
    }
    result.basePath = info.basePath
    log(
      `  ok: versi ${info.version}, base path ${info.basePath}, ${check.precacheCount} berkas precache`,
    )

    heading('Buat paket')
    const name = packageName({
      version: buildVersion,
      env,
      tenantSlug: info.tenantSlug,
      now: now(),
    })
    result.name = name
    const made = deps.makePackage(name)
    result.file = made.file
    result.ok = true

    log(
      `\nPAKET SIAP: ${made.file} (${(made.sizeBytes / (1024 * 1024)).toFixed(1)} MB), mode ${env}, versi ${buildVersion}`,
    )
    log(
      `Paket ini hanya cocok untuk base path ${info.basePath} (tertanam saat build); tenant lain perlu paket sendiri.`,
    )
    if (options.localOnly) {
      log(
        '\nHANYA LOKAL: paket ini untuk dicoba di komputer ini. Versinya bukan tag rilis, jangan dipasang ke server.',
      )
    } else {
      log('\nLangkah berikutnya, dengan tangan:')
      log('  1. Unggah paket ke server (WinSCP, scp, dan sebagainya).')
      log('  2. Di server, buat folder deploy yang baru, lalu ekstrak paket ke dalamnya:')
      log('       mkdir <folder deploy>')
      log(`       tar -xzf ${name} -C <folder deploy>`)
      log(
        '  3. Siapkan file env di folder itu: salin dari folder rilis sebelumnya, atau buat dari .env.example (nama: stockops.env atau .env.<mode>).',
      )
      log('  4. Pasang dependensi produksi: npm ci --omit=dev')
      log(`  5. Jalankan: npm run serve:${env}`)
      log(
        '  Rollback: jalankan lagi folder rilis sebelumnya (jangan menghapusnya sebelum rilis baru terbukti sehat).',
      )
    }
  } catch (error) {
    if (!(error instanceof PackageError)) throw error
    log(`\nGAGAL: ${error.message}`)
  }
  return result
}
