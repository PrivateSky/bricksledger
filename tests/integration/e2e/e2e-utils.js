require("../../../../../psknode/bundles/testsRuntime");
const testIntegration = require("../../../../../psknode/tests/util/tir");

const dc = require("double-check");
const assert = dc.assert;

const { sleep, getRandomInt, sortArrayByField, Timer } = require("../../utils");
const { launchApiHubTestNodeWithContractAsync } = require("../utils");

const openDSU = require("opendsu");
const http = openDSU.loadApi("http");
const keySSIApi = openDSU.loadApi("keyssi");
const contractsApi = openDSU.loadApi("contracts");
const crypto = openDSU.loadApi("crypto");
const generateSafeCommandFor = $$.promisify(contractsApi.generateSafeCommandForSpecificServer);
const generateNoncedCommandFor = $$.promisify(contractsApi.generateNoncedCommandForSpecificServer);

const domain = "contract";

async function makeNewBlockNotificationsRequest(nodeUrl, validatorDID, onNewBlock) {
    let url = `${nodeUrl}/notifications/subscribe/${validatorDID}`;
    const timeout = 0;
    let options = {
        method: "POST",
    };

    try {
        const response = await http.poll(url, options, timeout);
        if (response.ok) {
            const notification = await response.json();
            const message = JSON.parse(notification.message);
            if (message.type === "newBlock") {
                const blockInfo = message.payload;
                onNewBlock(blockInfo);
            }
        }
    } catch (error) {
        console.log(`Notification error for validator ${validatorDID} at ${nodeUrl}`, error);
    }

    makeNewBlockNotificationsRequest(nodeUrl, validatorDID, onNewBlock);
}

async function loadFullBlock(nodeUrl, blockHash) {
    if (!blockHash) {
        console.trace("null blockhash");
        throw new Error("e");
    }
    const getBlockExecution = await generateSafeCommandFor(nodeUrl, domain, "consensus", "getBlock", [blockHash]);
    const block = getBlockExecution.optimisticResult;
    const { pbs } = block;
    block.hash = blockHash;
    block.pBlocks = [];

    if (pbs) {
        for (let i = 0; i < pbs.length; i++) {
            const pBlockHash = pbs[i];
            const pBlockExecution = await generateSafeCommandFor(nodeUrl, domain, "consensus", "getPBlock", [pBlockHash]);
            block.pBlocks.push(pBlockExecution.optimisticResult);
        }
    }

    return block;
}

async function ensureNoMissingBlocksBetweenLoadedBlocks(loadedBlocks, nodeUrl) {
    let needToRecheck = false;
    for (let i = 0; i < loadedBlocks.length; i++) {
        const loadedBlock = loadedBlocks[i];
        const needToPreviousBlock =
            (i == 0 && loadedBlock.previousBlock) || (i > 0 && loadedBlock.previousBlock !== loadedBlocks[i - 1].hash);
        if (needToPreviousBlock) {
            const previousMissingBlock = await loadFullBlock(nodeUrl, loadedBlock.previousBlock);

            // it could be possible that the missing block to be populated already, considering the new block messages don't arrive in order
            const isBlockPresent = loadedBlocks.some((block) => block.blockNumber === previousMissingBlock.blockNumber);
            if (!isBlockPresent) {
                const indexToInsertMissingBlock = i == 0 ? 0 : i - 1;
                loadedBlocks.splice(indexToInsertMissingBlock, 0, previousMissingBlock);
                sortArrayByField(loadedBlocks, "blockNumber");
            }

            needToRecheck = true;
            break;
        }
    }

    if (needToRecheck) {
        await ensureNoMissingBlocksBetweenLoadedBlocks(loadedBlocks, nodeUrl);
    }
}

