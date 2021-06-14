require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const FSKeyValueStorage = require("../../src/FSKeyValueStorage");
const { createTestFolder } = require("../integration/utils");

assert.callback("Create FSKeyValueStorage and check enterOptimisticMode", async (testFinished) => {
    const domain = "contract";
    const contractName = "test";
    const commandHash = "hash";
    const storedKey = "key";

    const rootFolder = await createTestFolder();

    const fSKeyValueStorage = FSKeyValueStorage.create(domain, rootFolder, contractName);
    await fSKeyValueStorage.init();
    assert.true(fSKeyValueStorage != null);

    assert.equal(await fSKeyValueStorage.get(storedKey), null);
    assert.equal(await fSKeyValueStorage.getValidated(storedKey), null);

    fSKeyValueStorage.enterOptimisticMode(commandHash);

    assert.false(
        fSKeyValueStorage.requireConsensus(),
        "Expected for the command to not require consensus unless update is mode via set"
    );

    await fSKeyValueStorage.set(storedKey, "newValue");

    assert.equal(await fSKeyValueStorage.get(storedKey), "newValue");
    assert.equal(await fSKeyValueStorage.getValidated(storedKey), null);

    assert.true(
        fSKeyValueStorage.requireConsensus(),
        "Expected for the command to require consensus since update was mode via set"
    );

    await fSKeyValueStorage.set(storedKey, "newValue2");

    assert.equal(await fSKeyValueStorage.get(storedKey), "newValue2");
    assert.equal(await fSKeyValueStorage.getValidated(storedKey), null);

    testFinished();
});

assert.callback("Create FSKeyValueStorage and check enterValidatedMode", async (testFinished) => {
    const domain = "contract";
    const contractName = "test";
    const commandHash = "hash";
    const storedKey = "key";

    const rootFolder = await createTestFolder();

    const fSKeyValueStorage = FSKeyValueStorage.create(domain, rootFolder, contractName);
    await fSKeyValueStorage.init();
    assert.true(fSKeyValueStorage != null);

    assert.equal(await fSKeyValueStorage.get(storedKey), null);
    assert.equal(await fSKeyValueStorage.getValidated(storedKey), null);

    fSKeyValueStorage.enterValidatedMode(commandHash);

    assert.false(
        fSKeyValueStorage.requireConsensus(),
        "Expected for the command to not require consensus since it's in validated mode"
    );

    await fSKeyValueStorage.set(storedKey, "newValue");

    assert.equal(await fSKeyValueStorage.get(storedKey), "newValue");
    assert.equal(await fSKeyValueStorage.getValidated(storedKey), "newValue");

    assert.false(
        fSKeyValueStorage.requireConsensus(),
        "Expected for the command to not require consensus since it's in validated mode"
    );

    await fSKeyValueStorage.set(storedKey, "newValue2");

    assert.equal(await fSKeyValueStorage.get(storedKey), "newValue2");
    assert.equal(await fSKeyValueStorage.getValidated(storedKey), "newValue2");

    testFinished();
});