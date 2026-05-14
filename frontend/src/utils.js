export function parseUTC(dateStr) {
  if (!dateStr) return null
  const utcStr = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + 'Z'
  return new Date(utcStr)
}