function attachBricksledgerNotificationsToValidator(validator) {
    validator.bricksledgerNewBlocksNotifications = [];
    validator.bricksledgerNewBlocks = [];

    let newBlockNotificationSubscriptions = [];
    validator.subscribeToNewBlockNotification = (callback) => {
        newBlockNotificationSubscriptions.push(callback);
    };

    makeNewBlockNotificationsRequest(validator.url, validator.validatorDID, async (blockInfo) => {
        try {
            validator.bricksledgerNewBlocksNotifications.push(blockInfo);

            const block = await loadFullBlock(validator.url, blockInfo.hash);

            // it could be possible that meanwhile for ensureNoMissingBlocksBetweenLoadedBlocks to add the missing blocks when messages don't arrive in order
            const isBlockPresent = validator.bricksledgerNewBlocks.some(
                (existingBlock) => existingBlock.blockNumber === block.blockNumber
            );
            if (!isBlockPresent) {
                validator.bricksledgerNewBlocks.push(block);
                sortArrayByField(validator.bricksledgerNewBlocks, "blockNumber");
                await ensureNoMissingBlocksBetweenLoadedBlocks(validator.bricksledgerNewBlocks, validator.url);
            }

            // notify subscribers
            newBlockNotificationSubscriptions.forEach((callback) => callback());
        } catch (error) {
            console.error("An error has occured while makeNewBlockNotificationsRequest", error);
        }
    });
}

async function launchApiHubTestNodeWithMultipleValidators(totalNumberOfValidators, initialCommandCount, contractsConfig) {
    if (typeof initialCommandCount === "object") {
        contractsConfig = initialCommandCount;
        initialCommandCount = 0;
    }

    initialCommandCount = initialCommandCount || 0;
    if (!contractsConfig) {
        contractsConfig = {
            maxPBlockSize: 1,
            maxPBlockTimeMs: 10000,
            pendingBlocksTimeoutMs: 10000,
        };
    }

    const validators = [];
    const mainValidator = await launchApiHubTestNodeWithContractAsync(contractsConfig, {
        useWorker: true,
    });
    attachBricksledgerNotificationsToValidator(mainValidator);
    const mainValidatorUrl = mainValidator.url;
    const contractConstitution = mainValidator.contractConstitution;
    validators.push(mainValidator);

    const opendsu = require("opendsu");
    const contractsApi = opendsu.loadApi("contracts");
    const generateSafeCommand = $$.promisify(contractsApi.generateSafeCommandForSpecificServer);
    const generateNoncedCommand = $$.promisify(contractsApi.generateNoncedCommandForSpecificServer);

    if (initialCommandCount) {
        for (let i = 0; i < initialCommandCount; i++) {
            await generateNoncedCommand(mainValidator.validatorURL, mainValidator.validatorDID, domain, "test", "nonced");
        }
    }

    for (let i = 0; i < totalNumberOfValidators - 1; i++) {
        const nodePort = await testIntegration.getRandomAvailablePortAsync();
        const nodeUrl = `http://localhost:${nodePort}`;
        const node = await testIntegration.launchConfigurableApiHubTestNodeAsync({
            useWorker: true,
            generateValidatorDID: true,
            port: nodePort,
            domains: [{ name: domain, config: { contracts: { ...contractsConfig, constitution: contractConstitution } } }],
            bdns: {
                default: {
                    replicas: [],
                    notifications: [nodeUrl],
                    brickStorages: [nodeUrl, mainValidatorUrl],
                    anchoringServices: [nodeUrl, mainValidatorUrl],
                    contractServices: [nodeUrl],
                    validators: [{ DID: mainValidator.validatorDID, URL: mainValidator.validatorURL }],
                },
                contract: {
                    replicas: [],
                    notifications: [nodeUrl],
                    brickStorages: [nodeUrl, mainValidatorUrl],
                    anchoringServices: [nodeUrl, mainValidatorUrl],
                    contractServices: [nodeUrl],
                    validators: [{ DID: mainValidator.validatorDID, URL: mainValidator.validatorURL }],
                },
            },
        });
        attachBricksledgerNotificationsToValidator(node);

        console.log(`Adding new node ${node.validatorDID} to ${mainValidator.validatorDID}...`);

        const executionResult = await generateSafeCommand(node.validatorURL, domain, "consensus", "getLatestBlockInfo");
        const latestBlockInfo = executionResult.optimisticResult;
        console.log("latestBlockInfo is", latestBlockInfo);
        const expectedCurrentBlockNumber = initialCommandCount + i + 1; // each new node will trigger a nonced command when requesting to be added as validator
        assert.equal(
            latestBlockInfo.number,
            expectedCurrentBlockNumber,
            `Expected current block number to be ${expectedCurrentBlockNumber}, but is ${latestBlockInfo.number}`
        );

        validators.push(node);
    }

    // await sleep(5000);

    return validators;
}

