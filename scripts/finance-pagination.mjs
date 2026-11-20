export async function collectPaginatedDocuments(fetchPage, pageSize = 250) {
  if (typeof fetchPage !== "function") throw new TypeError("fetchPage must be a function");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("pageSize must be a positive integer");

  const documents = [];
  let cursor = null;
  let lastCursorId = null;

  while (true) {
    const page = await fetchPage(cursor, pageSize);
    const pageDocuments = Array.isArray(page?.docs) ? page.docs : null;
    if (!pageDocuments) throw new TypeError("fetchPage must return an object with a docs array");

    documents.push(...pageDocuments);
    if (pageDocuments.length < pageSize) break;

    const nextCursor = pageDocuments[pageDocuments.length - 1];
    if (!nextCursor || typeof nextCursor.id !== "string" || nextCursor.id === lastCursorId) {
      throw new Error("FINANCE_PAGINATION_CURSOR_STALLED");
    }
    cursor = nextCursor;
    lastCursorId = nextCursor.id;
  }

  return documents;
}
