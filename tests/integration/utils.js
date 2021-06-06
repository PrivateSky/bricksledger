require("../../../../psknode/bundles/testsRuntime");
const testIntegration = require("../../../../psknode/tests/util/tir");
const dc = require("double-check");

const fs = require("fs");
const path = require("path");

async function launchApiHubTestNode(callback) {
    try {
        const constants = require("opendsu").constants;

        const rootFolder = await $$.promisify(dc.createTestFolder)("test");

        let serverConfig = {
            endpointsConfig: {
                anchoring: {
                    domainStrategies: {
                        contract: {
                            type: "Contract",
                            option: {
                                path: "/external-volume/domains/contract/anchors",
                                enableBricksLedger: false,
                            },
                        },
                    },
                },
                bricking: {
                    domains: {
                        contract: {
                            path: "/external-volume/domains/contract/brick-storage",
                        },
                    },
                },
                contracts: {
                    domainsPath: "/external-volume/domains",
                },
            },
        };

        await $$.promisify(testIntegration.storeServerConfig)(rootFolder, serverConfig);

        await $$.promisify(testIntegration.launchApiHubTestNode)(10, rootFolder);

        callback(null, {
            rootFolder,
            baseUrl: process.env[constants.BDNS_ROOT_HOSTS],
        });
    } catch (error) {
        callback(error);
    }
}

module.exports = {
    launchApiHubTestNode,
};
