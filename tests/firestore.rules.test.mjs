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
    qcAuthorized: false,
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

describe("SIGMA QC and scrap request Firestore rules", () => {
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
      createdBy: uid, orderNo: "ORD-QC-01", styleNo: "STYLE-01",
      quantity: 12, note: "Batch ready", status: "submitted",
      createdAt: serverTimestamp()
    };
    if (scrap) data.reason = "Fabric damage";
    return data;
  }

  it("allows an employee to submit a QC request linked to their own repair batch", async () => {
    await seedDeptEmployee("employee-1", 1);
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "repairWorkOrders/order-1"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 1,
        repairTypeId: 101, workDate: "2026-11-19", orderNo: "ORD-QC-01",
        styleNo: "STYLE-01", color: "Navy", quantity: 12, note: "",
        status: "submitted", createdAt: Timestamp.now()
      });
    });
    const db = googleDb();
    const { getDocs, query, collection, where } = await import("firebase/firestore");
    const payload = {
      ...requestData("employee-1", 1), workOrderId: "order-1",
      sourceCollection: "repairWorkOrders", color: "Navy", repairTypeId: 101
    };
    await assertSucceeds(setDoc(doc(db, "qcRequests/qc_order-1"), payload));
    await assertSucceeds(getDocs(query(collection(db, "qcRequests"), where("employeeUid", "==", "employee-1"), where("departmentId", "==", 1))));
    await assertFails(setDoc(doc(db, "qcRequests/qc_wrong"), {
      ...payload, departmentId: 2, sourceCollection: "cleanWorkOrders"
    }));
  });

  it("prevents employees from overwriting an existing QC request", async () => {
    await seedDeptEmployee("employee-1", 1);
    const payload = {
      ...requestData("employee-1", 1),
      workOrderId: "order-1",
      sourceCollection: "repairWorkOrders",
      color: "Navy",
      repairTypeId: 101
    };
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "repairWorkOrders/order-1"), {
        employeeUid: "employee-1", createdBy: "employee-1", departmentId: 1,
        repairTypeId: 101, workDate: "2026-11-19", orderNo: "ORD-QC-01",
        styleNo: "STYLE-01", color: "Navy", quantity: 12, note: "",
        status: "submitted", createdAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "qcRequests/qc_order-1"), {
        ...payload, createdAt: Timestamp.now()
      });
    });
    await assertFails(setDoc(doc(googleDb(), "qcRequests/qc_order-1"), {
      ...payload,
      note: "Trying to replace the original QC request",
      createdAt: serverTimestamp()
    }));
  });

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
    });
    const db = googleDb();
    const { setDoc } = await import("firebase/firestore");
    const id = "scrap_cleanWorkOrders_clean-1";
    const payload = {
      ...requestData("employee-1", 2, true), quantity: 5,
      workOrderId: "clean-1", sourceCollection: "cleanWorkOrders"
    };
    await assertSucceeds(setDoc(doc(db, "scrapRequests", id), payload));
    await assertFails(setDoc(doc(db, "scrapRequests", id), {...payload, note: "duplicate"}));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_clean-other"), {
      ...payload, workOrderId: "clean-other"
    }));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_missing"), {
      ...payload, workOrderId: "missing"
    }));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_cleanWorkOrders_clean-1-too-many"), {
      ...payload, quantity: 13
    }));
    const missingLink = {...payload};delete missingLink.workOrderId;delete missingLink.sourceCollection;
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_missing-link"), missingLink));
    await assertFails(setDoc(doc(db, "scrapRequests/scrap_bad-reason"), {...payload, reason: ""}));
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
    const { setDoc, updateDoc } = await import("firebase/firestore");
    const id = "scrap_weaveWorkOrders_weave-1";
    await assertSucceeds(setDoc(doc(employeeDb, "scrapRequests", id), {
      ...requestData("employee-1", 3, true), quantity: 3,
      workOrderId: "weave-1", sourceCollection: "weaveWorkOrders"
    }));
    await assertFails(updateDoc(doc(employeeDb, "scrapRequests", id), {
      status: "approved", reviewedBy: "employee-1", reviewedAt: serverTimestamp(), reviewNote: ""
    }));
    await assertSucceeds(updateDoc(doc(adminDb(), "scrapRequests", id), {
      status: "approved", reviewedBy: "admin-1", reviewedAt: serverTimestamp(), reviewNote: ""
    }));
  });
});

