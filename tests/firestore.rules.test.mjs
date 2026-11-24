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
  getDocs,
  collection,
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

  it("allows the admin dashboard to query repair, cleaning, and weaving work orders", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      const db = context.firestore();
      await setDoc(doc(db, "repairWorkOrders/dashboard-repair"), {
        employeeUid: "employee-2", createdBy: "employee-2", departmentId: 1,
        repairTypeId: 101, workDate: "2026-11-25", orderNo: "", styleNo: "",
        color: "", quantity: 12, note: "", status: "submitted", createdAt: Timestamp.now()
      });
      await setDoc(doc(db, "cleanWorkOrders/dashboard-clean"), {
        employeeUid: "employee-3", createdBy: "employee-3", departmentId: 2,
        workDate: "2026-11-25", orderNo: "", styleNo: "", color: "",
        quantity: 20, note: "", status: "submitted", createdAt: Timestamp.now()
      });
      await setDoc(doc(db, "weaveWorkOrders/dashboard-weave"), {
        employeeUid: "employee-4", createdBy: "employee-4", departmentId: 3,
        workDate: "2026-11-25", orderNo: "", styleNo: "", color: "",
        quantity: 30, note: "", status: "submitted", createdAt: Timestamp.now()
      });
    });
    const db = adminDb();
    const { collection, getDocs, query, where, limit } = await import("firebase/firestore");
    const repair = await assertSucceeds(getDocs(query(
      collection(db, "repairWorkOrders"),
      where("workDate", ">=", "2026-11-19"),
      where("workDate", "<=", "2026-11-25"),
      limit(500)
    )));
    const clean = await assertSucceeds(getDocs(query(
      collection(db, "cleanWorkOrders"),
      where("workDate", "==", "2026-11-25"),
      limit(500)
    )));
    const weave = await assertSucceeds(getDocs(query(
      collection(db, "weaveWorkOrders"),
      where("workDate", "==", "2026-11-25"),
      limit(500)
    )));
    assert.equal(repair.size, 1);
    assert.equal(clean.size, 1);
    assert.equal(weave.size, 1);
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
        specialRole: false,
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
        specialRole: false,
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
        specialRole: false,
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

  it("allows a weaving employee to submit and read only weaving work orders", async () => {
    await seedEmployee("employee-1", 3);
    const db = googleDb();
    const { addDoc, collection, getDocs, query, where } = await import("firebase/firestore");
    await assertSucceeds(addDoc(collection(db, "weaveWorkOrders"), workOrderData("employee-1", 3)));
    await assertSucceeds(getDocs(query(collection(db, "weaveWorkOrders"), where("employeeUid", "==", "employee-1"), where("departmentId", "==", 3))));
    await assertFails(addDoc(collection(db, "cleanWorkOrders"), workOrderData("employee-1", 2)));
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
});

describe("SIGMA scrap request Firestore rules", () => {
  async function seedDeptEmployee(uid, departmentId) {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), `employees/${uid}`), {
        uid, roleType: 1, status: "active", departmentIds: [departmentId]
      });
    });
  }

  function scrapData(uid, departmentId, overrides = {}) {
    return {
      requestDate: "2026-11-19",
      departmentId,
      employeeUid: uid,
      createdBy: uid,
      orderNo: "ORD-SCRAP-01",
      styleNo: "STYLE-01",
      quantity: 12,
      note: "Batch damaged",
      reason: "Fabric damage",
      status: "submitted",
      createdAt: serverTimestamp(),
      ...overrides
    };
  }

  it("allows employees in each of the three groups to submit scrap requests for their own department", async () => {
    const { addDoc, collection } = await import("firebase/firestore");
    for (const departmentId of [1, 2, 3]) {
      const uid = `employee-${departmentId}`;
      await seedDeptEmployee(uid, departmentId);
      await assertSucceeds(addDoc(
        collection(googleDb(uid, `${uid}@example.com`), "scrapRequests"),
        scrapData(uid, departmentId)
      ));
    }
  });

  it("rejects a scrap request without a reason or for an unauthorized department", async () => {
    await seedDeptEmployee("employee-1", 2);
    const db = googleDb();
    const { addDoc, collection } = await import("firebase/firestore");
    await assertFails(addDoc(collection(db, "scrapRequests"), scrapData("employee-1", 2, { reason: "" })));
    await assertFails(addDoc(collection(db, "scrapRequests"), scrapData("employee-1", 3)));
  });

  it("allows employees to read only their own department scrap requests", async () => {
    await seedDeptEmployee("employee-1", 1);
    await seedDeptEmployee("employee-2", 1);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "scrapRequests/other-employee-request"), {
        ...scrapData("employee-2", 1),
        createdAt: Timestamp.now()
      });
    });
    const db = googleDb();
    const { getDoc, query, collection, where, getDocs } = await import("firebase/firestore");
    await assertFails(getDoc(doc(db, "scrapRequests/other-employee-request")));
    const ownQuery = query(
      collection(db, "scrapRequests"),
      where("employeeUid", "==", "employee-1"),
      where("departmentId", "==", 1)
    );
    const own = await assertSucceeds(getDocs(ownQuery));
    assert.equal(own.size, 0);
  });

  it("allows only an admin to approve or reject a submitted scrap request", async () => {
    await seedDeptEmployee("employee-1", 3);
    const employeeDb = googleDb();
    const { addDoc, collection, updateDoc } = await import("firebase/firestore");
    const created = await assertSucceeds(addDoc(
      collection(employeeDb, "scrapRequests"),
      scrapData("employee-1", 3)
    ));
    await assertFails(updateDoc(doc(employeeDb, "scrapRequests", created.id), {
      status: "approved",
      reviewedBy: "employee-1",
      reviewedAt: serverTimestamp(),
      reviewNote: ""
    }));
    await assertSucceeds(updateDoc(doc(adminDb(), "scrapRequests", created.id), {
      status: "approved",
      reviewedBy: "admin-1",
      reviewedAt: serverTimestamp(),
      reviewNote: ""
    }));
  });

  it("rejects employees changing an already reviewed scrap request", async () => {
    await seedDeptEmployee("employee-1", 2);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "scrapRequests/reviewed-request"), {
        ...scrapData("employee-1", 2),
        status: "approved",
        reviewedBy: "admin-1",
        reviewedAt: Timestamp.now(),
        reviewNote: ""
      });
    });
    const { updateDoc } = await import("firebase/firestore");
    await assertFails(updateDoc(doc(googleDb(), "scrapRequests/reviewed-request"), {
      status: "rejected",
      reviewedBy: "employee-1",
      reviewedAt: serverTimestamp(),
      reviewNote: ""
    }));
  });
});

