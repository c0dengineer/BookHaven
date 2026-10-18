export const LOAN_PERIOD_DAYS = 14;
export const FINE_PER_DAY_RUPEES = 5;
function dayStart(d) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
export function calculateFine(dueAt, returnedAt, rate = FINE_PER_DAY_RUPEES) {
  if (!(dueAt instanceof Date) || Number.isNaN(dueAt.getTime())) throw new Error('Invalid due date');
  if (!(returnedAt instanceof Date) || Number.isNaN(returnedAt.getTime())) throw new Error('Invalid return date');
  if (!Number.isFinite(rate) || rate < 0) throw new Error('Fine rate must be non-negative');
  const days = Math.max(0, Math.floor((dayStart(returnedAt) - dayStart(dueAt)) / 86400000));
  return Number((days * rate).toFixed(2));
}
export function getDueDate(issuedAt, loanDays = LOAN_PERIOD_DAYS) {
  if (!(issuedAt instanceof Date) || Number.isNaN(issuedAt.getTime())) throw new Error('Invalid issue date');
  if (!Number.isInteger(loanDays) || loanDays < 1 || loanDays > 365) throw new Error('Loan period must be between 1 and 365 days');
  const due = new Date(issuedAt); due.setUTCDate(due.getUTCDate() + loanDays); return due;
}
