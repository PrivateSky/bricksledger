require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");

assert.callback(
    "CheckCommandHashForSameContentTest",
    async (testFinished) => {
        const command1 = new Command({
            domain: "contract",
            contractName: "dummy",
            methodName: "dummyMethod",
            params: ["dummyParams"],
            timestamp: 1622973884344,
        });

        const command2 = new Command({
            domain: "contract",
            contractName: "dummy",
            methodName: "dummyMethod",
            params: ["dummyParams"],
            timestamp: 1622973884344,
        });

        const hash1 = command1.getHash();
        const hash2 = command2.getHash();

        assert.equal(hash1, hash2, "Hashes must be the same");

        testFinished();
    },
    10000
);
