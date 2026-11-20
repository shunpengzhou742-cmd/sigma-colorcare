import test from "node:test";
import assert from "node:assert/strict";
import { getFinanceDateRange } from "../scripts/finance-period.mjs";

test("uses the real last day of February in leap and non-leap years", () => {
  assert.deepEqual(getFinanceDateRange("month", "2024-02-10"), ["2024-02-01", "2024-02-29"]);
  assert.deepEqual(getFinanceDateRange("month", "2025-02-10"), ["2025-02-01", "2025-02-28"]);
});

test("uses the real last day for 30-day months", () => {
  assert.deepEqual(getFinanceDateRange("month", "2026-04-20"), ["2026-04-01", "2026-04-30"]);
  assert.deepEqual(getFinanceDateRange("month", "2026-06-20"), ["2026-06-01", "2026-06-30"]);
});

test("returns the correct first or second half-year range", () => {
  assert.deepEqual(getFinanceDateRange("half", "2026-03-15"), ["2026-01-01", "2026-06-30"]);
  assert.deepEqual(getFinanceDateRange("half", "2026-11-20"), ["2026-07-01", "2026-12-31"]);
});

test("returns the calendar year and leaves custom dates to the user", () => {
  assert.deepEqual(getFinanceDateRange("year", "2026-11-20"), ["2026-01-01", "2026-12-31"]);
  assert.equal(getFinanceDateRange("custom", "2026-11-20"), null);
});

test("rejects invalid reference dates and unknown period types", () => {
  assert.throws(() => getFinanceDateRange("month", "2026-02-31"), /valid YYYY-MM-DD/);
  assert.throws(() => getFinanceDateRange("quarter", "2026-02-01"), /Unsupported finance period/);
});
