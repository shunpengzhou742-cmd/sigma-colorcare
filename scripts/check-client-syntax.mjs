import { readFile, writeFile, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const match = html.match(/<script\s+type=["']module["']\s*>([\s\S]*?)<\/script>/i);
if (!match) throw new Error("Could not find the main module script in index.html");

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
