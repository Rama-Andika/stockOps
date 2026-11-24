// The build-info file: what one build says about itself.
//
// scripts/stamp-sw.mjs writes dist/build-info.json as the last step of `npm run build`. The package
// builder (scripts/deploy/package.mjs) and the build check (scripts/deploy/bundle-check.mjs) read it
// to be sure that dist/ was built for the version, the mode and the base path they expect.
//
// The file holds exactly five fields: version, buildTime, mode, basePath and tenantSlug. It sits
// next to dist/client, never inside it, so it is not served to browsers.
//
// No dependencies: both Node scripts and tests load this file.

/**
 * Reads the text of a build-info file. Returns null when the text is not valid JSON or a field is
 * missing or has the wrong type, so a caller never has to guess what a half-written file meant.
 *
 * @param {string} text
 * @returns {{ version: string, buildTime: string, mode: string, basePath: string, tenantSlug: string } | null}
 */
export function parseBuildInfo(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (data === null || typeof data !== 'object') return null
  const { version, buildTime, mode, basePath, tenantSlug } = data
  if (typeof version !== 'string' || version === '') return null
  if (typeof buildTime !== 'string' || buildTime === '') return null
  if (typeof mode !== 'string' || mode === '') return null
  if (typeof basePath !== 'string' || !basePath.startsWith('/') || !basePath.endsWith('/')) {
    return null
  }
  if (typeof tenantSlug !== 'string') return null
  return { version, buildTime, mode, basePath, tenantSlug }
}
