const Block = require("../Block");
const { ensurePathExists } = require("../utils/fs-utils");

async function getValidatedBlocksWriteStream(rootFolder, domain) {
    const path = require("path");
    const validatedBlocksFolderPath = path.join(rootFolder, "domains", domain);
    const validatedBlocksFilePath = path.join(validatedBlocksFolderPath, "blocks");

    try {
        await ensurePathExists(validatedBlocksFolderPath);
    } catch (error) {
        console.log(error);
    }

    const fs = require("fs");
    const validatedBlocksWriteStream = fs.createWriteStream(validatedBlocksFilePath, { flags: "a" });
    return validatedBlocksWriteStream;
}

function createNewBlock(pendingBlock, latestBlockHash) {
    const participatingPBlockHashLinks = pendingBlock.pendingPBlocks.map(({ pBlock }) =>
        typeof pBlock.hashLinkSSI === "string" ? pBlock.hashLinkSSI : pBlock.hashLinkSSI.getIdentifier()
    );
    participatingPBlockHashLinks.sort();

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

module.exports = {
    getValidatedBlocksWriteStream,
    createNewBlock,
    saveBlockInBricks,
    appendValidatedBlockHash,
};
