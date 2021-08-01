require("../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../src/Command");
const PBlock = require("../src/PBlock");

const domain = "contract";

let counter = 0;
async function createTestFolder(name) {
    if (!name) {
        name = `test-${counter++}`;
    }
    const folder = await $$.promisify(dc.createTestFolder)(name);
    return folder;
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkIfPathExists(path) {
    try {
        const fs = require("fs");
        await $$.promisify(fs.access)(path);
        return true;
    } catch (error) {
        return false;
    }
}

async function ensurePathExists(path) {
    const pathExists = await checkIfPathExists(path);
    if (!pathExists) {
        const fs = require("fs");
        await $$.promisify(fs.mkdir)(path, { recursive: true });
    }
}

async function generatePBlockWithSingleCommand(index = 0, latestBlockHash = "latestBlockHash", latestBlockNumber = 1) {
    const validatorDID = await createValidatorDID(index);

    const command = new Command({
        domain,
        contractName: "test",
        methodName: "nonced",
        params: null,
        type: "nonced",
        timestamp: Date.now(),
        signerDID: validatorDID.getIdentifier(),
    });

    const pBlockInfo = {
        validatorDID: validatorDID.getIdentifier(),
        commands: [command],
        previousBlockHash: latestBlockHash,
        blockNumber: latestBlockNumber + 1,
    };
    const pBlock = new PBlock(pBlockInfo);
    pBlock.hash = pBlock.computeHash();
    pBlock.validatorSignature = validatorDID.sign(pBlock.hash);
    pBlock.hashLinkSSI = pBlock.hash;

    return pBlock;
}

async function assertBlockFileEntries(rootFolder, consensusCore, blockCount = 1) {
    const validatedBlocksFilePath = require("path").join(rootFolder, "domains", domain, "blocks");
    const validatedBlocksFileContent = require("fs").readFileSync(validatedBlocksFilePath).toString().trim();

    assert.true(validatedBlocksFileContent !== "", "Empty blocks file");
    const validatedBlocksLines = validatedBlocksFileContent.split(/\r?\n/);

    assert.equal(
        validatedBlocksLines.length,
        blockCount,
        `Expected consensus to have ${blockCount} block hash inside the blocks file, but found ${validatedBlocksLines.length}`
    );

    const newlyAddedBlockHash = validatedBlocksLines[validatedBlocksLines.length - 1];

    const latestBlockInfo = consensusCore.getLatestBlockInfo();
    assert.equal(
        latestBlockInfo.number,
        blockCount,
        `Expected to increment block number ${blockCount}, but got ${latestBlockInfo.number}`
    );
    assert.equal(
        latestBlockInfo.hash,
        newlyAddedBlockHash,
        `Expected latest block hash to be the hash of the newly created block '${latestBlockInfo.hash}', but found '${newlyAddedBlockHash}'`
    );
}

async function createValidatorDID(index = 0) {
    const w3cDID = require("opendsu").loadApi("w3cdid");
    const validatorDID = await $$.promisify(w3cDID.createIdentity)("demo", `id_${index}`);
    return validatorDID;
}

async function parseValidatorDID(validatorDID) {
    if (typeof validatorDID === "string") {
        const w3cDID = require("opendsu").loadAPI("w3cdid");
        validatorDID = await $$.promisify(w3cDID.resolveDID)(validatorDID);
    }
    return validatorDID;
}

async function writeHashesToValidatedBlocksFile(storageFolder, domain, blockHashes) {
    const path = require("path");
    const fs = require("fs");

    const validatedHashesFileContent = blockHashes.join(require("os").EOL);
    const validatedBlocksFolderPath = path.join(storageFolder, "domains", domain);
    const validatedBlocksFilePath = path.join(validatedBlocksFolderPath, "blocks");
    await ensurePathExists(validatedBlocksFolderPath);
    console.log(`Writing to blocks file at ${validatedBlocksFilePath}...`);
    await $$.promisify(fs.writeFile)(validatedBlocksFilePath, validatedHashesFileContent);
}

function getHashLinkSSIString(domain, hash, readable = true) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");
    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, hash);
    return hashLinkSSI.getIdentifier(readable);
}

function areHashLinkSSIEqual(firstSSI, secondSSI) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");
    const firstParsedSSI = keySSISpace.parse(firstSSI);
    const secondParsedSSI = keySSISpace.parse(secondSSI);
    return firstParsedSSI.getIdentifier() === secondParsedSSI.getIdentifier();
}

function assertArrayLength(array, length, message) {
    if (message) {
        message += `. Expected array size to be ${length}, but was ${array ? array.length : "unexistent"}`;
    }
    assert.true(array && Array.isArray(array) && array.length === length, message);
}

class Timer {
    start() {
        this.start = process.hrtime();
    }

    end() {
        const diff = process.hrtime(this.start);
        this.durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;
    }

    getDuration() {
        const { durationMs } = this;

        //Get hours from milliseconds
        let hours = durationMs / (1000 * 60 * 60);
        let absoluteHours = Math.floor(hours);
        let h = absoluteHours > 9 ? absoluteHours : "0" + absoluteHours;

        //Get remainder from hours and convert to minutes
        let minutes = (hours - absoluteHours) * 60;
        let absoluteMinutes = Math.floor(minutes);
        let m = absoluteMinutes > 9 ? absoluteMinutes : "0" + absoluteMinutes;

        //Get remainder from minutes and convert to seconds
        let seconds = (minutes - absoluteMinutes) * 60;
        let absoluteSeconds = Math.floor(seconds);
        let s = absoluteSeconds > 9 ? absoluteSeconds : "0" + absoluteSeconds;
        let ms = Math.floor(durationMs % 1000);

        return `${h}:${m}:${s}:${ms} - ${durationMs} ms`;
    }
}

function sortArrayByField(array, field) {
    const sortFunction = (a, b) => {
        const result = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
        return result;
    };
    array.sort(sortFunction);
}

module.exports = {
    getRandomInt,
    sleep,
    checkIfPathExists,
    ensurePathExists,
    createTestFolder,
    generatePBlockWithSingleCommand,
    assertBlockFileEntries,
    parseValidatorDID,
    writeHashesToValidatedBlocksFile,
    getHashLinkSSIString,
    areHashLinkSSIEqual,
    createValidatorDID,
    assertArrayLength,
    Timer,
    sortArrayByField,
};
