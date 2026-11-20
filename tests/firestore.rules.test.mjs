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
  setDoc,
  updateDoc,
  getDocs,
  collection,
  query,
  where,
  limit
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
  it("allows an active repair employee to create a batch work order", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com"));
    });
    const db = googleDb();
    const { addDoc, collection } = await import("firebase/firestore");
    await assertSucceeds(addDoc(collection(db, "repairWorkOrders"), {
      employeeUid: "employee-1",
      createdBy: "employee-1",
      departmentId: 1,
      repairTypeId: 101,
      workDate: "2026-11-18",
      orderNo: "AS-001",
      styleNo: "STYLE-01",
      color: "Navy",
      quantity: 120,
      note: "",
      status: "submitted",
      createdAt: serverTimestamp()
    }));
  });

  it("rejects repair work orders submitted for another employee", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com"));
    });
    const { addDoc, collection } = await import("firebase/firestore");
    await assertFails(addDoc(collection(googleDb(), "repairWorkOrders"), {
      employeeUid: "employee-2", createdBy: "employee-1", departmentId: 1,
      repairTypeId: 101, workDate: "2026-11-18", orderNo: "", styleNo: "",
      color: "", quantity: 10, note: "", status: "submitted", createdAt: serverTimestamp()
    }));
  });

  it("rejects a repair employee submitting a department they are not authorized for", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [2], []));
    });
    const { addDoc, collection } = await import("firebase/firestore");
    await assertFails(addDoc(collection(googleDb(), "repairWorkOrders"), {
      employeeUid: "employee-1", createdBy: "employee-1", departmentId: 1,
      repairTypeId: 101, workDate: "2026-11-18", orderNo: "", styleNo: "",
      color: "", quantity: 10, note: "", status: "submitted", createdAt: serverTimestamp()
    }));
  });

  it("rejects a repair employee using an unauthorized repair subtype", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1], [101]));
    });
    const { addDoc, collection } = await import("firebase/firestore");
    await assertFails(addDoc(collection(googleDb(), "repairWorkOrders"), {
      employeeUid: "employee-1", createdBy: "employee-1", departmentId: 1,
      repairTypeId: 102, workDate: "2026-11-18", orderNo: "", styleNo: "",
      color: "", quantity: 10, note: "", status: "submitted", createdAt: serverTimestamp()
    }));
  });

  it("rejects zero-quantity repair work orders", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com"));
    });
    const { addDoc, collection } = await import("firebase/firestore");
    await assertFails(addDoc(collection(googleDb(), "repairWorkOrders"), {
      employeeUid: "employee-1", createdBy: "employee-1", departmentId: 1,
      repairTypeId: 101, workDate: "2026-11-18", orderNo: "", styleNo: "",
      color: "", quantity: 0, note: "", status: "submitted", createdAt: serverTimestamp()
    }));
  });

  it("prevents employees from editing or deleting submitted repair work orders", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com"));
      await setDoc(doc(context.firestore(), "repairWorkOrders/order-1"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 1,
        repairTypeId: 101, workDate: "2026-11-18", orderNo: "", styleNo: "",
        color: "", quantity: 10, note: "", status: "submitted", createdAt: Timestamp.now()
      });
    });
    const { deleteDoc, updateDoc } = await import("firebase/firestore");
    const ref = doc(googleDb(), "repairWorkOrders/order-1");
    await assertFails(updateDoc(ref, { quantity: 20 }));
    await assertFails(deleteDoc(ref));
  });

  it("allows admins to read repair work orders but employees only their own", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com"));
      await setDoc(doc(context.firestore(), "employees/employee-2"), employeeData("employee-2", "second@example.com"));
      const row = { employeeUid: "employee-2", createdBy: "employee-2", departmentId: 1,
        repairTypeId: 101, workDate: "2026-11-18", orderNo: "", styleNo: "",
        color: "", quantity: 10, note: "", status: "submitted", createdAt: Timestamp.now() };
      await setDoc(doc(context.firestore(), "repairWorkOrders/order-2"), row);
    });
    const { getDoc, query, collection, where, getDocs } = await import("firebase/firestore");
    await assertSucceeds(getDoc(doc(adminDb(), "repairWorkOrders/order-2")));
    await assertFails(getDoc(doc(googleDb(), "repairWorkOrders/order-2")));
    const ownQuery = query(collection(googleDb(), "repairWorkOrders"), where("employeeUid", "==", "employee-1"), where("departmentId", "==", 1));
    await assertSucceeds(getDocs(ownQuery));
  });

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

  it("allows an admin to revoke an unused invitation", async () => {
    const { updateDoc } = await import("firebase/firestore");
    await assertSucceeds(updateDoc(doc(adminDb(), "employeeInvites/invite-valid"), {
      status: "revoked", revokedBy: "admin-1", revokedAt: serverTimestamp()
    }));
    await assertFails(getDoc(doc(googleDb(), "employeeInvites/invite-valid")));
  });

  it("prevents employees from revoking invitations and admins from revoking used invitations", async () => {
    const { updateDoc } = await import("firebase/firestore");
    await assertFails(updateDoc(doc(googleDb(), "employeeInvites/invite-valid"), {
      status: "revoked", revokedBy: "employee-1", revokedAt: serverTimestamp()
    }));
    await testEnv.withSecurityRulesDisabled(async context => {
      await updateDoc(doc(context.firestore(), "employeeInvites/invite-valid"), {
        status: "used", usedBy: "employee-2", usedAt: Timestamp.now()
      });
    });
    await assertFails(updateDoc(doc(adminDb(), "employeeInvites/invite-valid"), {
      status: "revoked", revokedBy: "admin-1", revokedAt: serverTimestamp()
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

  it("rejects reading an expired invitation", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employeeInvites/invite-expired"), {
        departmentIds: [1],
        repairTypeIds: [101, 102],
        status: "active",
        expiresAt: Timestamp.fromDate(new Date(Date.now() - 60 * 1000)),
        createdAt: Timestamp.now(),
        createdBy: "admin-1",
        usedBy: null,
        usedAt: null
      });
    });
    await assertFails(getDoc(doc(googleDb(), "employeeInvites/invite-expired")));
  });

  it("rejects an employee profile whose department differs from the invitation", async () => {
    const db = googleDb();
    const inviteRef = doc(db, "employeeInvites/invite-valid");
    const employeeRef = doc(db, "employees/employee-1");
    await assertFails(runTransaction(db, async transaction => {
      const inviteSnap = await transaction.get(inviteRef);
      assert.equal(inviteSnap.exists(), true);
      transaction.update(inviteRef, {
        status: "used",
        usedBy: "employee-1",
        usedAt: serverTimestamp()
      });
      transaction.set(employeeRef, employeeData("employee-1", "employee@example.com", [1, 2, 3]));
    }));
  });

  it("rejects an employee profile whose email does not match the verified Google account", async () => {
    const db = googleDb("employee-1", "employee@example.com");
    await assertFails(runTransaction(db, async transaction => {
      const inviteRef = doc(db, "employeeInvites/invite-valid");
      const inviteSnap = await transaction.get(inviteRef);
      assert.equal(inviteSnap.exists(), true);
      transaction.update(inviteRef, {
        status: "used", usedBy: "employee-1", usedAt: serverTimestamp()
      });
      transaction.set(doc(db, "employees/employee-1"),
        employeeData("employee-1", "someone-else@example.com"));
    }));
  });

  it("rejects an administrator Google account attempting to register as an employee", async () => {
    const db = googleDb("admin-1", "admin@example.com");
    await assertSucceeds(getDoc(doc(db, "employeeInvites/invite-valid")));
    await assertFails(setDoc(doc(db, "employees/admin-1"), {
      ...employeeData("admin-1", "admin@example.com")
    }));
  });

  it("rejects consuming an invitation without creating the employee profile", async () => {
    const db = googleDb();
    await assertFails(runTransaction(db, async transaction => {
      const inviteRef = doc(db, "employeeInvites/invite-valid");
      const inviteSnap = await transaction.get(inviteRef);
      assert.equal(inviteSnap.exists(), true);
      transaction.update(inviteRef, {
        status: "used",
        usedBy: "employee-1",
        usedAt: serverTimestamp()
      });
    }));
  });

  it("rejects creating an employee profile without consuming the invitation", async () => {
    const db = googleDb();
    await assertFails(setDoc(
      doc(db, "employees/employee-1"),
      employeeData("employee-1", "employee@example.com")
    ));
  });

  it("prevents employees from changing their own group access, status, or role flags", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", name: "Test Employee", email: "employee@example.com",
        roleType: 1, status: "active", departmentIds: [2],
        repairTypeIds: [], invitationId: "invite-valid",
        createdAt: Timestamp.now(), createdBy: "admin-1", updatedAt: Timestamp.now()
      });
    });
    const { updateDoc } = await import("firebase/firestore");
    const ref = doc(googleDb(), "employees/employee-1");
    await assertFails(updateDoc(ref, {
      departmentIds: [1, 2, 3], repairTypeIds: [101, 102],
      updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(ref, {
      status: "active", updatedAt: serverTimestamp()
    }));
  });

  it("allows an active admin to update employee departments and status", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1",
        name: "Test Employee",
        email: "employee@example.com",
        roleType: 1,
        status: "active",
        departmentIds: [1],
        repairTypeIds: [101, 102],
        invitationId: "invite-valid",
        createdAt: Timestamp.now(),
        createdBy: "admin-1",
        updatedAt: Timestamp.now()
      });
    });
    const db = adminDb();
    const { updateDoc } = await import("firebase/firestore");
    await assertSucceeds(updateDoc(doc(db, "employees/employee-1"), {
      departmentIds: [2, 3],
      repairTypeIds: [],
      status: "disabled",
      updatedAt: serverTimestamp()
    }));
  });

  it("rejects an admin changing immutable employee role fields", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1",
        name: "Test Employee",
        email: "employee@example.com",
        roleType: 1,
        status: "active",
        departmentIds: [1],
        repairTypeIds: [101, 102],
        invitationId: "invite-valid",
        createdAt: Timestamp.now(),
        createdBy: "admin-1",
        updatedAt: Timestamp.now()
      });
    });
    const db = adminDb();
    const { updateDoc } = await import("firebase/firestore");
    await assertFails(updateDoc(doc(db, "employees/employee-1"), {
      roleType: 0,
      departmentIds: [1],
      repairTypeIds: [101, 102],
      status: "active",
      updatedAt: serverTimestamp()
    }));
  });

  it("allows an active admin to list the employee directory", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1",
        name: "Test Employee",
        email: "employee@example.com",
        roleType: 1,
        status: "active",
        departmentIds: [1],
        repairTypeIds: [101, 102],
        invitationId: "invite-valid",
        createdAt: Timestamp.now(),
        createdBy: "admin-1",
        updatedAt: Timestamp.now()
      });
    });
    const { collection, getDocs } = await import("firebase/firestore");
    const snapshot = await assertSucceeds(getDocs(collection(adminDb(), "employees")));
    assert.equal(snapshot.size, 1);
  });

  it("rejects employees listing the employee directory", async () => {
    const { collection, getDocs } = await import("firebase/firestore");
    await assertFails(getDocs(collection(googleDb(), "employees")));
  });

  it("rejects employees deleting their own profile", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1",
        roleType: 1,
        status: "active",
        departmentIds: [1]
      });
    });
    const db = googleDb();
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(db, "employees/employee-1")));
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

