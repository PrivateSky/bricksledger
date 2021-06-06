require("../../../../../psknode/bundles/testsRuntime");
const testIntegration = require("../../../../../psknode/tests/util/tir");
const dc = require("double-check");

const fs = require("fs");
const path = require("path");

async function launchApiHubTestNodeWithTestDomain(callback) {
    try {
        const rootFolder = await $$.promisify(dc.createTestFolder)("test");
        const domainsConfigPath = path.join(rootFolder, "/external-volume/config/domains");

        let serverConfig = {};

        const defaultDomainConfig = {
            anchoring: {
                type: "FS",
                option: {
                    path: "/internal-volume/domains/default/anchors",
                    enableBricksLedger: false,
                },
                commands: {
                    addAnchor: "anchor",
                },
            },
            bricking: {
                path: "/internal-volume/domains/default/brick-storage",
            },
            bricksFabric: {
                name: "BrickStorage",
                option: {
                    timeout: 15000,
                    transactionsPerBlock: 5,
                },
            },
        };

        await $$.promisify(testIntegration.storeFile)(domainsConfigPath, "default.json", JSON.stringify(defaultDomainConfig));

        await $$.promisify(testIntegration.storeServerConfig)(rootFolder, serverConfig);

        await $$.promisify(testIntegration.launchApiHubTestNode)(10, rootFolder);
        await $$.promisify(testIntegration.addDomainsInBDNS.bind(testIntegration))(rootFolder, ["contract"]);

        const contractSeedPath = path.join(rootFolder, ".contract-seed");
        const domainSeedPath = path.join(rootFolder, ".domain-seed");

        // build contract DSU type
        await $$.promisify(testIntegration.runOctopusScript)("buildDossier", [
            `--seed=${contractSeedPath}`,
            path.resolve(__dirname, "bin/build.file"),
        ]);
        const contractSeed = fs.readFileSync(contractSeedPath, { encoding: "utf8" });
        console.log("contractSeed", contractSeed);

        // create DSU for contract
        await $$.promisify(testIntegration.runOctopusScript)("createDomain", [
            `--dsu-type-ssi=${contractSeedPath}`,
            `--seed=${domainSeedPath}`,
        ]);
        const domainSeed = fs.readFileSync(domainSeedPath, { encoding: "utf8" });
        console.log("domainSeed", domainSeed);

        // store domain config

        testDomainConfig = {
            anchoring: {
                type: "Contract",
                option: {
                    path: "/external-volume/domains/contract/anchors",
                    enableBricksLedger: false,
                },
            },
            bricking: {
                path: "/external-volume/domains/contract/brick-storage",
            },

            contracts: {
                constitution: domainSeed,
            },
        };

        await $$.promisify(testIntegration.storeFile)(domainsConfigPath, "contract.json", JSON.stringify(testDomainConfig));

        const w3cDID = require("opendsu").loadApi("w3cdid");
        const validatorDID = await $$.promisify(w3cDID.createIdentity)("demo", "id");

        callback(null, {
            rootFolder,
            domainConfig: testDomainConfig,
            validatorDID,
        });
    } catch (error) {
        callback(error);
    }
}

module.exports = {
    launchApiHubTestNodeWithTestDomain,
};
