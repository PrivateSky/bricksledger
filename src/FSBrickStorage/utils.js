/** @deprecated */
process.env.FOLDER_NAME_SIZE;

const HASH_MAX_SIZE = process.env.FOLDER_NAME_SIZE || 5;

function verifyBrickHash(brickHash) {
    if (!brickHash || typeof brickHash !== 'string') {
        throw Error('[Bricking] No hash specified');
    }

    if (brickHash.length < HASH_MAX_SIZE) {
        throw Error(`[Bricking] Hash "${brickHash}" is too small`);
    }
}

function convertReadableStreamToBuffer(readStream, callback) {
    let buffers = [];

    readStream.on('data', (chunk) => buffers.push(chunk));

    readStream.on('error', (error) => callback(error));

    readStream.on('end', () => callback(undefined, $$.Buffer.concat(buffers)));
}

async function convertReadableStreamToBufferAsync(readStream) {
    return $$.promisify(convertReadableStreamToBuffer)(readStream);
}

module.exports = {
    HASH_MAX_SIZE,
    verifyBrickHash,
    convertReadableStreamToBuffer,
    convertReadableStreamToBufferAsync
}