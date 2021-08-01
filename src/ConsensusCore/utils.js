const { checkIfPathExists, ensurePathExists } = require("../utils/fs-utils");
const { getValidatorsForCurrentDomain } = require("../utils/bdns-utils");

const CONSENSUS_PHASES = {
    PENDING_BLOCKS: "PENDING_BLOCKS",
    NON_INCLUSION_CHECK: "NON_INCLUSION_CHECK",
    FINALIZING: "FINALIZING",
    FINALIZED: "FINALIZED",
};

async function getCachedBlocksFolderPath(storageFolder, domain) {
    const path = require("path");
    const folderPath = path.join(storageFolder, "domains", domain, "cache/blocks");
    try {
        await ensurePathExists(folderPath);
    } catch (error) {
        console.log(error);
    }
    return folderPath;
}

async function getValidatedBlocksFilePath(storageFolder, domain) {
    const path = require("path");
    const validatedBlocksFolderPath = path.join(storageFolder, "domains", domain);
    try {
        await ensurePathExists(validatedBlocksFolderPath);
    } catch (error) {
        console.log(error);
    }

    const validatedBlocksFilePath = path.join(validatedBlocksFolderPath, "blocks");
    return validatedBlocksFilePath;
}

async function getLocalLatestBlockInfo(storageFolder, domain) {
    let latestBlockNumber = 0;
    let latestBlockHash = null;

    // if blocks file exists, then we have blocks that we have validated in the past
    const validatedBlocksFilePath = await getValidatedBlocksFilePath(storageFolder, domain);
    if (await checkIfPathExists(validatedBlocksFilePath)) {
        return new Promise((resolve, reject) => {
            const fs = require("fs");
            const os = require("os");
            const readStream = fs.createReadStream(validatedBlocksFilePath);
            readStream
                .on("data", function (chunk) {
                    // split chunk by newline in order to get the block hashes
                    const hashes = chunk
                        .toString()
                        .split(os.EOL)
                        .map((hash) => (hash ? hash.trim() : null))
                        .filter((hash) => !!hash);

                    if (hashes.length) {
                        latestBlockNumber += hashes.length;
                        latestBlockHash = hashes[hashes.length - 1];
                    }
                })
                .on("close", function (error) {
                    if (error) {
                        return reject(error);
                    }

                    resolve({
                        number: latestBlockNumber,
                        hash: latestBlockHash,
                    });
                });
        });
    }

    return {
        number: latestBlockNumber,
        hash: latestBlockHash,
    };
}

async function getValidatedBlocksWriteStream(storageFolder, domain) {
    const validatedBlocksFilePath = await getValidatedBlocksFilePath(storageFolder, domain);

    const fs = require("fs");
    const validatedBlocksWriteStream = fs.createWriteStream(validatedBlocksFilePath, { flags: "a" });
    return validatedBlocksWriteStream;
}

async function saveBlockInBricks(block, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const brickHash = await brickStorage.addBrickAsync(block.getSerialisation());

    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, brickHash);
    return hashLinkSSI.getIdentifier();
}

async function savePBlockInBricks(pBlock, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const pBlockBrickHash = await brickStorage.addBrickAsync(pBlock.getSerialisation());

    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, pBlockBrickHash);
    return hashLinkSSI.getIdentifier();
}

async function appendValidatedBlockHash(blockHash, writeStream) {
    const os = require("os");
    const line = `${os.EOL}${blockHash}`;
    await $$.promisify(writeStream.write.bind(writeStream))(line);
}

async function loadValidatorsFromBdns(domain, executionEngine) {
    const validators = await getValidatorsForCurrentDomain(executionEngine);
    if (!validators || !validators.length) {
        throw new Error(`No validators found for domain '${domain}'`);
    }
    // if (validators.length === 2) {
    //     throw new Error(`Consensus cannot be used for 2 validators`);
    // }
    return validators;
}

function areNonInclusionListsEqual(array1, array2) {
    if (array1.length !== array2.length) {
        return false;
    }
    const array1ValidatorDIDs = array1.map((x) => x.validatorDID);
    array1ValidatorDIDs.sort();

    const array2ValidatorDIDs = array2.map((x) => x.validatorDID);
    array2ValidatorDIDs.sort();

    return array1ValidatorDIDs.join(",") === array2ValidatorDIDs.join(",");
}

module.exports = {
    CONSENSUS_PHASES,
    getCachedBlocksFolderPath,
    getLocalLatestBlockInfo,
    getValidatedBlocksWriteStream,
    saveBlockInBricks,
    savePBlockInBricks,
    appendValidatedBlockHash,
    loadValidatorsFromBdns,
    areNonInclusionListsEqual,
};