describe("SIGMA financial privacy Firestore rules", () => {
  it("allows admins to read wage settings and daily accounting but blocks employee access", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "appSettings/departmentWages"), {
        rates: [{ departmentId: 1, effectiveDate: "2026-11-01", dailyWage: 350000 }]
      });
      await setDoc(doc(context.firestore(), "dailyRecords/2026-11-19_1"), {
        workDate: "2026-11-19", departmentId: 1, headcount: 3, outputQuantity: 300,
        unitPrice: 10000, dailyWagePerPerson: 200000, materialCost: 100000,
        otherCost: 50000, revenue: 3000000, laborCost: 600000,
        netProfit: 2250000, currency: "VND", createdBy: "admin-1",
        createdAt: Timestamp.now(), updatedAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", roleType: 1, status: "active", departmentIds: [1]
      });
    });
    const { getDoc } = await import("firebase/firestore");
    await assertSucceeds(getDoc(doc(adminDb(), "appSettings/departmentWages")));
    await assertSucceeds(getDoc(doc(adminDb(), "dailyRecords/2026-11-19_1")));
    await assertFails(getDoc(doc(googleDb(), "appSettings/departmentWages")));
    await assertFails(getDoc(doc(googleDb(), "dailyRecords/2026-11-19_1")));
  });

  it("validates daily accounting writes and preserves record identity metadata", async () => {
    const db = adminDb();
    const ref = doc(db, "dailyRecords/2026-11-20_1");
    const valid = {
      workDate: "2026-11-20", departmentId: 1, headcount: 2, outputQuantity: 300,
      unitPrice: 10000, dailyWagePerPerson: 200000, materialCost: 100000,
      otherCost: 50000, revenue: 3000000, laborCost: 400000,
      netProfit: 2450000, currency: "VND", createdBy: "admin-1", lastAuditLogId: null,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    await assertSucceeds(setDoc(ref, valid));
    await assertFails(updateDoc(ref, { outputQuantity: 400, updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(ref, {
      outputQuantity: 400, revenue: 4000000, netProfit: 3450000,
      workDate: "2026-11-21", updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(ref, {
      outputQuantity: 400, revenue: 4000000, netProfit: 3450000,
      createdBy: "attacker", updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(ref, {
      outputQuantity: 400, revenue: 4000000, netProfit: 3450000,
      departmentId: 2, updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(ref, {
      outputQuantity: 400, revenue: 4000000, netProfit: 3450000,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(ref, {
      outputQuantity: 400, revenue: 4000000, netProfit: 3450000,
      updatedAt: serverTimestamp()
    }));
    await assertSucceeds(runTransaction(db, async transaction => {
      const current = await transaction.get(ref);
      const before = current.data();
      const after = {
        ...before, outputQuantity: 400, revenue: 4000000, netProfit: 3450000,
        lastAuditLogId: "audit-2026-11-20-1", updatedAt: serverTimestamp()
      };
      transaction.update(ref, after);
      transaction.set(doc(db, "dailyRecordAuditLogs/audit-2026-11-20-1"), {
        recordId: ref.id, workDate: before.workDate, departmentId: before.departmentId,
        before, after, changedBy: "admin-1", changedAt: serverTimestamp()
      });
    }));
    await assertSucceeds(getDoc(doc(db, "dailyRecordAuditLogs/audit-2026-11-20-1")));
    await assertFails(runTransaction(db, async transaction => {
      const current = await transaction.get(ref);
      const before = current.data();
      const after = {
        ...before, outputQuantity: 500, revenue: 5000000, netProfit: 4450000,
        lastAuditLogId: "audit-wrong-metadata", updatedAt: serverTimestamp()
      };
      transaction.update(ref, after);
      transaction.set(doc(db, "dailyRecordAuditLogs/audit-wrong-metadata"), {
        recordId: ref.id, workDate: "2026-11-21", departmentId: before.departmentId,
        before, after, changedBy: "admin-1", changedAt: serverTimestamp()
      });
    }));
    await assertFails(getDoc(doc(googleDb(), "dailyRecordAuditLogs/audit-2026-11-20-1")));
    await assertFails(updateDoc(doc(db, "dailyRecordAuditLogs/audit-2026-11-20-1"), { changedBy: "attacker" }));
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(db, "dailyRecordAuditLogs/audit-2026-11-20-1")));
    await assertFails(setDoc(doc(db, "dailyRecordAuditLogs/forged"), {
      recordId: ref.id, workDate: "2026-11-20", departmentId: 1,
      before: valid, after: valid, changedBy: "admin-1", changedAt: serverTimestamp()
    }));
    await assertFails(setDoc(doc(googleDb(), "dailyRecords/2026-11-20_2"), {
      ...valid, departmentId: 2, createdBy: "employee-1"
    }));
    await assertFails(setDoc(doc(adminDb(), "dailyRecords/invalid"), {
      ...valid, departmentId: 9
    }));
    await assertFails(setDoc(doc(adminDb(), "dailyRecords/bad-date"), {
      ...valid, workDate: "2026-1-20"
    }));
    await assertFails(setDoc(doc(adminDb(), "dailyRecords/bad-timestamp"), {
      ...valid, createdAt: "not-a-timestamp"
    }));
  });

  it("allows only the admin to assign or revoke the special-role marker", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", name: "Test Employee", email: "employee@example.com",
        roleType: 1, status: "active", departmentIds: [1],
        repairTypeIds: [101, 102], specialRole: false,
        invitationId: "invite-valid", createdAt: Timestamp.now(),
        createdBy: "admin-1", updatedAt: Timestamp.now()
      });
    });
    const employeeRef = doc(googleDb(), "employees/employee-1");
    const adminRef = doc(adminDb(), "employees/employee-1");
    await assertFails(updateDoc(employeeRef, {
      specialRole: true, updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(adminRef, {
      specialRole: true, updatedAt: serverTimestamp()
    }));
    await assertSucceeds(updateDoc(adminRef, {
      specialRole: false, updatedAt: serverTimestamp()
    }));
  });

  it("does not grant extra access to an employee with the special-role marker", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        ...employeeData("employee-1", "employee@example.com"),
        specialRole: true
      });
      await setDoc(doc(context.firestore(), "dailyRecords/finance-private"), {
        workDate: "2026-11-20", departmentId: 1, headcount: 1, outputQuantity: 10,
        unitPrice: 10000, dailyWagePerPerson: 100000, materialCost: 0,
        otherCost: 0, revenue: 100000, laborCost: 100000,
        netProfit: 0, currency: "VND", createdBy: "admin-1",
        createdAt: Timestamp.now(), updatedAt: Timestamp.now()
      });
    });
    const db = googleDb();
    await assertFails(getDoc(doc(db, "dailyRecords/finance-private")));
    await assertFails(getDocs(collection(db, "employees")));
    await assertFails(setDoc(doc(db, "operatingExpenses/forbidden-special-role"), {
      expenseDate: "2026-11-20", category: "other", departmentId: 0,
      entryMode: "item", amount: 1000, note: "", currency: "VND",
      createdBy: "employee-1", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }));
  });
});