function areCommandListsEqual(commandList1, commandsList2) {
    commandList1 = commandList1 || [];
    commandsList2 = commandsList2 || [];

    const areEqual =
        commandList1.length === commandsList2.length &&
        commandList1.every((command1) => {
            const result = commandsList2.some((command2) => areCommandsEqual(command1, command2));
            return result;
        });
    return areEqual;
}

function areCommandsEqual(command1, command2) {
    const command1Hash = crypto.sha256(command1);
    const command2Hash = crypto.sha256(command2);
    return command1Hash === command2Hash;
}

function areBlocksEqual(block1, block2) {
    if (block1.pBlocks.length !== block2.pBlocks.length) {
        return false;
    }

    const arePBlocksEqual = block1.pBlocks.every((block1PBlock, pBlockIndex) => {
        const block2PBlock = block1.pBlocks[pBlockIndex];
        const arePBlockCommandsEqual = areCommandListsEqual(block1PBlock.commands, block2PBlock.commands);
        return arePBlockCommandsEqual;
    });

    return arePBlocksEqual;
}

async function areAllNodesWithSameBlocks(validators) {
    if (!validators.length || validators.length === 1) {
        return true;
    }

    const [firstValidator, ...restValidators] = validators;
    const firstValidatorBlockCount = firstValidator.bricksledgerNewBlocks.length;
    const allValidatorsHaveSameBlocksCount = validators.every(
        (validator) => validator.bricksledgerNewBlocks.length === firstValidatorBlockCount
    );
    if (!allValidatorsHaveSameBlocksCount) {
        return false;
    }

    for (let i = 0; i < firstValidatorBlockCount; i++) {
        const firstValidatorIBlock = firstValidator.bricksledgerNewBlocks[i];
        const isSameIBlockTheSame = restValidators.every((restValidator) =>
            areBlocksEqual(firstValidatorIBlock, restValidator.bricksledgerNewBlocks[i])
        );
        if (!isSameIBlockTheSame) {
            return false;
        }
    }

    return true;
}

async function sendCommandsToRandomNodes(nodes, commandCount, commandOrCommandsGenerator) {
    const results = [];
    const allCommands = []; // holds all the commands body

    let remainCommandCount = commandCount;
    while (remainCommandCount > 0) {
        try {
            const destinationNodeIndex = getRandomInt(0, nodes.length - 1);
            const destinationNode = nodes[destinationNodeIndex];

            const generateSafeCommand = (contractName, methodName, params) => {
                allCommands.push({
                    domain,
                    contractName,
                    methodName,
                    params,
                    type: "safe",
                });
                return generateSafeCommandFor(destinationNode.url, domain, contractName, methodName, params);
            };

            const generateNoncedCommand = (contractName, methodName, params) => {
                allCommands.push({
                    domain,
                    contractName,
                    methodName,
                    params,
                    type: "nonced",
                });
                return generateNoncedCommandFor(
                    destinationNode.url,
                    destinationNode.validatorDIDInstance,
                    domain,
                    contractName,
                    methodName,
                    params
                );
            };

            let commandOrCommands = commandOrCommandsGenerator({
                node: destinationNode,
                generateSafeCommand,
                generateNoncedCommand,
            });
            if (commandOrCommands instanceof Promise) {
                commandOrCommands = await commandOrCommands;
            }
            const commands = Array.isArray(commandOrCommands) ? commandOrCommands : [commandOrCommands];
            commands.forEach((command) => results.push(command));

            remainCommandCount -= commands.length;
        } catch (error) {
            console.error("An error has occurred while sending commands to random nodes. Skipping error", error);
        }
    }

    return {
        results,
        commands: allCommands,
    };
}

