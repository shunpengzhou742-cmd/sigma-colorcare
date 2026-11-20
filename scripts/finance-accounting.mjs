const GROUP_IDS = [1, 2, 3];
const EXPENSE_GROUP_IDS = [0, 1, 2, 3];

const RECORD_FIELDS = {
  revenue: { required: true },
  laborCost: { required: true },
  materialCost: { required: false },
  otherCost: { required: false },
  outputQuantity: { required: true, integer: true },
  unitPrice: { required: true },
  headcount: { required: true, integer: true },
  dailyWagePerPerson: { required: true },
  netProfit: { required: true, signed: true }
};

function readNumber(row, key, options = {}) {
  const source = row && typeof row === "object" ? row : {};
  if (!(key in source) && options.required === false) return { value: 0, valid: true };
  const raw = source[key];
  const hasNumericInput = typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "");
  const value = Number(raw);
  const valid = hasNumericInput && Number.isFinite(value)
    && (options.signed || value >= 0)
    && (!options.integer || Number.isInteger(value));
  return { value: valid ? value : 0, valid };
}

function normalizeRecords(records) {
  let invalidNumericCount = 0;
  let invalidNumericFieldCount = 0;
  const normalized = records.map(row => {
    const values = {};
    let valid = true;
    for (const [key, options] of Object.entries(RECORD_FIELDS)) {
      const parsed = readNumber(row, key, options);
      values[key] = parsed.value;
      if (!parsed.valid) {
        invalidNumericFieldCount += 1;
        valid = false;
      }
    }
    if (!valid) invalidNumericCount += 1;
    return { row, values, valid };
  });
  return { normalized, invalidNumericCount, invalidNumericFieldCount };
}

export function calculateFinanceSummary(records = [], expenses = []) {
  const { normalized: normalizedRecords, invalidNumericCount: invalidRecordNumbers, invalidNumericFieldCount } =
    normalizeRecords(records);
  let invalidExpenseNumbers = 0;
  let invalidExpenseFieldCount = 0;
  const normalizedExpenses = expenses.map(row => {
    const parsed = readNumber(row, "amount", { required: true });
    if (!parsed.valid || parsed.value <= 0) {
      invalidExpenseNumbers += 1;
      invalidExpenseFieldCount += 1;
    }
    return { row, amount: parsed.valid && parsed.value > 0 ? parsed.value : 0 };
  });
  const invalidNumericCount = invalidRecordNumbers + invalidExpenseNumbers;

  const sum = (rows, getter) => rows.reduce((total, row) => total + getter(row), 0);
  // Never let a partially malformed daily record affect the reported financial totals.
  const hasAllowedDepartment = (row, allowedIds) => row && typeof row === "object"
    && Number.isInteger(row.departmentId) && allowedIds.includes(row.departmentId);
  const validRecords = normalizedRecords.filter(item => item.valid && hasAllowedDepartment(item.row, GROUP_IDS));
  const validExpenses = normalizedExpenses.filter(item => hasAllowedDepartment(item.row, EXPENSE_GROUP_IDS));
  const revenue = sum(validRecords, item => item.values.revenue);
  const labor = sum(validRecords, item => item.values.laborCost);
  const materials = sum(validRecords, item => item.values.materialCost);
  const other = sum(validRecords, item => item.values.otherCost);
  const extra = sum(validExpenses, item => item.amount);

  const invalidDeptCount = records.filter(
    row => !hasAllowedDepartment(row, GROUP_IDS)
  ).length;
  const invalidExpenseCount = expenses.filter(
    row => !hasAllowedDepartment(row, EXPENSE_GROUP_IDS)
  ).length;
  const mathMismatchCount = normalizedRecords.filter(({ row, values, valid }) => valid && (
    Math.abs(values.revenue - values.outputQuantity * values.unitPrice) > 1 ||
    Math.abs(values.laborCost - values.headcount * values.dailyWagePerPerson) > 1 ||
    Math.abs(values.netProfit - (
      values.revenue - values.laborCost - values.materialCost - values.otherCost
    )) > 1
  )).length;

  const departments = GROUP_IDS.map(id => {
    const own = validRecords.filter(item => item.row.departmentId === id);
    const ownExpenses = validExpenses.filter(item => item.row.departmentId === id);
    const departmentRevenue = sum(own, item => item.values.revenue);
    const departmentLabor = sum(own, item => item.values.laborCost);
    const departmentMaterials = sum(own, item => item.values.materialCost);
    const departmentOther = sum(own, item => item.values.otherCost);
    const departmentExpenses = sum(ownExpenses, item => item.amount);
    const cost = departmentLabor + departmentMaterials + departmentOther + departmentExpenses;

    return {
      id,
      revenue: departmentRevenue,
      cost,
      profit: departmentRevenue - cost
    };
  });

  const sharedExpenses = sum(
    validExpenses.filter(item => item.row.departmentId === 0),
    item => item.amount
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
    invalidNumericCount,
    invalidNumericFieldCount: invalidNumericFieldCount + invalidExpenseFieldCount,
    mathMismatchCount,
    auditIssueCount: invalidDeptCount + invalidExpenseCount + invalidNumericCount +
      mathMismatchCount + (profitGap > 1 ? 1 : 0)
  };
}
