const DATE_PATTERN = /^(\\d{4})-(\\d{2})-(\\d{2})$/;

function parseDate(value) {
  if (typeof value !== "string") return null;
  const match = DATE_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return { year, month };
}

function formatDate(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getFinanceDateRange(mode, today) {
  const parsed = parseDate(today);
  if (!parsed) throw new TypeError("today must be a valid YYYY-MM-DD date");
  const { year, month } = parsed;
  if (mode === "month") {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return [formatDate(year, month, 1), formatDate(year, month, lastDay)];
  }
  if (mode === "half") {
    return month <= 6
      ? [formatDate(year, 1, 1), formatDate(year, 6, 30)]
      : [formatDate(year, 7, 1), formatDate(year, 12, 31)];
  }
  if (mode === "year") return [formatDate(year, 1, 1), formatDate(year, 12, 31)];
  if (mode === "custom") return null;
  throw new RangeError("Unsupported finance period: " + mode);
}