describe("SIGMA operating expense Firestore rules", () => {
  function expenseData(uid = "admin-1") {
    return {
      expenseDate: "2026-11-19",
      category: "utilities",
      departmentId: 0,
      entryMode: "item",
      amount: 250000,
      note: "Factory electricity",
      currency: "VND",
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
  }

  it("allows an active admin to create and read operating expenses", async () => {
    const db = adminDb();
    const { addDoc, collection, getDocs } = await import("firebase/firestore");
    await assertSucceeds(addDoc(collection(db, "operatingExpenses"), expenseData()));
    const snapshot = await assertSucceeds(getDocs(collection(db, "operatingExpenses")));
    assert.equal(snapshot.size, 1);
  });

  it("rejects employees from creating or reading operating expenses", async () => {
    const db = googleDb();
    const { addDoc, collection, getDocs } = await import("firebase/firestore");
    await assertFails(addDoc(collection(db, "operatingExpenses"), expenseData("employee-1")));
    await assertFails(getDocs(collection(db, "operatingExpenses")));
  });

  it("rejects invalid operating expense categories and non-positive amounts", async () => {
    const db = adminDb();
    const { addDoc, collection } = await import("firebase/firestore");
    await assertFails(addDoc(collection(db, "operatingExpenses"), {
      ...expenseData(),
      category: "unapproved"
    }));
    await assertFails(addDoc(collection(db, "operatingExpenses"), {
      ...expenseData(),
      amount: 0
    }));
  });

  it("rejects an admin creating an expense in another user's name", async () => {
    const db = adminDb();
    const { addDoc, collection } = await import("firebase/firestore");
    await assertFails(addDoc(collection(db, "operatingExpenses"), expenseData("someone-else")));
  });
});


describe("SIGMA washing and weaving work order Firestore rules", () => {
  async function seedEmployee(uid, departmentId) {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `employees/${uid}`), {
        uid, roleType: 1, status: "active", departmentIds: [departmentId]
      });
    });
  }

  function workOrderData(uid, departmentId) {
    return {
      employeeUid: uid, createdBy: uid, departmentId,
      workDate: "2026-11-19", orderNo: "ORD-01", styleNo: "STYLE-01",
      color: "Navy", quantity: 80, note: "", status: "submitted",
      createdAt: serverTimestamp()
    };
  }

  it("allows a cleaning employee to submit and read only cleaning work orders", async () => {
    await seedEmployee("employee-1", 2);
    const db = googleDb();
    const { addDoc, collection, getDocs, query, where } = await import("firebase/firestore");
    await assertSucceeds(addDoc(collection(db, "cleanWorkOrders"), workOrderData("employee-1", 2)));
    await assertSucceeds(getDocs(query(collection(db, "cleanWorkOrders"), where("employeeUid", "==", "employee-1"), where("departmentId", "==", 2))));
    await assertFails(addDoc(collection(db, "weaveWorkOrders"), workOrderData("employee-1", 3)));
  });

  it("blocks a disabled employee from reading and creating work orders", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", roleType: 1, status: "disabled", departmentIds: [2]
      });
      await setDoc(doc(context.firestore(), "cleanWorkOrders/disabled-order"), {
        ...workOrderData("employee-1", 2), createdAt: Timestamp.now()
      });
    });
    const db = googleDb();
    const { addDoc, collection, getDoc } = await import("firebase/firestore");
    await assertFails(getDoc(doc(db, "cleanWorkOrders/disabled-order")));
    await assertFails(addDoc(collection(db, "cleanWorkOrders"), workOrderData("employee-1", 2)));
  });

  it("prevents employees from reading another employee's profile", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", roleType: 1, status: "active", departmentIds: [2]
      });
      await setDoc(doc(context.firestore(), "employees/employee-2"), {
        uid: "employee-2", roleType: 1, status: "active", departmentIds: [2]
      });
    });
    const { getDoc } = await import("firebase/firestore");
    await assertFails(getDoc(doc(googleDb(), "employees/employee-2")));
    await assertSucceeds(getDoc(doc(googleDb(), "employees/employee-1")));
  });

  it("limits employees with multiple group assignments to only those assigned groups", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", roleType: 1, status: "active", departmentIds: [2, 3]
      });
      await setDoc(doc(context.firestore(), "cleanWorkOrders/own-clean-order"), {
        ...workOrderData("employee-1", 2), createdAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "weaveWorkOrders/own-weave-order"), {
        ...workOrderData("employee-1", 3), createdAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "repairWorkOrders/unassigned-repair-order"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 1,
        repairTypeId: 101, workDate: "2026-11-19", orderNo: "ORD-01",
        styleNo: "STYLE-01", color: "Navy", quantity: 10, note: "",
        status: "submitted", createdAt: Timestamp.now()
      });
    });
    const db = googleDb();
    const { getDoc } = await import("firebase/firestore");
    await assertSucceeds(getDoc(doc(db, "cleanWorkOrders/own-clean-order")));
    await assertSucceeds(getDoc(doc(db, "weaveWorkOrders/own-weave-order")));
    await assertFails(getDoc(doc(db, "repairWorkOrders/unassigned-repair-order")));
  });

  it("allows a weaving employee to submit and read only weaving work orders", async () => {
    await seedEmployee("employee-1", 3);
    const db = googleDb();
    const { addDoc, collection, getDocs, query, where } = await import("firebase/firestore");
    await assertSucceeds(addDoc(collection(db, "weaveWorkOrders"), workOrderData("employee-1", 3)));
    await assertSucceeds(getDocs(query(collection(db, "weaveWorkOrders"), where("employeeUid", "==", "employee-1"), where("departmentId", "==", 3))));
    await assertFails(addDoc(collection(db, "cleanWorkOrders"), workOrderData("employee-1", 2)));
  });

  it("prevents an employee from reading another employee's work order in the same group", async () => {
    await seedEmployee("employee-1", 2);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "cleanWorkOrders/other-employee-order"), {
        ...workOrderData("employee-2", 2), createdAt: Timestamp.now()
      });
    });
    await assertFails(getDoc(doc(googleDb(), "cleanWorkOrders/other-employee-order")));
  });

  it("rejects zero quantity and editing submitted cleaning work orders", async () => {
    await seedEmployee("employee-1", 2);
    const db = googleDb();
    const { addDoc, collection, updateDoc, getDocs } = await import("firebase/firestore");
    await assertFails(addDoc(collection(db, "cleanWorkOrders"), {
      ...workOrderData("employee-1", 2), quantity: 0
    }));
    const ref = doc(db, "cleanWorkOrders", "existing-order");
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "cleanWorkOrders/existing-order"), {
        ...workOrderData("employee-1", 2), createdAt: Timestamp.now()
      });
    });
    await assertFails(updateDoc(ref, { quantity: 90 }));
  });
});