describe("SIGMA wage settings and daily accounting Firestore rules", () => {
  it("allows an active admin to read and update department wage settings", async () => {
    const db = adminDb();
    const ref = doc(db, "appSettings/departmentWages");
    await assertSucceeds(setDoc(ref, {
      rates: [
        { departmentId: 1, effectiveDate: "2026-11-01", dailyWage: 300000 },
        { departmentId: 2, effectiveDate: "2026-11-01", dailyWage: 280000 },
        { departmentId: 3, effectiveDate: "2026-11-01", dailyWage: 290000 }
      ],
      updatedBy: "admin-1",
      updatedAt: serverTimestamp()
    }));
    const snapshot = await assertSucceeds(getDoc(ref));
    assert.equal(snapshot.data().rates.length, 3);
  });

  it("rejects employees reading or changing department wage settings", async () => {
    const db = googleDb();
    const ref = doc(db, "appSettings/departmentWages");
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, { rates: [] }));
  });

  it("allows an active admin to create, read, and update daily accounting records", async () => {
    const db = adminDb();
    const ref = doc(db, "dailyRecords/2026-11-19_department-1");
    const payload = {
      workDate: "2026-11-19",
      departmentId: 1,
      headcount: 3,
      quantity: 420,
      unitPrice: 10000,
      dailyWage: 300000,
      materialCost: 150000,
      updatedBy: "admin-1",
      updatedAt: serverTimestamp()
    };
    await assertSucceeds(setDoc(ref, payload));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(setDoc(ref, { ...payload, quantity: 450 }));
  });

  it("rejects employees reading, creating, or changing daily accounting records", async () => {
    const db = googleDb();
    const ref = doc(db, "dailyRecords/2026-11-19_department-1");
    const payload = {
      workDate: "2026-11-19",
      departmentId: 1,
      headcount: 3,
      quantity: 420
    };
    await assertFails(getDoc(ref));
    await assertFails(setDoc(ref, payload));
    await assertFails(setDoc(ref, { ...payload, quantity: 500 }));
  });

  it("denies unauthenticated reads and writes across every protected data area", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    const protectedDocs = [
      "admins/admin-1",
      "employeeInvites/invite-valid",
      "employees/employee-1",
      "repairWorkOrders/any-order",
      "cleanWorkOrders/any-order",
      "weaveWorkOrders/any-order",
      "scrapRequests/any-request",
      "appSettings/departmentWages",
      "operatingExpenses/any-expense",
      "dailyRecords/any-record"
    ];
    for (const path of protectedDocs) {
      await assertFails(getDoc(doc(db, path)));
    }
    for (const name of [
      "admins", "employeeInvites", "employees", "repairWorkOrders",
      "cleanWorkOrders", "weaveWorkOrders", "scrapRequests",
      "operatingExpenses", "dailyRecords"
    ]) {
      await assertFails(getDocs(collection(db, name)));
    }
    await assertFails(setDoc(doc(db, "dailyRecords/unauthenticated-write"), {
      workDate: "2026-11-24",
      departmentId: 1,
      netProfit: 999999
    }));
  });

  it("denies authenticated users without an admin or employee role from privileged data", async () => {
    const db = testEnv.authenticatedContext("unregistered-user").firestore();
    await assertFails(getDoc(doc(db, "admins/admin-1")));
    await assertFails(getDoc(doc(db, "employees/employee-1")));
    await assertFails(getDocs(collection(db, "employees")));
    await assertFails(getDoc(doc(db, "appSettings/departmentWages")));
    await assertFails(getDoc(doc(db, "operatingExpenses/any-expense")));
    await assertFails(getDoc(doc(db, "dailyRecords/any-record")));
    await assertFails(setDoc(doc(db, "operatingExpenses/forged-expense"), {
      expenseDate: "2026-11-24",
      category: "other",
      departmentId: 0,
      entryMode: "item",
      amount: 1,
      note: "",
      currency: "VND",
      createdBy: "unregistered-user",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    }));
  });

});
