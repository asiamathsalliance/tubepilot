import { formatInTimeZone, toDate } from 'date-fns-tz'

/** All user-facing schedule times use this IANA zone (handles DST). */
export const AUSTRALIA_TZ = 'Australia/Sydney'

export function isoToAustraliaDatetimeLocalValue(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatInTimeZone(d, AUSTRALIA_TZ, "yyyy-MM-dd'T'HH:mm")
}

/** Interprets `datetime-local` value as wall time in Australia/Sydney → UTC ISO. */
export function australiaDatetimeLocalToIso(local: string): string {
  const parsed = toDate(local, { timeZone: AUSTRALIA_TZ })
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString()
  return parsed.toISOString()
}

/** Noon Australia/Sydney on a calendar date `YYYY-MM-DD`. */
export function publishDateToAustraliaNoonIso(dateYmd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) return new Date().toISOString()
  return australiaDatetimeLocalToIso(`${dateYmd}T12:00`)
}