describe("SIGMA operating expense edit permissions", () => {
  it("allows an admin to edit an expense without changing its creator or creation time", async () => {
    const createdAt = Timestamp.now();
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "operatingExpenses/expense-edit"), {
        expenseDate: "2026-11-19", category: "utilities", departmentId: 0,
        entryMode: "item", amount: 100000, note: "Before", currency: "VND",
        createdBy: "admin-1", createdAt, updatedAt: createdAt
      });
    });
    const db = adminDb();
    const { updateDoc } = await import("firebase/firestore");
    await assertSucceeds(updateDoc(doc(db, "operatingExpenses/expense-edit"), {
      expenseDate: "2026-11-19", category: "utilities", departmentId: 0,
      entryMode: "item", amount: 200000, note: "After", currency: "VND",
      createdBy: "admin-1", createdAt, updatedAt: serverTimestamp()
    }));
  });
  
  it("rejects an expense edit unless updatedAt is the server request time", async () => {
    const createdAt = Timestamp.now();
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "operatingExpenses/expense-stale-update"), {
        expenseDate: "2026-11-19", category: "utilities", departmentId: 0,
        entryMode: "item", amount: 100000, note: "Before", currency: "VND",
        createdBy: "admin-1", createdAt, updatedAt: createdAt
      });
    });
    const { updateDoc } = await import("firebase/firestore");
    await assertFails(updateDoc(doc(adminDb(), "operatingExpenses/expense-stale-update"), {
      expenseDate: "2026-11-19", category: "utilities", departmentId: 0,
      entryMode: "item", amount: 200000, note: "After", currency: "VND",
      createdBy: "admin-1", createdAt, updatedAt: createdAt
    }));
  });
});

