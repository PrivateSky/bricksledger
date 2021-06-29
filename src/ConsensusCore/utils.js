const Block = require("../Block");
const { checkIfPathExists, ensurePathExists } = require("../utils/fs-utils");
const { getValidatorsForCurrentDomain } = require("../utils/bdns-utils");

async function getCachedBlocksFolderPath(rootFolder, domain) {
    const path = require("path");
    const folderPath = path.join(rootFolder, "domains", domain, "cache/blocks");
    try {
        await ensurePathExists(folderPath);
    } catch (error) {
        console.log(error);
    }
    return folderPath;
}

async function getValidatedBlocksFilePath(rootFolder, domain) {
    const path = require("path");
    const validatedBlocksFolderPath = path.join(rootFolder, "domains", domain);
    try {
        await ensurePathExists(validatedBlocksFolderPath);
    } catch (error) {
        console.log(error);
    }

    const validatedBlocksFilePath = path.join(validatedBlocksFolderPath, "blocks");
    return validatedBlocksFilePath;
}

async function getLocalLatestBlockInfo(rootFolder, domain) {
    let latestBlockNumber = 0;
    let latestBlockHash = null;

    // if blocks file exists, then we have blocks that we have validated in the past
    const validatedBlocksFilePath = await getValidatedBlocksFilePath(rootFolder, domain);
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

async function getValidatedBlocksWriteStream(rootFolder, domain) {
    const validatedBlocksFilePath = await getValidatedBlocksFilePath(rootFolder, domain);

    const fs = require("fs");
    const validatedBlocksWriteStream = fs.createWriteStream(validatedBlocksFilePath, { flags: "a" });
    return validatedBlocksWriteStream;
}

function createNewBlock(pendingBlock, latestBlockHash) {
    const participatingPBlockHashLinks = pendingBlock.pBlocks.map((pBlock) =>
        typeof pBlock.hashLinkSSI === "string" ? pBlock.hashLinkSSI : pBlock.hashLinkSSI.getIdentifier()
    );
    sortPBlocks(participatingPBlockHashLinks);

    const block = {
        pbs: participatingPBlockHashLinks,
        blockNumber: pendingBlock.blockNumber,
        previousBlock: latestBlockHash,
    };

    return new Block(block);
}

async function saveBlockInBricks(block, domain, brickStorage) {
    const openDSU = require("opendsu");
    const keySSISpace = openDSU.loadApi("keyssi");

    const brickHash = await brickStorage.addBrickAsync(block.getSerialisation());

    const hashLinkSSI = keySSISpace.createHashLinkSSI(domain, brickHash);
    return hashLinkSSI;
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

function sortPBlocks(pBlocks) {
    const sortHashes = (a, b) => {
        if (typeof a === "string" && typeof b === "string") {
            return a.localeCompare(b);
        }

        const aHash = typeof a.hashLinkSSI === "string" ? a.hashLinkSSI : a.hashLinkSSI.getIdentifier();
        const bHash = typeof b.hashLinkSSI === "string" ? b.hashLinkSSI : b.hashLinkSSI.getIdentifier();
        return aHash.localeCompare(bHash);
    };

    pBlocks.sort(sortHashes);
}

module.exports = {
    getCachedBlocksFolderPath,
    getLocalLatestBlockInfo,
    getValidatedBlocksWriteStream,
    createNewBlock,
    saveBlockInBricks,
    appendValidatedBlockHash,
    loadValidatorsFromBdns,
    sortPBlocks,
};
