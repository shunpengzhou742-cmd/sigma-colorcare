import { createHash } from "node:crypto";
import { calculateFinanceSummary, calculatePayrollReconciliation } from "../scripts/finance-accounting.mjs";

export function getFinanceMonthRange(periodId) {
  if (typeof periodId !== "string" || !/^(\\d{4})-(0[1-9]|1[0-2])$/.test(periodId)) {
    throw new TypeError("periodId must use YYYY-MM format");
  }
  const [year, month] = periodId.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    periodId,
    startDate: periodId + "-01",
    endDate: periodId + "-" + String(lastDay).padStart(2, "0")
  };
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return value;
  if (typeof value.toMillis === "function" && typeof value.toDate === "function") {
    return { __type: "firestore-timestamp", seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (value instanceof Date) return { __type: "date", value: value.toISOString() };
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value.constructor?.name === "DocumentReference" && typeof value.path === "string") {
    return { __type: "document-reference", path: value.path };
  }
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

export function createFinanceSourceDigest(sources) {
  const normalized = Object.keys(sources).sort().map(collectionName => ({
    collection: collectionName,
    documents: [...sources[collectionName]]
      .map(row => ({ id: row.id, data: canonicalize(row.data ?? row) }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function buildFinanceClosureSnapshot({
  periodId, records, expenses, scrapRequests, attendance, sourceCounts, sourceDigest
}) {
  const range = getFinanceMonthRange(periodId);
  const finance = calculateFinanceSummary(records, expenses);
  const payroll = calculatePayrollReconciliation(records, attendance);
  const approved = scrapRequests.filter(row => row.status === "approved");
  const sumQuantity = rows => rows.reduce((sum, row) => {
    const value = Number(row.quantity);
    return sum + (Number.isFinite(value) && value > 0 ? value : 0);
  }, 0);
  const scrapByDepartment = [1, 2, 3].map(id => ({
    departmentId: id,
    quantity: sumQuantity(approved.filter(row => Number(row.departmentId) === id))
  }));
  return {
    ...range,
    status: "closed",
    snapshot: {
      finance,
      payrollReconciliation: payroll,
      scrap: {
        approvedQuantity: sumQuantity(approved),
        byDepartment: scrapByDepartment
      },
      audit: {
        issueCount: finance.auditIssueCount + payroll.invalidAttendanceCount +
          payroll.undatedAttendanceCount + payroll.unmatchedAccountingCount,
        financeIssueCount: finance.auditIssueCount,
        invalidAttendanceCount: payroll.invalidAttendanceCount,
        undatedAttendanceCount: payroll.undatedAttendanceCount,
        unmatchedAccountingCount: payroll.unmatchedAccountingCount
      }
    },
    sourceCounts,
    sourceDigest,
    schemaVersion: 1
  };
}