describe("SIGMA manager-assigned QC reviewer permissions", () => {
  it("allows an active QC-authorized employee to review QC requests but not scrap requests", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/qc-inspector"), {
        uid: "qc-inspector", roleType: 1, status: "active",
        departmentIds: [1], qcAuthorized: true
      });
      await setDoc(doc(context.firestore(), "qcRequests/qc-pending"), {
        requestDate: "2026-11-19", departmentId: 1, employeeUid: "employee-1",
        createdBy: "employee-1", orderNo: "QC-1", styleNo: "S-1",
        quantity: 10, note: "", status: "submitted", createdAt: Timestamp.now()
      });
      await setDoc(doc(context.firestore(), "scrapRequests/scrap-pending"), {
        requestDate: "2026-11-19", departmentId: 1, employeeUid: "employee-1",
        createdBy: "employee-1", orderNo: "SC-1", styleNo: "S-1",
        quantity: 2, note: "", reason: "Damage", status: "submitted", createdAt: Timestamp.now()
      });
    });
    const db = googleDb("qc-inspector", "qc@example.com");
    const { collection, getDocs, updateDoc } = await import("firebase/firestore");
    await assertSucceeds(getDocs(collection(db, "qcRequests")));
    await assertFails(getDocs(collection(db, "scrapRequests")));
    await assertSucceeds(updateDoc(doc(db, "qcRequests/qc-pending"), {
      status: "inspected", qualifiedQuantity: 10, unqualifiedQuantity: 0,
      qcResult: "passed", reviewedBy: "qc-inspector",
      reviewedAt: serverTimestamp(), reviewNote: ""
    }));
    await assertFails(updateDoc(doc(db, "scrapRequests/scrap-pending"), {
      status: "approved", reviewedBy: "qc-inspector",
      reviewedAt: serverTimestamp(), reviewNote: ""
    }));
  });

  it("allows only an admin to grant QC reviewer permission", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/employee-1"), {
        uid: "employee-1", roleType: 1, status: "active",
        departmentIds: [1], repairTypeIds: [101, 102], qcAuthorized: false
      });
    });
    const { updateDoc } = await import("firebase/firestore");
    await assertSucceeds(updateDoc(doc(adminDb(), "employees/employee-1"), {
      qcAuthorized: true, updatedAt: serverTimestamp()
    }));
    await assertFails(updateDoc(doc(googleDb(), "employees/employee-1"), {
      qcAuthorized: false, updatedAt: serverTimestamp()
    }));
  });
});

describe("SIGMA QC rework batch creation", () => {
  it("rejects a rework batch whose source work-order link differs from the QC request", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/qc-inspector"), {
        uid: "qc-inspector", roleType: 1, status: "active",
        departmentIds: [1], qcAuthorized: true
      });
      await setDoc(doc(context.firestore(), "qcRequests/qc-pending"), {
        requestDate: "2026-11-19", departmentId: 1, employeeUid: "employee-1",
        createdBy: "employee-1", orderNo: "ORD-1", styleNo: "S-1",
        quantity: 10, note: "", workOrderId: "order-1",
        sourceCollection: "repairWorkOrders", color: "Navy", repairTypeId: 101,
        status: "submitted", createdAt: Timestamp.now()
      });
    });
    const db = googleDb("qc-inspector", "qc@example.com");
    const { runTransaction } = await import("firebase/firestore");
    await assertFails(runTransaction(db, async tx => {
      const qcRef = doc(db, "qcRequests/qc-pending");
      await tx.get(qcRef);
      tx.update(qcRef, {
        status: "inspected", qualifiedQuantity: 7, unqualifiedQuantity: 3,
        qcResult: "partial", reviewedBy: "qc-inspector",
        reviewedAt: serverTimestamp(), reviewNote: ""
      });
      tx.set(doc(db, "reworkWorkOrders/rework_qc-pending"), {
        sourceQcRequestId: "qc-pending", sourceWorkOrderId: "wrong-order",
        sourceCollection: "repairWorkOrders", departmentId: 1,
        employeeUid: "employee-1", orderNo: "ORD-1", styleNo: "S-1",
        color: "Navy", repairTypeId: 101, quantity: 3,
        status: "pending_rework", createdBy: "qc-inspector",
        createdAt: serverTimestamp()
      });
    }));
  });

  it("creates a deterministic rework batch atomically with QC results", async () => {
    await testEnv.withSecurityRulesDisabled(async context => {
      await setDoc(doc(context.firestore(), "employees/qc-inspector"), {
        uid: "qc-inspector", roleType: 1, status: "active",
        departmentIds: [1], qcAuthorized: true
      });
      await setDoc(doc(context.firestore(), "qcRequests/qc-pending"), {
        requestDate: "2026-11-19", departmentId: 1, employeeUid: "employee-1",
        createdBy: "employee-1", orderNo: "ORD-1", styleNo: "S-1",
        quantity: 10, note: "", workOrderId: "order-1",
        sourceCollection: "repairWorkOrders", color: "Navy", repairTypeId: 101,
        status: "submitted", createdAt: Timestamp.now()
      });
    });
    const db = googleDb("qc-inspector", "qc@example.com");
    const { runTransaction } = await import("firebase/firestore");
    await assertSucceeds(runTransaction(db, async tx => {
      const qcRef = doc(db, "qcRequests/qc-pending");
      const current = await tx.get(qcRef);
      assert.equal(current.data().status, "submitted");
      tx.update(qcRef, {
        status: "inspected", qualifiedQuantity: 7, unqualifiedQuantity: 3,
        qcResult: "partial", reviewedBy: "qc-inspector",
        reviewedAt: serverTimestamp(), reviewNote: ""
      });
      tx.set(doc(db, "reworkWorkOrders/rework_qc-pending"), {
        sourceQcRequestId: "qc-pending", sourceWorkOrderId: "order-1",
        sourceCollection: "repairWorkOrders", departmentId: 1,
        employeeUid: "employee-1", orderNo: "ORD-1", styleNo: "S-1",
        color: "Navy", repairTypeId: 101, quantity: 3,
        status: "pending_rework", createdBy: "qc-inspector",
        createdAt: serverTimestamp()
      });
    }));
  });
});
