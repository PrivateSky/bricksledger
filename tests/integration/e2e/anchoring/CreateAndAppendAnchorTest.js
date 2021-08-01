require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const { launchApiHubTestNodeWithContractAsync } = require("../../utils");
const { assertArrayLength } = require("../../../utils");

const opendsu = require("opendsu");
const keySSIApi = opendsu.loadApi("keyssi");
const contractsApi = opendsu.loadApi("contracts");
const generateSafeCommand = $$.promisify(contractsApi.generateSafeCommand);

const domain = "contract";

async function assertTwoVersionsPresentForAnchor(anchorId, firstHashLink, secondHashLink) {
    // after the second appending to anchor
    const getAllVersionsExecution = await generateSafeCommand(domain, "anchoring", "getAllVersions", [anchorId]);
    assertArrayLength(getAllVersionsExecution.optimisticResult, 2, "Expected for append to anchor to have two versions");
    assert.equal(
        getAllVersionsExecution.optimisticResult[0],
        firstHashLink,
        "Expected to have the previous hashLink in the versions"
    );
    assert.equal(
        getAllVersionsExecution.optimisticResult[1],
        secondHashLink,
        "Expected to have the new hashLink in the versions"
    );

    const getLatestVersionExecution = await generateSafeCommand(domain, "anchoring", "getLatestVersion", [anchorId]);
    assert.equal(
        getLatestVersionExecution.optimisticResult,
        secondHashLink,
        "Expected to have the new hashLink as the last version"
    );
}

assert.callback(
    "Bricksledger - create anchor and append into same anchor two hashlinks and another invald one",
    async (testFinished) => {
        await launchApiHubTestNodeWithContractAsync({
            maxPBlockSize: 1,
            maxPBlockTimeMs: 10000,
            pendingBlocksTimeoutMs: 1000,
        });

        const seedSSI = keySSIApi.createSeedSSI(domain);
        const anchorId = seedSSI.getAnchorId();

        const timestamp = Date.now();
        let dataToSign = `${timestamp}${anchorId}`;

        const signature = await $$.promisify(seedSSI.sign)(dataToSign);
        const signedHashLinkSSI = keySSIApi.createSignedHashLinkSSI(domain, "HASH1", timestamp, signature, seedSSI.getVn());

        const dataToSign2 = `${signedHashLinkSSI.getIdentifier()}${timestamp}${anchorId}`;
        const signature2 = await $$.promisify(seedSSI.sign)(dataToSign2);
        const signedHashLinkSSI2 = keySSIApi.createSignedHashLinkSSI(domain, "HASH2", timestamp, signature2, seedSSI.getVn());

        // before creating anchor
        let getAllVersionsExecution = await generateSafeCommand(domain, "anchoring", "getAllVersions", [anchorId]);
        assertArrayLength(getAllVersionsExecution.optimisticResult, 0, "Expected to have no existing version for anchorId");

        let getLatestVersionExecution = await generateSafeCommand(domain, "anchoring", "getLatestVersion", [anchorId]);
        assert.true(
            getLatestVersionExecution.optimisticResult == null,
            "Expected to have no existing latest version for anchorId"
        );

        // creating the anchor
        const createAnchorExecution = await generateSafeCommand(domain, "anchoring", "createAnchor", [anchorId]);
        assert.true(!createAnchorExecution.optimisticResult, "Expected to have no result when creating the anchor");

        getAllVersionsExecution = await generateSafeCommand(domain, "anchoring", "getAllVersions", [anchorId]);
        assertArrayLength(getAllVersionsExecution.optimisticResult, 0, "Expected for newly created anchor to have no versions");

        // after creating the anchor
        getLatestVersionExecution = await generateSafeCommand(domain, "anchoring", "getLatestVersion", [anchorId]);
        assert.true(
            getLatestVersionExecution.optimisticResult == null,
            "Expected for newly created anchor to have no latest version"
        );

        // append to anchor
        const hashLinkIds = { last: null, new: signedHashLinkSSI.getIdentifier() };
        const digitalProof = null;
        const zkp = null;
        let appendToAnchorExecution = await generateSafeCommand(domain, "anchoring", "appendToAnchor", [
            anchorId,
            hashLinkIds,
            digitalProof,
            zkp,
        ]);
        assert.true(!appendToAnchorExecution.optimisticResult, "Expected to have no result when appending to anchor");

        // after appending to anchor
        getAllVersionsExecution = await generateSafeCommand(domain, "anchoring", "getAllVersions", [anchorId]);
        assertArrayLength(getAllVersionsExecution.optimisticResult, 1, "Expected for newly append to anchor to have one version");
        assert.equal(
            getAllVersionsExecution.optimisticResult[0],
            hashLinkIds.new,
            "Expected to have the initial hashLink in the versions"
        );

        getLatestVersionExecution = await generateSafeCommand(domain, "anchoring", "getLatestVersion", [anchorId]);
        assert.equal(
            getLatestVersionExecution.optimisticResult,
            hashLinkIds.new,
            "Expected to have the initial hashLink as the last version"
        );

        // another append to anchor
        const hashLinkIds2 = { last: signedHashLinkSSI.getIdentifier(), new: signedHashLinkSSI2.getIdentifier() };
        appendToAnchorExecution = await generateSafeCommand(domain, "anchoring", "appendToAnchor", [
            anchorId,
            hashLinkIds2,
            digitalProof,
            zkp,
        ]);
        assert.true(!appendToAnchorExecution.optimisticResult, "Expected to have no result when appending to anchor");

        // after the second appending to anchor
        await assertTwoVersionsPresentForAnchor(anchorId, hashLinkIds2.last, hashLinkIds2.new);

        // append the same previous hashlink to anchor
        try {
            appendToAnchorExecution = await generateSafeCommand(domain, "anchoring", "appendToAnchor", [
                anchorId,
                hashLinkIds2,
                digitalProof,
                zkp,
            ]);
            assert.true(false, "Expected the appendToAnchor command to fail");
        } catch (error) {
            assert.notNull(error);
        }

         // ensure that the same versions have been kept after trying to add a invalid version
         await assertTwoVersionsPresentForAnchor(anchorId, hashLinkIds2.last, hashLinkIds2.new);

        testFinished();
    },
    10000
);
