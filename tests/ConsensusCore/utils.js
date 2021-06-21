require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const Command = require("../../src/Command");
const PBlock = require("../../src/PBlock");

const domain = "contract";

async function generatePBlockWithSingleCommand(index = 0, latestBlockHash = "latestBlockHash", latestBlockNumber = 1) {
    const w3cDID = require("opendsu").loadApi("w3cdid");
    const validatorDID = await $$.promisify(w3cDID.createIdentity)("demo", `id_${index}`);

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

async function assertSingleBlockFileEntry(rootFolder, consensusCore, latestBlockNumber = 1) {
    const validatedBlocksFilePath = require("path").join(rootFolder, "domains", domain, "blocks");
    const validatedBlocksFileContent = require("fs").readFileSync(validatedBlocksFilePath).toString().trim();

    assert.true(validatedBlocksFileContent !== "", "Empty blocks file");
    const validatedBlocksLines = validatedBlocksFileContent.split(/\r?\n/);

    assert.equal(validatedBlocksLines.length, 1, "Expected consensus to append a single block hash inside the blocks file");

    const newlyAddedBlockHash = validatedBlocksLines[0];

    const latestBlockInfo = consensusCore.getLatestBlockInfo();
    assert.equal(latestBlockInfo.number, latestBlockNumber + 1, "Expected to increment block number");
    assert.equal(
        latestBlockInfo.hash,
        newlyAddedBlockHash,
        "Expected latest block hash to be the hash of the newly created block"
    );
}

module.exports = {
    generatePBlockWithSingleCommand,
    assertSingleBlockFileEntry
};
