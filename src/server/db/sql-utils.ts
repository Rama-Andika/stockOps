/** Small SQL utilities (date formatting for MySQL datetime/date columns). */

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value)
}

/** Date -> 'YYYY-MM-DD HH:MM:SS' using server LOCAL time (aligned with admin). */
export function toMysqlDateTime(date: Date): string {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/** Date -> 'YYYY-MM-DD'. */
export function toMysqlDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Adds n days to a 'YYYY-MM-DD' or Date. */
export function addDays(base: Date, days: number): Date {
  const result = new Date(base.getTime())
  result.setDate(result.getDate() + days)
  return result
}
