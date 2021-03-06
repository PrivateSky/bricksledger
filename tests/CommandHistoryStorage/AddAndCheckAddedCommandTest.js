require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");
const CommandHistoryStorage = require("../../src/CommandHistoryStorage");

const domain = "contract";

async function addDummyOptimisticAndValidatedCommands(commandHistoryStorage) {
    const dummyCommands = Array.from(Array(1000).keys()).map((_, idx) => {
        return new Command({
            domain,
            contractName: "test",
            methodName: "nonced",
            params: [idx],
            type: "nonced",
        });
    });
    for (let idx = 0; idx < dummyCommands.length; idx++) {
        const dummyCommand = dummyCommands[idx];
        await commandHistoryStorage.addOptimisticComand(dummyCommand);
        await commandHistoryStorage.addValidatedComand(dummyCommand);
    }
}

assert.callback(
    "Add and check optimistic command test",
    async (testFinished) => {
        const rootFolder = await $$.promisify(dc.createTestFolder)("test");

        const commandHistoryStorage = CommandHistoryStorage.create(domain, rootFolder);
        await commandHistoryStorage.init();

        await addDummyOptimisticAndValidatedCommands(commandHistoryStorage);

        const command = new Command({
            domain,
            contractName: "test",
            methodName: "nonced",
            params: null,
            type: "nonced",
        });

        await commandHistoryStorage.addOptimisticComand(command);

        const existingCommandHash = command.getHash();
        const invalidCommandHash = "invalid-command-hash";

        const invalidPresentInsideOptimistic = await commandHistoryStorage.isOptimisticCommandHashRegistered(invalidCommandHash);
        assert.false(invalidPresentInsideOptimistic, "invalid command hash shouldn't be present inside optimistic");

        const invalidPresentInsideValidated = await commandHistoryStorage.isValidatedCommandHashRegistered(invalidCommandHash);
        assert.false(invalidPresentInsideValidated, "invalid command hash shouldn't be present inside validated");

        const existingCommandInsideValidated = await commandHistoryStorage.isValidatedCommandHashRegistered(existingCommandHash);
        assert.false(existingCommandInsideValidated, "recently added command hash shouldn't be present inside validated");

        const existingCommandInsideOptimistic = await commandHistoryStorage.isOptimisticCommandHashRegistered(
            existingCommandHash
        );
        assert.true(existingCommandInsideOptimistic, "recently added command hash shouldn't be present inside optimistic");

        testFinished();
    },
    5000
);

assert.callback(
    "Add and check validated command test",
    async (testFinished) => {
        const domain = "contract";
        const rootFolder = await $$.promisify(dc.createTestFolder)("test");

        const commandHistoryStorage = CommandHistoryStorage.create(domain, rootFolder);
        await commandHistoryStorage.init();

        await addDummyOptimisticAndValidatedCommands(commandHistoryStorage);

        const command = new Command({
            domain,
            contractName: "test",
            methodName: "nonced",
            params: null,
            type: "nonced",
        });

        await commandHistoryStorage.addValidatedComand(command);

        const existingCommandHash = command.getHash();
        const invalidCommandHash = "invalid-command-hash";

        const invalidPresentInsideOptimistic = await commandHistoryStorage.isOptimisticCommandHashRegistered(invalidCommandHash);
        assert.false(invalidPresentInsideOptimistic, "invalid command hash shouldn't be present inside optimistic");

        const invalidPresentInsideValidated = await commandHistoryStorage.isValidatedCommandHashRegistered(invalidCommandHash);
        assert.false(invalidPresentInsideValidated, "invalid command hash shouldn't be present inside validated");

        const existingCommandInsideValidated = await commandHistoryStorage.isValidatedCommandHashRegistered(existingCommandHash);
        assert.true(existingCommandInsideValidated, "recently added command hash should be present inside validated");

        const existingCommandInsideOptimistic = await commandHistoryStorage.isOptimisticCommandHashRegistered(
            existingCommandHash
        );
        assert.false(existingCommandInsideOptimistic, "recently added command hash shouldn't be present inside optimistic");

        testFinished();
    },
    5000
);
