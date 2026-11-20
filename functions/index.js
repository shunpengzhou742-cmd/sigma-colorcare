import { initializeApp } from "firebase-admin/app";
import { FieldPath, FieldValue, getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { buildFinanceClosureSnapshot, createFinanceSourceDigest, getFinanceMonthRange } from "./closure-core.mjs";

initializeApp();
const db = getFirestore();
const PAGE_SIZE = 400;
const SOURCE_COLLECTIONS = [
  ["dailyRecords", "workDate"],
  ["operatingExpenses", "expenseDate"],
  ["scrapRequests", "requestDate"],
  ["employeeAttendance", "workDate"],
  ["dailyRecordAuditLogs", "workDate"],
  ["employeeAttendanceAuditLogs", "workDate"]
];

async function requireActiveAdmin(uid) {
  const adminSnap = await db.collection("admins").doc(uid).get();
  if (!adminSnap.exists || adminSnap.get("role") !== "admin" || adminSnap.get("status") !== "active") {
    throw new HttpsError("permission-denied", "Active administrator access is required.");
  }
}

async function readPeriodCollection(collectionName, dateField, startDate, endDate) {
  const result = [];
  let cursor = null;
  while (true) {
    let query = db.collection(collectionName)
      .where(dateField, ">=", startDate)
      .where(dateField, "<=", endDate)
      .orderBy(dateField)
      .orderBy(FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const doc of page.docs) result.push({ id: doc.id, data: doc.data() });
    if (page.size < PAGE_SIZE) break;
    const nextCursor = page.docs[page.docs.length - 1];
    if (cursor && nextCursor.id === cursor.id) {
      throw new HttpsError("internal", "Finance pagination cursor did not advance.");
    }
    cursor = nextCursor;
  }
  return result;
}

export const closeFinancePeriod = onCall({
  region: "asia-southeast1",
  timeoutSeconds: 540,
  memory: "1GiB"
}, async request => {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "Sign in is required.");
  await requireActiveAdmin(request.auth.uid);

  let range;
  try {
    range = getFinanceMonthRange(request.data?.periodId);
  } catch {
    throw new HttpsError("invalid-argument", "periodId must use YYYY-MM format.");
  }

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
  if (range.endDate >= today) {
    throw new HttpsError("failed-precondition", "Only a completed month can be closed.");
  }

  const closureRef = db.collection("financeClosures").doc(range.periodId);
  await db.runTransaction(async transaction => {
    const existing = await transaction.get(closureRef);
    if (!existing.exists) {
      transaction.create(closureRef, {
        ...range,
        status: "closing",
        startedAt: FieldValue.serverTimestamp(),
        startedBy: request.auth.uid,
        schemaVersion: 1
      });
      return;
    }
    if (existing.get("status") === "closed") {
      throw new HttpsError("already-exists", "This finance period is already closed.");
    }
    if (existing.get("status") !== "closing") {
      throw new HttpsError("failed-precondition", "The existing closure has an unsupported state.");
    }
  });

  // The lock is created before reading any source collection. Firestore rules
  // reject client writes to this month while the server assembles the snapshot.
  const pages = await Promise.all(SOURCE_COLLECTIONS.map(([name, dateField]) =>
    readPeriodCollection(name, dateField, range.startDate, range.endDate)
  ));
  const sources = Object.fromEntries(SOURCE_COLLECTIONS.map(([name], index) => [name, pages[index]]));
  const [daily, expenses, scraps, attendance] = pages;
  const sourceCounts = Object.fromEntries(SOURCE_COLLECTIONS.map(([name], index) => [name, pages[index].length]));
  const sourceDigest = createFinanceSourceDigest(sources);
  const closure = buildFinanceClosureSnapshot({
    periodId: range.periodId,
    records: daily.map(row => ({ id: row.id, ...row.data })),
    expenses: expenses.map(row => ({ id: row.id, ...row.data })),
    scrapRequests: scraps.map(row => ({ id: row.id, ...row.data })),
    attendance: attendance.map(row => ({ id: row.id, ...row.data })),
    sourceCounts,
    sourceDigest
  });

  await closureRef.set({
    ...range,
    status: "closed",
    startedAt: (await closureRef.get()).get("startedAt") ?? FieldValue.serverTimestamp(),
    startedBy: (await closureRef.get()).get("startedBy") ?? request.auth.uid,
    closedAt: FieldValue.serverTimestamp(),
    closedBy: request.auth.uid,
    snapshot: closure.snapshot,
    sourceCounts,
    sourceDigest,
    schemaVersion: 1
  });
  return {
    periodId: range.periodId,
    status: "closed",
    sourceCounts,
    sourceDigest,
    companyProfit: closure.snapshot.finance.companyProfit
  };
});
