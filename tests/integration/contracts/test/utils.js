require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const domain = "contract";

async function assertSingleBlockFileEntry(rootFolder) {
    const validatedBlocksFilePath = require("path").join(rootFolder, "domains", domain, "blocks");
    const validatedBlocksFileContent = require("fs").readFileSync(validatedBlocksFilePath).toString().trim();
    assert.true(validatedBlocksFileContent !== "", "Empty blocks file");
    const validatedBlocksLines = validatedBlocksFileContent.split(/\r?\n/);

    assert.equal(validatedBlocksLines.length, 1, "Expected consensus to append a single block hash inside the blocks file");
}

module.exports = {
    assertSingleBlockFileEntry,
};
