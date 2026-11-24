import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const match = html.match(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/i);
if (!match) throw new Error("Could not find the main module script in index.html");

if (html.includes("#invitePanel,#employeeManagePanel{display:block!important}")) {
  throw new Error("Admin-only panels must not override the hidden class.");
}
if (!html.includes('classList.toggle("hidden", identity.role !== "admin")')) {
  throw new Error("Admin-only panels must be hidden for non-admin users.");
}

// Guard the interactive calendar's bilingual UI and Vietnam-local date context.
const viStart = html.indexOf("  vi: {");
const viEnd = html.indexOf("\n  }\n};", viStart);
if (viStart < 0 || viEnd < 0) throw new Error("Could not locate the Vietnamese translation dictionary.");
const viTranslations = html.slice(viStart, viEnd);
for (const key of ["calendarTitle", "calendarPrev", "calendarNext", "calendarToday", "calendarSelected", "calendarNoData", "calendarWeekdays"]) {
  if (!new RegExp("\\b" + key + "\\s*:").test(viTranslations)) {
    throw new Error("Missing Vietnamese calendar translation: " + key);
  }
}
for (const phrase of ["所选日期的工单数据", "所选日期已提交的修色、清洗和修织工单"]) {
  if (!html.includes(phrase)) throw new Error("Calendar status text does not describe selected-date data: " + phrase);
}
if (!html.includes('let dashboardCalendarMonth=new Date(localWorkDate()+"T12:00:00");')) {
  throw new Error("Calendar initial month must use the Asia/Ho_Chi_Minh work date.");
}
if (!html.includes('btn.setAttribute("aria-label",key+(lang==="zh"')) {
  throw new Error("Calendar day buttons must expose accessible date and quantity labels.");
}
if (!html.includes('#appView .module-page input[type="checkbox"]')) {
  throw new Error("Checkbox controls must keep their dedicated compact sizing rule.");
}

const tempUrl = new URL("../.index-syntax-check.mjs", import.meta.url);
const tempPath = fileURLToPath(tempUrl);
try {
  await writeFile(tempPath, match[1], "utf8");
  const result = spawnSync(process.execPath, ["--check", tempPath], { stdio: "inherit" });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else console.log("index.html module JavaScript syntax is valid.");
} finally {
  await unlink(tempPath).catch(() => {});
}
