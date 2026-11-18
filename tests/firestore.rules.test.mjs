import { readFile } from "node:fs/promises";
import { after, before, beforeEach, describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  setDoc
} from "firebase/firestore";

const projectId = "demo-sigma-colorcare";
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL("../firestore.rules", import.meta.url), "utf8")
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), "admins/admin-1"), {
      role: "admin",
      status: "active"
    });
    await setDoc(doc(context.firestore(), "employeeInvites/invite-valid"), {
      departmentIds: [1],
      repairTypeIds: [101, 102],
      status: "active",
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000)),
      createdAt: Timestamp.now(),
      createdBy: "admin-1",
      usedBy: null,
      usedAt: null
    });
  });
});

after(async () => {
  await testEnv.cleanup();
});

function adminDb() {
  return testEnv.authenticatedContext("admin-1").firestore();
}

function googleDb(uid = "employee-1", email = "employee@example.com") {
  return testEnv.authenticatedContext(uid, {
    email,
    email_verified: true,
    firebase: { sign_in_provider: "google.com" }
  }).firestore();
}

function employeeData(uid, email, departments = [1], repairTypes = [101, 102]) {
  return {
    uid,
    name: "Test Employee",
    email,
    roleType: 1,
    status: "active",
    departmentIds: departments,
    repairTypeIds: repairTypes,
    specialRole: false,
    invitationId: "invite-valid",
    createdAt: serverTimestamp(),
    createdBy: "admin-1",
    updatedAt: serverTimestamp()
  };
}

describe("SIGMA employee invitation Firestore rules", () => {
  it("allows an active admin to create a valid one-day invitation", async () => {
    const db = adminDb();
    await assertSucceeds(setDoc(doc(db, "employeeInvites/new-invite"), {
      departmentIds: [2],
      repairTypeIds: [],
      status: "active",
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 12 * 60 * 60 * 1000)),
      createdAt: serverTimestamp(),
      createdBy: "admin-1",
      usedBy: null,
      usedAt: null
    }));
  });

  it("rejects a normal Google employee creating an invitation", async () => {
    const db = googleDb();
    await assertFails(setDoc(doc(db, "employeeInvites/forbidden"), {
      departmentIds: [1],
      repairTypeIds: [101, 102],
      status: "active",
      expiresAt: Timestamp.fromDate(new Date(Date.now() + 60 * 60 * 1000)),
      createdAt: serverTimestamp(),
      createdBy: "employee-1",
      usedBy: null,
      usedAt: null
    }));
  });

  it("atomically consumes an invitation and creates an active employee profile", async () => {
    const db = googleDb();
    const inviteRef = doc(db, "employeeInvites/invite-valid");
    const employeeRef = doc(db, "employees/employee-1");

    await assertSucceeds(runTransaction(db, async transaction => {
      const inviteSnap = await transaction.get(inviteRef);
      const employeeSnap = await transaction.get(employeeRef);
      assert.equal(inviteSnap.exists(), true);
      assert.equal(employeeSnap.exists(), false);
      transaction.update(inviteRef, {
        status: "used",
        usedBy: "employee-1",
        usedAt: serverTimestamp()
      });
      transaction.set(employeeRef, employeeData("employee-1", "employee@example.com"));
    }));

    const profile = await getDoc(employeeRef);
    assert.equal(profile.data().status, "active");
    assert.deepEqual(profile.data().departmentIds, [1]);
  });

  it("rejects a second UID trying to consume the same invitation", async () => {
    const firstDb = googleDb("employee-1", "employee@example.com");
    const inviteRef = doc(firstDb, "employeeInvites/invite-valid");
    const employeeRef = doc(firstDb, "employees/employee-1");

    await assertSucceeds(runTransaction(firstDb, async transaction => {
      const inviteSnap = await transaction.get(inviteRef);
      transaction.update(inviteRef, {
        status: "used",
        usedBy: "employee-1",
        usedAt: serverTimestamp()
      });
      transaction.set(employeeRef, employeeData("employee-1", "employee@example.com"));
      assert.equal(inviteSnap.exists(), true);
    }));

    const secondDb = googleDb("employee-2", "second@example.com");
    await assertFails(runTransaction(secondDb, async transaction => {
      const secondInviteRef = doc(secondDb, "employeeInvites/invite-valid");
      const secondEmployeeRef = doc(secondDb, "employees/employee-2");
      const inviteSnap = await transaction.get(secondInviteRef);
      transaction.update(secondInviteRef, {
        status: "used",
        usedBy: "employee-2",
        usedAt: serverTimestamp()
      });
      transaction.set(secondEmployeeRef, employeeData("employee-2", "second@example.com"));
      assert.equal(inviteSnap.exists(), true);
    }));
  });

  it("rejects a non-Google user claiming an invitation", async () => {
    const db = testEnv.authenticatedContext("password-user", {
      email: "password@example.com",
      email_verified: true,
      firebase: { sign_in_provider: "password" }
    }).firestore();
    await assertFails(getDoc(doc(db, "employeeInvites/invite-valid")));
  });

  it("allows an employee to read only their own profile", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1",
        roleType: 1,
        status: "active",
        departmentIds: [1]
      });
      await setDoc(doc(context.firestore(), "employees/employee-2"), {
        uid: "employee-2",
        roleType: 1,
        status: "active",
        departmentIds: [2]
      });
    });
    const db = googleDb();
    await assertSucceeds(getDoc(doc(db, "employees/employee-1")));
    await assertFails(getDoc(doc(db, "employees/employee-2")));
  });

  it("rejects employees updating their own profile", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1",
        roleType: 1,
        status: "active",
        departmentIds: [1]
      });
    });
    const db = googleDb();
    await assertFails(setDoc(doc(db, "employees/employee-1"), {
      uid: "employee-1",
      roleType: 0,
      status: "active",
      departmentIds: [1, 2, 3]
    }));
  });
});
