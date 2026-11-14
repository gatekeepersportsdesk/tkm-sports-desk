/**
 * Date utility to ensure all boards and engines automatically start with the actual day's date.
 */
export function getTodayIsoDate(): string {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTodayDayOfWeek(): 'Thursday' | 'Sunday' | 'Monday' | string {
  return new Date().toLocaleDateString('en-US', { weekday: 'long' });
}
