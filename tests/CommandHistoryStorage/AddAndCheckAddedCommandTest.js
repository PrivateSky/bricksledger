require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");
const CommandHistoryStorage = require("../../src/CommandHistoryStorage");

assert.callback("AddAndCheckAddedCommandTest", async (testFinished) => {
    const domain = "contract";
    const rootFolder = await $$.promisify(dc.createTestFolder)("test");

    const commandHistoryStorage = CommandHistoryStorage.create(domain, rootFolder);
    await commandHistoryStorage.init();

    const dummyCommands = Array.from(Array(1000).keys()).map((_, idx) => {
        return new Command({
            domain,
            contractName: "test",
            methodName: "nonced",
            params: [idx],
            type: "nonced",
        });
    });

    const command = new Command({
        domain,
        contractName: "test",
        methodName: "nonced",
        params: null,
        type: "nonced",
    });

    await commandHistoryStorage.addComand(command);

    for (let idx = 0; idx < dummyCommands.length; idx++) {
        const dummyCommand = dummyCommands[idx];
        await commandHistoryStorage.addComand(dummyCommand);
    }

    const existingCommandHash = command.getHash();
    const invalidCommandHash = "invalid-command-hash";

    const isInvalidCommandHashRegistered = await commandHistoryStorage.isCommandHashRegistered(invalidCommandHash);
    assert.false(isInvalidCommandHashRegistered, "invalid command hash shouldn't be present");

    const isExistingCommandHashRegistered = await commandHistoryStorage.isCommandHashRegistered(existingCommandHash);
    assert.true(isExistingCommandHashRegistered, "recently added command hash should be present");

    testFinished();
}, 10000);
