require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const StorageValue = require("../../src/FSKeyValueStorage/StorageValue");

assert.callback("Create empty StorageValue", async (testFinished) => {
    const storageValue = new StorageValue();
    assert.notNull(storageValue.value);
    assert.isNull(storageValue.value.validated);
    assert.true(storageValue.value.pending && Array.isArray(storageValue.value.pending) && !storageValue.value.pending.length);

    testFinished();
});

assert.callback("Create populated StorageValue", async (testFinished) => {
    const value = {
        validated: "validated",
        pending: [{ commandHash: "hash", newValue: "newValue" }],
    };
    const storageValue = new StorageValue(JSON.stringify(value));

    assert.notNull(storageValue.value);
    assert.equal(storageValue.value.validated, value.validated);
    assert.arraysMatch(storageValue.value.pending, value.pending);

    testFinished();
});

assert.callback("Create populated StorageValue and check getValue", async (testFinished) => {
    const value = {
        validated: "validated",
        pending: [
            { commandHash: "hash1", newValue: "newValue1" },
            { commandHash: "hash2", newValue: "newValue2" },
        ],
    };
    const storageValue = new StorageValue(JSON.stringify(value));

    assert.equal(storageValue.getValue(), "validated");
    assert.equal(storageValue.getValue(true), "newValue2");

    // remove the last element from the pending list
    storageValue.value.pending.splice(1, 1);
    assert.equal(storageValue.getValue(), "validated");
    assert.equal(storageValue.getValue(true), "newValue1");

    // clear the pending list
    storageValue.value.pending = [];
    assert.equal(storageValue.getValue(), "validated");
    assert.equal(storageValue.getValue(true), "validated");

    testFinished();
});

assert.callback("Create empty StorageValue and check addPending and updateValidated", async (testFinished) => {
    const storageValue = new StorageValue();

    storageValue.addPending("hash1", "pendingValue");
    assert.equal(
        storageValue.getValue(),
        null,
        `Expecting null to be returned as validated value, but got ${storageValue.getValue()}`
    );
    assert.equal(
        storageValue.getValue(true),
        "pendingValue",
        `Expecting pendingValue to be returned as latest pending value, but got ${storageValue.getValue(true)}`
    );

    storageValue.addPending("hash2", "pendingValue2");
    assert.equal(
        storageValue.getValue(),
        null,
        `Expecting null to be returned as validated value, but got ${storageValue.getValue()}`
    );
    assert.equal(
        storageValue.getValue(true),
        "pendingValue2",
        `Expecting pendingValue2 to be returned as latest pending value, but got ${storageValue.getValue(true)}`
    );

    // updateValidated with a command that doesn't exists in pending
    storageValue.updateValidated("nonexistingHash", "nonexistingValue");
    assert.equal(
        storageValue.getValue(),
        "nonexistingValue",
        `Expecting nonexistingValue to be returned as validated value, but got ${storageValue.getValue()}`
    );
    assert.equal(
        storageValue.getValue(true),
        "pendingValue2",
        `Expecting pendingValue2 to be returned as latest pending value, but got ${storageValue.getValue(true)}`
    );

    // updateValidated for first pending command
    storageValue.updateValidated("hash1", "pendingValue");
    assert.equal(
        storageValue.getValue(),
        "pendingValue",
        `Expecting pendingValue to be returned as validated value, but got ${storageValue.getValue()}`
    );
    assert.equal(
        storageValue.getValue(true),
        "pendingValue2",
        `Expecting pendingValue2 to be returned as latest pending value, but got ${storageValue.getValue(true)}`
    );

    // updateValidated for first pending command
    storageValue.updateValidated("hash2", "pendingValue2");
    assert.equal(
        storageValue.getValue(),
        "pendingValue2",
        `Expecting pendingValue2 to be returned as validated value, but got ${storageValue.getValue()}`
    );
    assert.equal(
        storageValue.getValue(true),
        "pendingValue2",
        `Expecting pendingValue2 to be returned as latest pending value, but got ${storageValue.getValue(true)}`
    );

    testFinished();
});
