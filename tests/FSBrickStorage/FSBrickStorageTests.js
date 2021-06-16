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

const iterators = {
    server: counter(),
    domain: counter()
};

function mockDomain() {
    return {
        domainName: `test-domain-${iterators.domain.next().value}`,
        domainFolder: "/internal-volume/domains/default/brick-storage"
    };
}

async function mockServerRoot() {
    const name = `test-server-${iterators.server.next().value}-`;
    return await $$.promisify(dc.createTestFolder)(name);
}

// tests

const { createFSBrickStorage } = require("../../");

assert.callback("createFSBrickStorage", async (testFinished) => {
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

    const expectedUtils = [
        'HASH_MAX_SIZE',
        'verifyBrickHash'
    ]
    const actualUtils = Object.getOwnPropertyNames(Object.getPrototypeOf(fsBrickStorage).utils);
    for (const expectedUtil of expectedUtils) {
        assert.true(actualUtils.includes(expectedUtil), `-> FSBrickStorage does not contain "utils.${expectedUtil}"`);
    }

    testFinished();
});

assert.callback("addBrick and getBrick with strings", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();
    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);
    const expectedData = "string data";
    fsBrickStorage.addBrick(expectedData, (error, hash) => {
        fsBrickStorage.getBrick(hash, (error, actualData) => {
            assert.equal(expectedData, actualData.toString());

            testFinished();
        });
    });
});

assert.callback("addBrick and getBrick with Buffers", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();
    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);
    const expectedData = Buffer.from("buffer data");
    fsBrickStorage.addBrick(expectedData, (error, hash) => {
        fsBrickStorage.getBrick(hash, (error, actualData) => {
            assert.true(expectedData.equals(actualData));

            testFinished();
        });
    });
});

assert.callback("deleteBrick", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();
    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);
    const expectedData = "some data";
    fsBrickStorage.addBrick(expectedData, (error, hash) => {
        fsBrickStorage.getBrick(hash, (error, actualData) => {
            assert.equal(expectedData, actualData.toString(), '-> there is an actual brick');

            fsBrickStorage.deleteBrick(hash, (error) => {
                assert.equal(typeof error, 'undefined', '-> brick deleted successfully');

                fsBrickStorage.getBrick(hash, (error, actualData) => {
                    assert.equal(error.code, 'ENOENT', '-> brick not found');
                    assert.equal(typeof actualData, 'undefined', '-> there is no brick data');

                    testFinished();
                });
            });
        });
    });
});

assert.callback("addBrickAsync and getBrickAsync", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();

    const datasets = [
        "dummy data",
        JSON.stringify({ email: "john.doe@example.com", userName: "John Doe", id: 1 })
    ];

    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);

    for (const expectedData of datasets) {
        const hash = await fsBrickStorage.addBrickAsync(expectedData);
        const actualData = await fsBrickStorage.getBrickAsync(hash);
        assert.equal(expectedData, actualData.toString());
    }

    const expectedData = Buffer.from("buffered data");
    const hash = await fsBrickStorage.addBrickAsync(expectedData);
    const actualData = await fsBrickStorage.getBrickAsync(hash);
    assert.true(expectedData.equals(actualData));

    testFinished();
});

assert.callback("deleteBrickASync", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();
    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);
    const expectedData = "some data";

    const hash = await fsBrickStorage.addBrickAsync(expectedData);
    let actualData = await fsBrickStorage.getBrickAsync(hash);
    assert.equal(expectedData, actualData.toString(), '-> there is an actual brick');

    await fsBrickStorage.deleteBrickAsync(hash);

    try {
        await fsBrickStorage.getBrickAsync(hash);
    } catch (error) {
        assert.equal(error.code, 'ENOENT', '-> brick not found');
    }

    testFinished();
});

assert.callback("utils.verifyBrickHash", async (testFinished) => {
    const { domainName, domainFolder } = mockDomain();
    const serverRoot = await mockServerRoot();
    const fsBrickStorage = createFSBrickStorage(domainName, domainFolder, serverRoot);

    const expectedData = "other data";
    const hash = await fsBrickStorage.addBrickAsync(expectedData);
    fsBrickStorage.utils.verifyBrickHash(hash);

    assert.equal(typeof fsBrickStorage.utils.HASH_MAX_SIZE, 'number', '-> HASH_MAX_SIZE is a number');

    testFinished();
});

// TODO: add a test for same "hash-cell" of "hash-table"
// (same brick directory of the brick file)