describe("SIGMA scrap request Firestore rules", () => {
  async function seedDeptEmployee(uid, departmentId) {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `employees/${uid}`), {
        uid, roleType: 1, status: "active", departmentIds: [departmentId]
      });
    });
  }
  function requestData(uid, departmentId, scrap = false) {
    const data = {
      requestDate: "2026-11-19", departmentId, employeeUid: uid,
      createdBy: uid, orderNo: "ORD-SCRAP-01", styleNo: "STYLE-01",
      quantity: 12, note: "Batch ready", status: "submitted",
      createdAt: serverTimestamp()
    };
    if (scrap) data.reason = "Fabric damage";
    return data;
  }

  it("requires an employee-owned batch, caps scrap quantity, and permits only one request per batch", async () => {
    await seedDeptEmployee("employee-1", 2);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "cleanWorkOrders/clean-1"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 2,
        workDate: "2026-11-19", orderNo: "ORD-SCRAP-01", styleNo: "STYLE-01",
        color: "Navy", quantity: 12, note: "", status: "submitted", createdAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "cleanWorkOrders/clean-other"), {
        employeeUid: "employee-2", createdBy: "employee-2", departmentId: 2,
        workDate: "2026-11-19", orderNo: "ORD-OTHER", styleNo: "STYLE-02",
        color: "Black", quantity: 20, note: "", status: "submitted", createdAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "cleanWorkOrders/clean-2"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 2,
        workDate: "2026-11-19", orderNo: "ORD-SCRAP-02", styleNo: "STYLE-02",
        color: "Gray", quantity: 12, note: "", status: "submitted", createdAt: Timestamp.now()
      });
    });
    const db = googleDb();
    const id = "scrap_cleanWorkOrders_clean-1";
    const payload = {
      ...requestData("employee-1", 2, true), orderNo: "ORD-SCRAP-01", styleNo: "STYLE-01", quantity: 5,
      workOrderId: "clean-1", sourceCollection: "cleanWorkOrders"
    };
    await assertSucceeds(setDoc(doc(db, "scrapRequests", id), payload));
    await assertFails(setDoc(doc(db, "scrapRequests", id), {...payload, note: "duplicate"}));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_clean-other"), {
      ...payload, orderNo: "ORD-OTHER", styleNo: "STYLE-02", workOrderId: "clean-other"
    }));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_missing"), {
      ...payload, workOrderId: "missing"
    }));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_clean-2"), {
      ...payload, orderNo: "ORD-SCRAP-02", styleNo: "STYLE-02", workOrderId: "clean-2", quantity: 13
    }));
    const missingLink = {...payload};delete missingLink.workOrderId;delete missingLink.sourceCollection;
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_missing-link"), missingLink));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_bad-reason"), {...payload, reason: ""}));
  });

  it("blocks disabled employees from reading or submitting scrap requests", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", roleType: 1, status: "disabled", departmentIds: [2]
      });
      await setDoc(doc(context.firestore(), "cleanWorkOrders/disabled-scrap-source"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 2,
        workDate: "2026-11-19", orderNo: "ORD-DISABLED", styleNo: "STYLE-D",
        color: "Navy", quantity: 12, note: "", status: "submitted", createdAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "scrapRequests/scrap_cleanWorkOrders_disabled-scrap-source"), {
        ...requestData("employee-1", 2, true),
        workOrderId: "disabled-scrap-source", sourceCollection: "cleanWorkOrders"
      });
    });
    const db = googleDb();
    const { getDoc } = await import("firebase/firestore");
    await assertFails(getDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_disabled-scrap-source")));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_disabled-new"), {
      ...requestData("employee-1", 2, true),
      workOrderId: "disabled-scrap-source", sourceCollection: "cleanWorkOrders"
    }));
  });

  it("allows only an admin to approve or reject a batch-linked scrap request", async () => {
    await seedDeptEmployee("employee-1", 3);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "weaveWorkOrders/weave-1"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 3,
        workDate: "2026-11-19", orderNo: "ORD-SCRAP-03", styleNo: "STYLE-03",
        color: "White", quantity: 12, note: "", status: "submitted", createdAt: Timestamp.now()
      });
    });
    const employeeDb = googleDb();
    const { updateDoc } = await import("firebase/firestore");
    const id = "scrap_weaveWorkOrders_weave-1";
    await assertSucceeds(setDoc(doc(employeeDb, "scrapRequests", id), {
      ...requestData("employee-1", 3, true), orderNo: "ORD-SCRAP-03", styleNo: "STYLE-03", quantity: 3,
      workOrderId: "weave-1", sourceCollection: "weaveWorkOrders"
    }));
    await assertFails(updateDoc(doc(employeeDb, "scrapRequests", id), {
      status: "approved", reviewedBy: "employee-1", reviewedAt: serverTimestamp(), reviewNote: ""
    }));
    await assertFails(updateDoc(doc(adminDb(), "scrapRequests", id), {
      status: "rejected", reviewedBy: "admin-1", reviewedAt: serverTimestamp(), reviewNote: ""
    }));
    await assertSucceeds(updateDoc(doc(adminDb(), "scrapRequests", id), {
      status: "rejected", reviewedBy: "admin-1", reviewedAt: serverTimestamp(), reviewNote: "Please verify quantity"
    }));
    const { updateDoc: employeeUpdate } = await import("firebase/firestore");
    await assertSucceeds(employeeUpdate(doc(employeeDb, "scrapRequests", id), {
      requestDate: "2026-11-20", quantity: 2, reason: "Rechecked", note: "Updated",
      status: "submitted", updatedAt: serverTimestamp()
    }));
    await assertFails(employeeUpdate(doc(employeeDb, "scrapRequests", id), {
      status: "approved", reviewedBy: "employee-1", reviewedAt: serverTimestamp(), reviewNote: ""
    }));
    await assertSucceeds(updateDoc(doc(adminDb(), "scrapRequests", id), {
      status: "approved", reviewedBy: "admin-1", reviewedAt: serverTimestamp(), reviewNote: ""
    }));
    await assertFails(employeeUpdate(doc(employeeDb, "scrapRequests", id), {
      requestDate: "2026-11-21", quantity: 1, reason: "Again", note: "",
      status: "submitted", updatedAt: serverTimestamp()
    }));
  });
});


