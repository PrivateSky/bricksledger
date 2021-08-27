'use strict';

const os = require('os');
const fs = require('fs');

const END_OF_HASH_MARKER = '%';

class History {
    
    constructor(historyFile, timeWindow = 3600) {
        this.history = new Set();
        this.file = historyFile;
        this.timeWindow = new Date().getTime() - (timeWindow * 1000);
    }
    
    async init() {
        // TODO: start reading only the last X MB from the history file
        const readStream = fs.createReadStream(this.file, {
            highWaterMark: 64 * 1024,
            encoding: 'latin1' // no reason to use utf8 since only ASCII characters are stored in the history file
        });
        
        return new Promise((resolve, reject) => {
            let brokenLine = null;
            readStream
                .on('data', (chunk) => {
                    const lines = chunk.split(os.EOL);
                    // check if the last line is a full line
                    const lastLine = lines[lines.length - 1];
                    
                    // If a "broken line" exists, prepend it to the first line
                    // in this chunk
                    if (brokenLine !== null) {
                        lines[0] = brokenLine + lines[0];
                        brokenLine = null;
                    }
                    
                    // If the last line doesn't have the "end of hash" marker
                    // treat it as a broken line to be pickup up later
                    // on the next chunk
                    if (lastLine[lastLine.length - 1] !== END_OF_HASH_MARKER) {
                        brokenLine = lines.pop();
                    }

                    for (const line of lines) {
                        if (!line.length) {
                            continue;
                        }
                        let [ timestamp, hash ] = line.split(':');
                        timestamp = Number(timestamp);
                        
                        hash = hash.substr(0, hash.length - 1); // strip the end of hash marker
                        
                        if (timestamp < this.timeWindow) {
                            continue;
                        }
                        
                        this.history.add(hash);
                    }
                })
                .on('close', () => {
                    resolve();
                })
                .on('error', (err) => {
                    resolve(err);
                });
        })
    }
    
    async add(hash) {
        if (this.history.has(hash)) {
            throw new Error(`Command with hash ${hash} already executed`);
        }
        
        this.history.add(hash);

        const time = new Date().getTime();
        const line = `${time}:${hash}${END_OF_HASH_MARKER}${os.EOL}`;
        
        try {
            const streamWriter = fs.createWriteStream(this.file, { flags: "a" });
            await $$.promisify(streamWriter.write.bind(streamWriter))(line);
            streamWriter.close();
        } catch (e) {
            this.history.delete(hash);
            throw e; 
        }
    }
    
    has(hash) {
        return this.history.has(hash)
    }
    
}

module.exports = History;