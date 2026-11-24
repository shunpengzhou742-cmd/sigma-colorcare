import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const moduleMatch = html.match(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/i);
assert.ok(moduleMatch, "index.html must contain its application module");
const moduleSource = moduleMatch[1];
const start = moduleSource.indexOf("const VIETNAM_TIME_ZONE");
const end = moduleSource.indexOf("function updateHolidayThemeBanner");
assert.ok(start >= 0 && end > start, "Vietnam holiday calendar source must be present");
const holidaySource = moduleSource.slice(start, end);
const api = new Function(holidaySource + `
  return {
    getVietnamHolidaySchedule,
    findVietnamLunarDate,
    vietnamDateParts,
    setSettings(value) { holidayThemeSettings = value; },
    defaultSettings: DEFAULT_HOLIDAY_THEME_SETTINGS
  };
`)();

test("Vietnamese Lunar New Year 2027 is February 6", () => {
  assert.equal(api.findVietnamLunarDate(2027, 1, 1), "2027-02-06");
});

test("Tet theme starts exactly three days before and lasts through day seven after", () => {
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:2}), null);
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:3})?.id, "tet");
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:6})?.id, "tet");
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:13})?.id, "tet");
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:14}), null);
});

test("Vietnamese lunar holidays resolve to expected 2027 solar dates", () => {
  assert.equal(api.findVietnamLunarDate(2027, 3, 10), "2027-04-16");
  assert.equal(api.findVietnamLunarDate(2027, 8, 15), "2027-09-15");
  assert.equal(api.findVietnamLunarDate(2027, 5, 5), "2027-06-09");
});

test("fixed-date Vietnamese observances switch theme three days in advance", () => {
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:8,day:29}), null);
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:8,day:30})?.id, "national");
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:9,day:2})?.id, "national");
});

test("Vietnam local date is derived from Asia/Ho_Chi_Minh, not UTC", () => {
  const parts = api.vietnamDateParts(new Date("2027-02-05T17:30:00.000Z"));
  assert.deepEqual(parts, {year:2027,month:2,day:6});
});

test("admin holiday settings control enabled holidays and advance days", () => {
  api.setSettings({ enabledHolidayIds: ["mid-autumn"], advanceDays: 5 });
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:3}), null);
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:9,day:10})?.id, "mid-autumn");
  api.setSettings({ enabledHolidayIds: ["tet"], advanceDays: 0 });
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:3}), null);
  assert.equal(api.getVietnamHolidaySchedule({year:2027,month:2,day:6})?.id, "tet");
  api.setSettings({ enabledHolidayIds: [...api.defaultSettings.enabledHolidayIds], advanceDays: 3 });
});
