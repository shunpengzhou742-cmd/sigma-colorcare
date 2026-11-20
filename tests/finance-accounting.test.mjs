import test from "node:test";
import assert from "node:assert/strict";
import { calculateFinanceSummary, calculatePayrollReconciliation } from "../scripts/finance-accounting.mjs";

const records = [
  { departmentId: 1, revenue: 1000, outputQuantity: 100, unitPrice: 10, laborCost: 200, headcount: 2, dailyWagePerPerson: 100, materialCost: 50, otherCost: 10, netProfit: 740 },
  { departmentId: 2, revenue: 500, outputQuantity: 50, unitPrice: 10, laborCost: 100, headcount: 1, dailyWagePerPerson: 100, materialCost: 20, otherCost: 5, netProfit: 375 },
  { departmentId: 3, revenue: 300, outputQuantity: 30, unitPrice: 10, laborCost: 50, headcount: 1, dailyWagePerPerson: 50, materialCost: 10, otherCost: 0, netProfit: 240 }
];

test("calculates each group's profit and subtracts shared expenses once", () => {
  const expenses = [
    { departmentId: 1, amount: 40 },
    { departmentId: 2, amount: 20 },
    { departmentId: 0, amount: 100 }
  ];
  const result = calculateFinanceSummary(records, expenses);

  assert.deepEqual(result.departments.map(row => row.profit), [700, 355, 240]);
  assert.equal(result.sharedExpenses, 100);
  assert.equal(result.departmentProfit, 1295);
  assert.equal(result.companyProfit, 1195);
  assert.equal(result.overallProfit, 1195);
  assert.equal(result.profitGap, 0);
  assert.equal(result.auditIssueCount, 0);
});

test("keeps group expenses in their own group and includes all expenses in company costs", () => {
  const expenses = [
    { departmentId: 1, amount: 40 },
    { departmentId: 2, amount: 20 },
    { departmentId: 3, amount: 30 },
    { departmentId: 0, amount: 100 }
  ];
  const result = calculateFinanceSummary(records, expenses);

  assert.deepEqual(result.departments.map(row => row.cost), [300, 145, 90]);
  assert.equal(result.sharedExpenses, 100);
  assert.equal(result.extra, 190);
  assert.equal(result.companyProfit, 1165);
  assert.equal(result.overallProfit, 1165);
});

test("flags invalid group IDs and inconsistent daily calculations", () => {
  const malformed = [
    ...records,
    { departmentId: 9, revenue: 50, outputQuantity: 5, unitPrice: 10, laborCost: 0, headcount: 0, dailyWagePerPerson: 0, materialCost: 0, otherCost: 0, netProfit: 50 }
  ];
  const expenses = [{ departmentId: 8, amount: 25 }];
  const result = calculateFinanceSummary(malformed, expenses);

  assert.equal(result.invalidDeptCount, 1);
  assert.equal(result.invalidExpenseCount, 1);
  assert.equal(result.mathMismatchCount, 0);
  assert.equal(result.revenue, 1800, "invalid department records must not affect revenue");
  assert.equal(result.extra, 0, "invalid expense groups must not affect costs");
  assert.equal(result.companyProfit, 1355, "invalid department and expense records must be excluded");
  assert.equal(result.profitGap, 0);
  assert.equal(result.auditIssueCount, 2);
});

test("flags malformed numeric fields without allowing NaN to corrupt totals", () => {
  const malformedRecords = [
    ...records,
    {
      ...records[0],
      revenue: "not-a-number",
      unitPrice: "invalid",
      netProfit: "invalid",
      materialCost: null
    }
  ];
  const result = calculateFinanceSummary(
    malformedRecords,
    [{ departmentId: 0, amount: "invalid" }]
  );

  assert.equal(result.invalidNumericCount, 2);
  assert.equal(result.invalidNumericFieldCount, 5);
  assert.equal(result.revenue, 1800, "malformed daily records must not affect revenue");
  assert.equal(result.labor, 350, "malformed daily records must not affect labor");
  assert.equal(result.materials, 80, "malformed daily records must not affect materials");
  assert.equal(result.companyProfit, 1355, "malformed daily records must not affect reported group profit");
  assert.ok(Number.isFinite(result.revenue));
  assert.ok(Number.isFinite(result.companyProfit));
  assert.ok(Number.isFinite(result.overallProfit));
  assert.equal(result.auditIssueCount, 2);
});

test("rejects malformed expense department IDs instead of treating them as shared costs", () => {
  const expenses = [
    { departmentId: 0, amount: 100 },
    { departmentId: null, amount: 20 },
    { departmentId: "", amount: 30 },
    { departmentId: "0", amount: 40 },
    { amount: 50 }
  ];
  const result = calculateFinanceSummary(records, expenses);

  assert.equal(result.sharedExpenses, 100);
  assert.equal(result.extra, 100);
  assert.equal(result.invalidExpenseCount, 4);
  assert.equal(result.companyProfit, 1255);
  assert.equal(result.auditIssueCount, 4);
});

test("rejects string department IDs and safely audits non-object records", () => {
  const result = calculateFinanceSummary(
    [...records, { ...records[0], departmentId: "1" }, null],
    [{ departmentId: "1", amount: 60 }, null]
  );

  assert.equal(result.invalidDeptCount, 2);
  assert.equal(result.invalidExpenseCount, 2);
  assert.equal(result.invalidNumericCount, 2);
  assert.equal(result.revenue, 1800);
  assert.equal(result.extra, 0);
  assert.equal(result.auditIssueCount, 6);
});

test("returns zeroed totals for an empty period", () => {
  const result = calculateFinanceSummary([], []);

  assert.equal(result.revenue, 0);
  assert.equal(result.extra, 0);
  assert.deepEqual(result.departments.map(row => row.profit), [0, 0, 0]);
  assert.equal(result.companyProfit, 0);
  assert.equal(result.auditIssueCount, 0);
});


test("reconciles payroll attendance separately without changing daily accounting costs", () => {
  const result = calculatePayrollReconciliation(
    [
      { departmentId: 1, laborCost: 200000 },
      { departmentId: 2, laborCost: 100000 },
      { departmentId: 3, laborCost: 50000 }
    ],
    [
      { departmentId: 1, wageAmount: 175000 },
      { departmentId: 1, wageAmount: 25000 },
      { departmentId: 2, wageAmount: 90000 },
      { departmentId: 3, wageAmount: 50000 }
    ]
  );

  assert.equal(result.accountingLabor, 350000);
  assert.equal(result.payrollAmount, 340000);
  assert.equal(result.difference, -10000);
  assert.deepEqual(result.groups.map(row => row.difference), [0, -10000, 0]);
  assert.equal(result.invalidAttendanceCount, 0);
  assert.equal(result.hasAttendance, true);
});

test("does not count malformed payroll rows or treat payroll as an extra expense", () => {
  const result = calculatePayrollReconciliation(
    [{ departmentId: 1, laborCost: 100000 }],
    [
      { departmentId: 1, wageAmount: 100000 },
      { departmentId: 9, wageAmount: 50000 },
      { departmentId: 2, wageAmount: "bad" }
    ]
  );

  assert.equal(result.accountingLabor, 100000);
  assert.equal(result.payrollAmount, 100000);
  assert.equal(result.difference, 0);
  assert.equal(result.invalidAttendanceCount, 2);
});
