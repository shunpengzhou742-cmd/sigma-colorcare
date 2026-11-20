import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

const PROJECT = "demo-sigma-colorcare";
const REGION = "asia-southeast1";
const FUNCTIONS_URL = `http://127.0.0.1:5001/${PROJECT}/${REGION}/closeFinancePeriod`;
const AUTH_URL = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

async function jsonRequest(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function createAuthUser(email) {
  const { response, body } = await jsonRequest(`${AUTH_URL}/accounts:signUp?key=fake-api-key`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "TestPassword123!", returnSecureToken: true })
  });
  assert.equal(response.status, 200, JSON.stringify(body));
  return body;
}

async function callClosure(idToken, periodId) {
  const headers = { "content-type": "application/json" };
  if (idToken) headers.authorization = `Bearer ${idToken}`;
  return jsonRequest(FUNCTIONS_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: { periodId } })
  });
}

describe("closeFinancePeriod callable emulator integration", () => {
  let activeUser;
  let inactiveUser;
  let testEnv;

  before(async () => {
    testEnv = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: "127.0.0.1", port: 8080 } });
    activeUser = await createAuthUser("closure-admin@example.test");
    inactiveUser = await createAuthUser("inactive-admin@example.test");
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc(`admins/${activeUser.localId}`).set({ role: "admin", status: "active" });
      await context.firestore().doc(`admins/${inactiveUser.localId}`).set({ role: "admin", status: "inactive" });
    });
  });

  after(async () => { await testEnv?.cleanup(); });

  it("rejects unauthenticated callers", async () => {
    const { response, body } = await callClosure(null, "2026-09");
    assert.equal(response.status, 401, JSON.stringify(body));
    assert.equal(body.error?.status, "UNAUTHENTICATED");
  });

  it("rejects authenticated users without an active admin profile", async () => {
    const { response, body } = await callClosure(inactiveUser.idToken, "2026-09");
    assert.equal(response.status, 403, JSON.stringify(body));
    assert.equal(body.error?.status, "PERMISSION_DENIED");
  });

  it("closes an empty completed period and rejects duplicate closure", async () => {
    const first = await callClosure(activeUser.idToken, "2026-09");
    assert.equal(first.response.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.result?.status, "closed");
    assert.equal(first.body.result?.periodId, "2026-09");
    assert.match(first.body.result?.sourceDigest || "", /^[a-f0-9]{64}$/);

    const second = await callClosure(activeUser.idToken, "2026-09");
    assert.equal(second.response.status, 409, JSON.stringify(second.body));
    assert.equal(second.body.error?.status, "ALREADY_EXISTS");
  });

  it("rejects malformed and not-yet-completed periods", async () => {
    const malformed = await callClosure(activeUser.idToken, "2026-9");
    assert.equal(malformed.response.status, 400, JSON.stringify(malformed.body));
    const future = await callClosure(activeUser.idToken, "2099-12");
    assert.equal(future.response.status, 400, JSON.stringify(future.body));
    assert.equal(future.body.error?.status, "FAILED_PRECONDITION");
  });
});
