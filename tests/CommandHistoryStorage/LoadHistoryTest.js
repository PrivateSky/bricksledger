'use strict';

const os = require('os');
const fs = require('fs');
require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;
const opendsu = require('opendsu');
const crypto = opendsu.loadApi('crypto');

const Command = require("../../src/Command");
const CommandHistoryStorage = require("../../src/CommandHistoryStorage");

const domain = "contract";

async function delay(_delay = 1) {
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, _delay)
    })
}

async function createHistory(destination) {
    const storagePath = `${destination}/domains/${domain}/command-storage`;
    fs.mkdirSync(storagePath, { recursive: true });
    
    const optimisticWriter = fs.createWriteStream(`${storagePath}/optimistic`, { flags: 'a' });
    const optimisticWrite = $$.promisify(optimisticWriter.write.bind(optimisticWriter));
    const validatedWriter = fs.createWriteStream(`${storagePath}/validated`, { flags: 'a' });
    const validatedWrite = $$.promisify(validatedWriter.write.bind(validatedWriter));
    
    const hashes = [];
    for (let i = 0; i < 1000; i++) {
        const method = crypto.encodeBase58(crypto.generateRandom(32));
        const command = new Command({
            domain,
            contractName: "test",
            methodName: `nonced_${method}`,
            params: null,
            type: "nonced",
        });
        
        const time = new Date().getTime();
        const line = `${time}:${command.getHash()}%${os.EOL}`;
        await optimisticWrite(line);
        await validatedWrite(line);
        await delay();
        hashes.push(command.getHash());
    }
    
    optimisticWriter.close();
    validatedWriter.close();
    
    return hashes;
}

assert.callback(
    "Command history is loaded correctly",
    async (testFinished) => {
        const rootFolder = await $$.promisify(dc.createTestFolder)("test");
        
        const savedHashes = await createHistory(rootFolder);

        const commandHistoryStorage = CommandHistoryStorage.create(domain, rootFolder);
        await commandHistoryStorage.init();
        
        for (const hash of savedHashes) {
            const optisticCommandExecuted = await commandHistoryStorage.isOptimisticCommandHashRegistered(hash);
            const validatedCommandExecuted = await commandHistoryStorage.isValidatedCommandHashRegistered(hash);
            
            assert.true(optisticCommandExecuted, `Optimistic command should have been registered: ${hash}`)
            assert.true(validatedCommandExecuted, `Validated command should have been registered: ${hash}`)
        }
        testFinished();
    },
    5000
)