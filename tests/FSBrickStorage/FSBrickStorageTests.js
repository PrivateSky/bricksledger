require("../../../../psknode/bundles/testsRuntime");

const dc = require("double-check");
const assert = dc.assert;

// mocking

function* counter(value = 0) {
    while (true) {
        yield value;
        value++;
    }
}

const iterator = {
    server: counter(),
    domain: counter()
};

function mockDomain() {
    return {
        domainName: `test-domain-${iterator.domain.next().value}`,
        domainFolder: "/internal-volume/domains/default/brick-storage"
    };
}

async function mockServerRoot() {
    const name = `test-server-${iterator.server.next().value}-`;
    return await $$.promisify(dc.createTestFolder)(name);
}

// tests

const { createFSBrickStorage } = require("../../")

assert.callback("FSBrickStorage", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();

    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);
    assert.notNull(fsBrickStorage, '-> FSBrickStorage initialized');

    const expectedMethods = [
        'getBrick',
        'getBrickAsync',
        'addBrick',
        'addBrickAsync',
        'deleteBrick',
        'deleteBrickAsync',
        'utils'
    ];
    const actualMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(fsBrickStorage));

    for (const expectedMethod of expectedMethods) {
        assert.true(actualMethods.includes(expectedMethod), `-> FSBrickStorage does not contain method "${expectedMethod}"`);
    }

    // assert.arraysMatch(actualMethods, expectedMethods, "-> FSBrickStorage does not have all the required methods");

    testFinished();
})

assert.callback("addBrick and getBrick with strings", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();
    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);
    const expectedData = "some data";
    fsBrickStorage.addBrick(expectedData, (error, hash) => {
        fsBrickStorage.getBrick(hash, (error, actualData) => {
            assert.equal(expectedData, actualData);
            testFinished();
        });
    });
});

assert.callback("addBrick and getBrick with Buffers", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();
    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);
    const expectedData = "data";
    fsBrickStorage.addBrick(Buffer.from(expectedData), (error, hash) => {
        fsBrickStorage.getBrick(hash, (error, actualData) => {
            assert.equal(expectedData, actualData);
            testFinished();
        });
    });
});

assert.callback("addBrickAsync and getBrickAsync", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();

    const datasets = [
        "dummy data",
        JSON.stringify({ email: "john.doe@example.com", userName: "John Doe", id: 1 }),
    ];

    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);

    for (const expectedData of datasets) {
        const hash = await fsBrickStorage.addBrickAsync(expectedData);
        const actualData = await fsBrickStorage.getBrickAsync(hash);
        assert.equal(expectedData, actualData);
    }

    const expectedData = "buffered data";
    const hash = await fsBrickStorage.addBrickAsync(Buffer.from(expectedData));
    const actualData = await fsBrickStorage.getBrickAsync(hash);
    assert.equal(expectedData, actualData);

    testFinished();
});