describe("SIGMA department workflow isolation from QC", () => {
  it("denies employees access to legacy QC requests and rework batches", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", roleType: 1, status: "active", departmentIds: [1]
      });
      await setDoc(doc(context.firestore(), "qcRequests/legacy-qc"), {
        employeeUid: "employee-1", departmentId: 1, status: "submitted"
      });
      await setDoc(doc(context.firestore(), "reworkWorkOrders/legacy-rework"), {
        employeeUid: "employee-1", departmentId: 1, status: "pending_rework"
      });
    });
    const db = googleDb();
    const { collection, getDocs } = await import("firebase/firestore");
    await assertFails(getDocs(collection(db, "qcRequests")));
    await assertFails(getDocs(collection(db, "reworkWorkOrders")));
    await assertFails(setDoc(doc(db, "qcRequests/new-request"), { employeeUid: "employee-1" }));
    await assertFails(setDoc(doc(db, "reworkWorkOrders/new-rework"), { employeeUid: "employee-1" }));
  });
});


describe("SIGMA employee attendance and personal payroll rules", () => {
  it("allows the admin to create attendance with fractional payable days and a wage snapshot", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1]));
    });
    await assertSucceeds(setDoc(doc(adminDb(), "employeeAttendance/employee-1_2026-11-19"), {
      employeeUid: "employee-1", employeeName: "Test Employee", workDate: "2026-11-19",
      departmentId: 1, payableDays: 0.5, dailyWage: 350000, wageAmount: 175000,
      wageEffectiveDate: "2026-11-01", createdBy: "admin-1",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }));
  });

  it("allows employees to query only their own attendance and blocks writing", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1]));
      await setDoc(doc(context.firestore(), "employees/employee-2"), employeeData("employee-2", "employee2@example.com", [1]));
      const row = {
        employeeUid: "employee-1", employeeName: "Test Employee", workDate: "2026-11-19",
        departmentId: 1, payableDays: 1, dailyWage: 350000, wageAmount: 350000,
        wageEffectiveDate: "2026-11-01", createdBy: "admin-1",
        createdAt: Timestamp.now(), updatedAt: Timestamp.now()
      };
      await setDoc(doc(context.firestore(), "employeeAttendance/employee-1_2026-11-19"), row);
      await setDoc(doc(context.firestore(), "employeeAttendance/employee-2_2026-11-19"), {...row, employeeUid:"employee-2"});
    });
    const db = googleDb("employee-1");
    await assertSucceeds(getDocs(query(collection(db, "employeeAttendance"), where("employeeUid", "==", "employee-1"), limit(50))));
    await assertFails(getDoc(doc(db, "employeeAttendance/employee-2_2026-11-19")));
    await assertFails(setDoc(doc(db, "employeeAttendance/forbidden"), {
      employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-20",
      departmentId:1, payableDays:1, dailyWage:350000, wageAmount:350000,
      wageEffectiveDate:"2026-11-01", createdBy:"employee-1",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    }));
  });

  it("allows one employee to have separate attendance records in two authorized groups on the same date", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1, 2]));
    });
    const date = "2026-11-19";
    const base = {
      employeeUid: "employee-1", employeeName: "Test Employee", workDate: date,
      payableDays: 1, dailyWage: 350000, wageAmount: 350000,
      wageEffectiveDate: "2026-11-01", createdBy: "admin-1",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    await assertSucceeds(setDoc(doc(adminDb(), `employeeAttendance/employee-1_${date}_1`), {...base, departmentId: 1}));
    await assertSucceeds(setDoc(doc(adminDb(), `employeeAttendance/employee-1_${date}_2`), {...base, departmentId: 2}));
  });

  it("rejects a wage amount that does not equal payable days multiplied by daily wage", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1]));
    });
    await assertFails(setDoc(doc(adminDb(), "employeeAttendance/bad-math"), {
      employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-19",
      departmentId:1, payableDays:0.5, dailyWage:350000, wageAmount:350000,
      wageEffectiveDate:"2026-11-01", createdBy:"admin-1",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    }));
  });

  it("rejects malformed attendance dates and invalid wage snapshots", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1]));
    });
    const base = {
      employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-19",
      departmentId:1, payableDays:1, dailyWage:350000, wageAmount:350000,
      wageEffectiveDate:"2026-11-01", createdBy:"admin-1",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    };
    await assertFails(setDoc(doc(adminDb(), "employeeAttendance/bad-date"), {...base, workDate:"2026-11-19-extra"}));
    await assertFails(setDoc(doc(adminDb(), "employeeAttendance/bad-rate-date"), {...base, wageEffectiveDate:"not-a-date"}));
    await assertFails(setDoc(doc(adminDb(), "employeeAttendance/negative-wage"), {...base, dailyWage:-1, wageAmount:-1}));
  });

  it("rejects attendance in a group the employee is not authorized for", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1]));
    });
    await assertFails(setDoc(doc(adminDb(), "employeeAttendance/wrong-group"), {
      employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-19",
      departmentId:2, payableDays:1, dailyWage:350000, wageAmount:350000,
      wageEffectiveDate:"2026-11-01", createdBy:"admin-1",
      createdAt:serverTimestamp(), updatedAt:serverTimestamp()
    }));
  });

  it("blocks disabled employees from reading previously recorded personal payroll", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        ...employeeData("employee-1", "employee@example.com", [1]), status:"disabled"
      });
      await setDoc(doc(context.firestore(), "employeeAttendance/employee-1_2026-11-19"), {
        employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-19",
        departmentId:1, payableDays:0.5, dailyWage:350000, wageAmount:175000,
        wageEffectiveDate:"2026-11-01", createdBy:"admin-1",
        createdAt:Timestamp.now(), updatedAt:Timestamp.now()
      });
    });
    await assertFails(getDoc(doc(googleDb("employee-1"), "employeeAttendance/employee-1_2026-11-19")));
  });


  it("prevents an attendance correction from moving a record to another department", async () => {
    const createdAt = Timestamp.now();
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1, 2]));
      await setDoc(doc(context.firestore(), "employeeAttendance/employee-1_2026-11-19_1"), {
        employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-19",
        departmentId:1, payableDays:1, dailyWage:350000, wageAmount:350000,
        wageEffectiveDate:"2026-11-01", createdBy:"admin-1",
        createdAt, updatedAt:createdAt
      });
    });
    const { updateDoc } = await import("firebase/firestore");
    await assertFails(updateDoc(doc(adminDb(), "employeeAttendance/employee-1_2026-11-19_1"), {
      employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-19",
      departmentId:2, payableDays:1, dailyWage:350000, wageAmount:350000,
      wageEffectiveDate:"2026-11-01", createdBy:"admin-1",
      createdAt, updatedAt:serverTimestamp()
    }));
  });

  it("requires an immutable audit snapshot when an admin corrects attendance", async () => {
    const attendancePath = "employeeAttendance/employee-1_2026-11-19";
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1]));
      await setDoc(doc(context.firestore(), attendancePath), {
        employeeUid:"employee-1", employeeName:"Test Employee", workDate:"2026-11-19",
        departmentId:1, payableDays:0.5, dailyWage:350000, wageAmount:175000,
        wageEffectiveDate:"2026-11-01", createdBy:"admin-1",
        createdAt:Timestamp.now(), updatedAt:Timestamp.now()
      });
    });
    const admin = adminDb();
    const attendanceRef = doc(admin, attendancePath);
    await assertFails(updateDoc(attendanceRef, {
      payableDays:1, wageAmount:350000, updatedAt:serverTimestamp()
    }));
    await assertFails(updateDoc(attendanceRef, {
      payableDays:1, wageAmount:350000, lastAuditLogId:"missing-log", updatedAt:serverTimestamp()
    }));
    await assertFails(updateDoc(doc(googleDb("employee-1"), attendancePath), {
      payableDays:1, wageAmount:350000, updatedAt:serverTimestamp()
    }));

    await assertSucceeds(runTransaction(admin, async transaction => {
      const current = await transaction.get(attendanceRef);
      const before = current.data();
      const logRef = doc(collection(admin, "employeeAttendanceAuditLogs"));
      const after = {
        ...before,
        payableDays:1,
        wageAmount:350000,
        lastAuditLogId:logRef.id,
        updatedAt:serverTimestamp()
      };
      transaction.update(attendanceRef, {
        payableDays:1,
        wageAmount:350000,
        lastAuditLogId:logRef.id,
        updatedAt:serverTimestamp()
      });
      transaction.set(logRef, {
        attendanceId:current.id,
        employeeUid:before.employeeUid,
        workDate:before.workDate,
        departmentId:before.departmentId,
        before,
        after,
        changedBy:"admin-1",
        changedAt:serverTimestamp()
      });
    }));
  });

});


