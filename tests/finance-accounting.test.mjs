import test from "node:test";
import assert from "node:assert/strict";
import { calculateFinanceSummary } from "../scripts/finance-accounting.mjs";

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
  assert.equal(result.profitGap, 50);
  assert.equal(result.auditIssueCount, 3);
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

  assert.equal(result.invalidNumericCount, 5);
  assert.equal(result.revenue, 1800, "malformed daily records must not affect revenue");
  assert.equal(result.labor, 350, "malformed daily records must not affect labor");
  assert.equal(result.materials, 80, "malformed daily records must not affect materials");
  assert.equal(result.companyProfit, 1355, "malformed daily records must not affect reported group profit");
  assert.ok(Number.isFinite(result.revenue));
  assert.ok(Number.isFinite(result.companyProfit));
  assert.ok(Number.isFinite(result.overallProfit));
  assert.equal(result.auditIssueCount, 5);
});

test("returns zeroed totals for an empty period", () => {
  const result = calculateFinanceSummary([], []);

  assert.equal(result.revenue, 0);
  assert.equal(result.extra, 0);
  assert.deepEqual(result.departments.map(row => row.profit), [0, 0, 0]);
  assert.equal(result.companyProfit, 0);
  assert.equal(result.auditIssueCount, 0);
});
