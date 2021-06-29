require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const domain = "contract";

async function assertBlockFileEntries(rootFolder, entriesCount = 1) {
    const validatedBlocksFilePath = require("path").join(rootFolder, "domains", domain, "blocks");
    const validatedBlocksFileContent = require("fs").readFileSync(validatedBlocksFilePath).toString().trim();
    assert.true(validatedBlocksFileContent !== "", "Empty blocks file");
    const validatedBlocksLines = validatedBlocksFileContent.split(/\r?\n/);

    assert.equal(
        validatedBlocksLines.length,
        entriesCount,
        `Expected consensus to have ${entriesCount} block hash(es) inside the blocks file, but got ${validatedBlocksLines.length}`
    );
}

module.exports = {
    assertBlockFileEntries,
};