describe("SIGMA finance period closure locks", () => {
  function closure(periodId) {
    return {
      periodId, startDate: periodId + "-01", endDate: periodId + "-30",
      status: "closed", closedAt: serverTimestamp(), closedBy: "admin-1",
      snapshot: { companyProfit: 123456, departments: [] },
      sourceCounts: { dailyRecords: 1, operatingExpenses: 1, employeeAttendance: 1, scrapRequests: 0 },
      sourceDigest: "a".repeat(64), schemaVersion: 1
    };
  }
  async function seedClosure(periodId) {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "financeClosures/" + periodId), closure(periodId));
    });
  }
  it("allows only the trusted backend to create an immutable closure", async () => {
    const db = adminDb(), ref = doc(db, "financeClosures/2026-11");
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(setDoc(ref, closure("2026-11")));
    await seedClosure("2026-11");
    await assertSucceeds(getDoc(ref));
    await assertFails(updateDoc(ref, { status: "reopened" }));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(db, "financeClosures/2026-12"), {...closure("2026-12"), sourceDigest: "invalid"}));
  });
  it("blocks locked-month writes but permits open-month writes", async () => {
    await seedClosure("2026-11");
    const db = adminDb(), timestamp = Timestamp.now();
    const expense = {
      expenseDate: "2026-11-19", category: "utilities", departmentId: 0,
      entryMode: "item", amount: 100000, note: "Test", currency: "VND",
      createdBy: "admin-1", createdAt: timestamp, updatedAt: timestamp
    };
    await assertFails(setDoc(doc(db, "operatingExpenses/locked-expense"), {...expense, createdAt: serverTimestamp(), updatedAt: serverTimestamp()}));
    await assertSucceeds(setDoc(doc(db, "operatingExpenses/open-expense"), {...expense, expenseDate: "2026-12-01", createdAt: serverTimestamp(), updatedAt: serverTimestamp()}));
    const daily = {
      workDate: "2026-11-19", departmentId: 1, headcount: 1,
      outputQuantity: 10, unitPrice: 1000, dailyWagePerPerson: 100,
      materialCost: 100, otherCost: 0, revenue: 10000, laborCost: 100,
      netProfit: 9800, currency: "VND", createdBy: "admin-1",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastAuditLogId: null
    };
    await assertFails(setDoc(doc(db, "dailyRecords/locked-daily"), daily));
    await assertSucceeds(setDoc(doc(db, "dailyRecords/open-daily"), {...daily, workDate: "2026-12-01"}));
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), employeeData("employee-1", "employee@example.com", [1]));
    });
    const attendance = {
      employeeUid: "employee-1", employeeName: "Test Employee",
      workDate: "2026-11-19", departmentId: 1, payableDays: 1,
      dailyWage: 350000, wageAmount: 350000, wageEffectiveDate: "2026-11-01",
      createdBy: "admin-1", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    await assertFails(setDoc(doc(db, "employeeAttendance/locked-attendance"), attendance));
    await assertSucceeds(setDoc(doc(db, "employeeAttendance/open-attendance"), {...attendance, workDate: "2026-12-01", wageEffectiveDate: "2026-12-01"}));
    await assertFails(updateDoc(doc(db, "operatingExpenses/open-expense"), {...expense, expenseDate: "2026-11-20", updatedAt: serverTimestamp()}));
  });
});
