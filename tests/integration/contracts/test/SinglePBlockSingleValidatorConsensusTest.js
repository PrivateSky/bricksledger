require("../../../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

const bricksledger = require("../../../../index");
const { sleep } = require("../../../utils");
const { launchApiHubTestNodeWithTestDomainAsync } = require("../utils");
const { assertBlockFileEntries } = require("./utils");

assert.callback(
    "Run consensus core addInConsensusAsync for a single validator and single block with a single pBlock",
    async (testFinished) => {
        const domain = "contract";

        const { validatorDID, validatorURL, rootFolder, domainConfig } = await launchApiHubTestNodeWithTestDomainAsync();

        const config = {
            maxPBlockSize: 1,
            maxPBlockTimeMs: 10000,
            maxBlockTimeMs: 1000,
        };
        const initiliseBrickLedger = $$.promisify(bricksledger.initiliseBrickLedger);
        const bricksledgerInstance = await initiliseBrickLedger(
            validatorDID,
            validatorURL,
            domain,
            domainConfig,
            rootFolder,
            null,
            config
        );

        const command = bricksledger.createCommand({
            domain,
            contractName: "test",
            methodName: "safeWithConsensus",
            params: null,
            type: "safe",
        });

        await $$.promisify(bricksledgerInstance.executeSafeCommand)(command);

        await sleep(5000); // wait until block is created

        assertBlockFileEntries(rootFolder);

        testFinished();
    },
    10000
);
