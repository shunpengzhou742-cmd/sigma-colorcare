import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { buildFinanceClosureSnapshot, createFinanceSourceDigest, getFinanceMonthRange } from "../functions/closure-core.mjs";

describe("Finance closure snapshot", () => {
  it("calculates valid calendar month boundaries including leap years", () => {
    assert.deepEqual(getFinanceMonthRange("2024-02"), {
      periodId: "2024-02", startDate: "2024-02-01", endDate: "2024-02-29"
    });
    assert.deepEqual(getFinanceMonthRange("2026-11"), {
      periodId: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30"
    });
    assert.throws(() => getFinanceMonthRange("2026-13"), /YYYY-MM/);
  });

  it("creates a deterministic digest independent of object key order and input order", () => {
    const a = createFinanceSourceDigest({
      dailyRecords: [{ id: "b", data: { z: 2, a: 1 } }, { id: "a", data: { x: 3 } }]
    });
    const b = createFinanceSourceDigest({
      dailyRecords: [{ id: "a", data: { x: 3 } }, { id: "b", data: { a: 1, z: 2 } }]
    });
    assert.equal(a, b);
    assert.match(a, /^[a-f0-9]{64}$/);
    assert.notEqual(a, createFinanceSourceDigest({ dailyRecords: [{ id: "b", data: { z: 9, a: 1 } }, { id: "a", data: { x: 3 } }] }));
  });

  it("stores three-group profit, shared expense once, payroll reconciliation and approved scrap only", () => {
    const records = [
      { workDate: "2026-10-02", departmentId: 1, revenue: 1000, laborCost: 100, materialCost: 50, otherCost: 0, outputQuantity: 10, unitPrice: 100, headcount: 1, dailyWagePerPerson: 100, netProfit: 850 },
      { workDate: "2026-10-02", departmentId: 2, revenue: 2000, laborCost: 200, materialCost: 100, otherCost: 0, outputQuantity: 20, unitPrice: 100, headcount: 1, dailyWagePerPerson: 200, netProfit: 1700 },
      { workDate: "2026-10-02", departmentId: 3, revenue: 3000, laborCost: 300, materialCost: 150, otherCost: 0, outputQuantity: 30, unitPrice: 100, headcount: 1, dailyWagePerPerson: 300, netProfit: 2550 }
    ];
    const result = buildFinanceClosureSnapshot({
      periodId: "2026-10", records,
      expenses: [{ departmentId: 0, amount: 100 }, { departmentId: 1, amount: 50 }],
      scrapRequests: [
        { departmentId: 1, quantity: 7, status: "approved" },
        { departmentId: 2, quantity: 5, status: "rejected" }
      ],
      attendance: [
        { id: "a", employeeUid: "u1", employeeName: "A", workDate: "2026-10-02", departmentId: 1, wageAmount: 100, payableDays: 1, dailyWage: 100 },
        { id: "b", employeeUid: "u2", employeeName: "B", workDate: "2026-10-02", departmentId: 2, wageAmount: 200, payableDays: 1, dailyWage: 200 },
        { id: "c", employeeUid: "u3", employeeName: "C", workDate: "2026-10-02", departmentId: 3, wageAmount: 300, payableDays: 1, dailyWage: 300 }
      ],
      sourceCounts: { dailyRecords: 3, operatingExpenses: 2 },
      sourceDigest: "a".repeat(64)
    });
    assert.equal(result.snapshot.finance.departments.length, 3);
    assert.equal(result.snapshot.finance.sharedExpenses, 100);
    assert.equal(result.snapshot.finance.companyProfit, 4950);
    assert.equal(result.snapshot.payrollReconciliation.payrollAmount, 600);
    assert.equal(result.snapshot.scrap.approvedQuantity, 7);
    assert.equal(result.snapshot.scrap.byDepartment[0].quantity, 7);
    assert.equal(result.sourceDigest, "a".repeat(64));
  });
});
