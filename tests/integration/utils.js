require("../../../../psknode/bundles/testsRuntime");
const testIntegration = require("../../../../psknode/tests/util/tir");

const dc = require("double-check");
const assert = dc.assert;
const path = require("path");

const domain = "contract";

let counter = 0;
async function createTestFolder(name) {
    if (!name) {
        name = `test-${counter++}`;
    }
    const folder = await $$.promisify(dc.createTestFolder)(name);
    return folder;
}

async function launchApiHubTestNodeWithContractAsync(constractConfig) {
    const config = constractConfig ? { domains: [{ name: "contract", config: { contracts: constractConfig } }] } : null;
    return testIntegration.launchApiHubTestNodeWithContractAsync(path.resolve(__dirname, "bin/build.file"), config);
}

async function assertBlockFileEntries(storageFolder, entriesCount = 1) {
    const validatedBlocksFilePath = require("path").join(storageFolder, "domains", domain, "blocks");
    const validatedBlocksFileContent = require("fs").readFileSync(validatedBlocksFilePath).toString().trim();
    assert.true(validatedBlocksFileContent !== "", "Empty blocks file");
    const validatedBlocksLines = validatedBlocksFileContent.split(/\r?\n/);

    assert.equal(
        validatedBlocksLines.length,
        entriesCount,
        `Expected consensus to have ${entriesCount} block hash(es) inside the blocks file, but got ${validatedBlocksLines.length}`
    );
}

async function assertEmptyBlockFile(storageFolder) {
    try {
        await assertBlockFileEntries(storageFolder, 0);
    } catch (error) {
        if (error.code !== "ENOENT") {
            assert.true(
                false,
                "only allowed error is that the blocks file wasn't created since no blocks should be created on safe commands"
            );
        }
    }
}

module.exports = {
    createTestFolder,
    launchApiHubTestNodeWithContractAsync,
    assertBlockFileEntries,
    assertEmptyBlockFile,
};
