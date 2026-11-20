import test from "node:test";
import assert from "node:assert/strict";
import { collectPaginatedDocuments } from "../scripts/finance-pagination.mjs";

function makeDocuments(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: "doc-" + String(index + 1).padStart(4, "0"),
    workDate: "2026-11-" + String(1 + Math.floor(index / 300)).padStart(2, "0")
  }));
}

function makeFetcher(allDocuments, calls) {
  return async (cursor, pageSize) => {
    calls.push({ cursorId: cursor?.id ?? null, pageSize });
    const start = cursor ? allDocuments.findIndex(row => row.id === cursor.id) + 1 : 0;
    return { docs: allDocuments.slice(start, start + pageSize) };
  };
}

test("collects every document across multiple pages without gaps or duplicates", async () => {
  const source = makeDocuments(600);
  const calls = [];
  const result = await collectPaginatedDocuments(makeFetcher(source, calls), 250);

  assert.equal(result.length, 600);
  assert.deepEqual(result.map(row => row.id), source.map(row => row.id));
  assert.deepEqual(calls.map(call => call.cursorId), [null, "doc-0250", "doc-0500"]);
});

test("continues safely when many documents share the same date", async () => {
  const source = Array.from({ length: 275 }, (_, index) => ({
    id: "same-day-" + String(index + 1).padStart(4, "0"),
    workDate: "2026-11-21"
  }));
  const calls = [];
  const result = await collectPaginatedDocuments(makeFetcher(source, calls), 250);

  assert.equal(result.length, 275);
  assert.deepEqual(result.map(row => row.id), source.map(row => row.id));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursorId, "same-day-0250");
});

test("requests a final empty page when the result count is an exact page multiple", async () => {
  const source = makeDocuments(500);
  const calls = [];
  const result = await collectPaginatedDocuments(makeFetcher(source, calls), 250);

  assert.equal(result.length, 500);
  assert.equal(calls.length, 3);
  assert.equal(calls[2].cursorId, "doc-0500");
});

test("returns an empty result for an empty first page", async () => {
  let calls = 0;
  const result = await collectPaginatedDocuments(async () => {
    calls += 1;
    return { docs: [] };
  }, 250);

  assert.deepEqual(result, []);
  assert.equal(calls, 1);
});

test("rejects a repeated cursor instead of looping forever", async () => {
  const repeated = { id: "same-cursor" };
  await assert.rejects(
    collectPaginatedDocuments(async () => ({ docs: Array(2).fill(repeated) }), 2),
    /FINANCE_PAGINATION_CURSOR_STALLED/
  );
});

test("validates page size and fetcher contract", async () => {
  await assert.rejects(collectPaginatedDocuments(null), /fetchPage must be a function/);
  await assert.rejects(collectPaginatedDocuments(async () => ({ docs: [] }), 0), /positive integer/);
  await assert.rejects(
    collectPaginatedDocuments(async () => ({ items: [] })),
    /docs array/
  );
});