function areAllNodesSynchronizedAndWithAllCommands(nodes, sentCommands, expectedMinNumberOfCommands) {
    if (!nodes.length) {
        return true;
    }

    const areSameBlocksPresent = areAllNodesWithSameBlocks(nodes);
    if (!areSameBlocksPresent) {
        return false;
    }

    if (!sentCommands.length) {
        return false;
    }

    // remove the addDomainValidator commands from the blocks since this is an automated command
    const firstNodeBlocks = nodes[0].bricksledgerNewBlocks;
    const executedCommands = firstNodeBlocks
        .map((block) => block.pBlocks.map((pBlock) => pBlock.commands || []))
        .flat(2)
        .filter((command) => command.methodName !== "addDomainValidator");

    if (expectedMinNumberOfCommands != null && sentCommands.length < expectedMinNumberOfCommands) {
        // if the expectedMinNumberOfCommands is provided and the number of executed commands are less than expectedMinNumberOfCommands
        // then it means that not all commands have been executed yet
        return false;
    }

    const areAllCommandsExecuted = areCommandListsEqual(executedCommands, sentCommands);
    // if (!areAllCommandsExecuted && sentCommands.length / executedCommands.length > 0.9) {
    //     console.log(`@@@@ executedCommands count: ${executedCommands.length}, sentCommands count: ${sentCommands.length}`);
    //     const allBlocks = nodes.map((node) => node.bricksledgerNewBlocks);
    //     console.log("@@@@ all node blocks: ", JSON.stringify(allBlocks));
    //     console.log("@@@@ executed commands: ", JSON.stringify(executedCommands));
    //     console.log("@@@@ sent commands: ", JSON.stringify(sentCommands));
    // }

    return areAllCommandsExecuted;
}

async function launchNodesWithCommandRequiringConsensusGeneratorAndConsistencyChecks(
    nodeCount,
    commandCount,
    commandGenerator,
    testFinished,
    contractsConfig
) {
    let testTimer = new Timer();
    let startupTimer = new Timer();
    let commandsTimer = new Timer();
    let blocksTimer = new Timer();

    testTimer.start();
    startupTimer.start();
    const nodes = await launchApiHubTestNodeWithMultipleValidators(nodeCount, contractsConfig);
    startupTimer.end();

    let sentCommands = [];

    nodes.forEach((node) => {
        node.subscribeToNewBlockNotification(() => {
            if (areAllNodesSynchronizedAndWithAllCommands(nodes, sentCommands, commandCount)) {
                blocksTimer.end();
                testTimer.end();

                const firstNodeBlocks = nodes[0].bricksledgerNewBlocks;

                console.log("----------------------RESULTS----------------------");
                console.log(`${nodeCount} node(s) startup time (sequential): ${startupTimer.getDuration()}`);
                console.log(`${sentCommands.length} command(s) sent time (sequential): ${commandsTimer.getDuration()}`);
                console.log(`${firstNodeBlocks.length} block(s) consensus time: ${blocksTimer.getDuration()}`);
                console.log(`Total test time: ${testTimer.getDuration()}`);
                console.log("---------------------------------------------------");

                assert.true(true);
                testFinished();
            }
        });
    });

    commandsTimer.start();
    blocksTimer.start();
    const commandsAndResults = await sendCommandsToRandomNodes(nodes, commandCount, commandGenerator);
    commandsTimer.end();
    sentCommands = commandsAndResults.commands;
}

module.exports = {
    launchApiHubTestNodeWithMultipleValidators,
    sendCommandsToRandomNodes,
    areAllNodesWithSameBlocks,
    areCommandListsEqual,
    areAllNodesSynchronizedAndWithAllCommands,
    launchNodesWithCommandRequiringConsensusGeneratorAndConsistencyChecks,
};
