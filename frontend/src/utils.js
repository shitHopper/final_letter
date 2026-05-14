export function parseUTC(dateStr) {
  if (!dateStr) return null
  // SQLite returns "YYYY-MM-DD HH:MM:SS" (UTC); append T and Z for JS Date parsing
  // ISO 8601 strings (with T) are passed through — they already carry timezone info
  const utcStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
  const d = new Date(utcStr)
  return isNaN(d.getTime()) ? null : d
}
