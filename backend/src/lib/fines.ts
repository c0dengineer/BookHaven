/** Fine policy: ₹5 per overdue calendar day; defaults to a 14-day loan. */
export const LOAN_PERIOD_DAYS = 14;
export const FINE_PER_DAY_RUPEES = 5;

function startOfUtcCalendarDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function calculateFine(dueAt: Date, returnedAt: Date, rate = FINE_PER_DAY_RUPEES): number {
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) throw new Error('Invalid due date');
  if (!(returnedAt instanceof Date) || Number.isNaN(returnedAt.getTime())) throw new Error('Invalid return date');
  if (returnedAt.getTime() < 0 || dueAt.getTime() < 0) throw new Error('Invalid date');
  if (!Number.isFinite(rate) || rate < 0) throw new Error('Fine rate must be non-negative');
  const overdueDays = Math.max(0, Math.floor((startOfUtcCalendarDay(returnedAt) - startOfUtcCalendarDay(dueAt)) / 86_400_000));
  return Number((overdueDays * rate).toFixed(2));
}

export function getDueDate(issuedAt: Date, loanDays = LOAN_PERIOD_DAYS): Date {
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) throw new Error('Invalid issue date');
  if (!Number.isInteger(loanDays) || loanDays < 1 || loanDays > 365) throw new Error('Loan period must be between 1 and 365 days');
  const due = new Date(issuedAt);
  due.setUTCDate(due.getUTCDate() + loanDays);
  return due;
}
