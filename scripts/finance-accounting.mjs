const GROUP_IDS = [1, 2, 3];
const EXPENSE_GROUP_IDS = [0, 1, 2, 3];

const sumBy = (rows, key) =>
  rows.reduce((total, row) => total + Number(row[key] || 0), 0);

export function calculateFinanceSummary(records = [], expenses = []) {
  const revenue = sumBy(records, "revenue");
  const labor = sumBy(records, "laborCost");
  const materials = sumBy(records, "materialCost");
  const other = sumBy(records, "otherCost");
  const extra = sumBy(expenses, "amount");

  const invalidDeptCount = records.filter(
    row => !GROUP_IDS.includes(Number(row.departmentId))
  ).length;
  const invalidExpenseCount = expenses.filter(
    row => !EXPENSE_GROUP_IDS.includes(Number(row.departmentId))
  ).length;
  const mathMismatchCount = records.filter(row =>
    Math.abs(Number(row.revenue || 0) - Number(row.outputQuantity || 0) * Number(row.unitPrice || 0)) > 1 ||
    Math.abs(Number(row.laborCost || 0) - Number(row.headcount || 0) * Number(row.dailyWagePerPerson || 0)) > 1 ||
    Math.abs(Number(row.netProfit || 0) - (
      Number(row.revenue || 0) -
      Number(row.laborCost || 0) -
      Number(row.materialCost || 0) -
      Number(row.otherCost || 0)
    )) > 1
  ).length;

  const departments = GROUP_IDS.map(id => {
    const own = records.filter(row => Number(row.departmentId) === id);
    const ownExpenses = expenses.filter(row => Number(row.departmentId) === id);
    const departmentRevenue = sumBy(own, "revenue");
    const departmentLabor = sumBy(own, "laborCost");
    const departmentMaterials = sumBy(own, "materialCost");
    const departmentOther = sumBy(own, "otherCost");
    const departmentExpenses = sumBy(ownExpenses, "amount");
    const cost = departmentLabor + departmentMaterials + departmentOther + departmentExpenses;

    return {
      id,
      revenue: departmentRevenue,
      cost,
      profit: departmentRevenue - cost
    };
  });

  const sharedExpenses = sumBy(
    expenses.filter(row => !GROUP_IDS.includes(Number(row.departmentId))),
    "amount"
  );
  const departmentProfit = departments.reduce((total, row) => total + row.profit, 0);
  const companyProfit = departmentProfit - sharedExpenses;
  const overallProfit = revenue - labor - materials - other - extra;
  const profitGap = Math.abs(companyProfit - overallProfit);

  return {
    revenue,
    labor,
    materials,
    other,
    extra,
    departments,
    sharedExpenses,
    departmentProfit,
    companyProfit,
    overallProfit,
    profitGap,
    invalidDeptCount,
    invalidExpenseCount,
    mathMismatchCount,
    auditIssueCount: invalidDeptCount + invalidExpenseCount + mathMismatchCount + (profitGap > 1 ? 1 : 0)
  };
}
