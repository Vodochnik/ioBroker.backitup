'use strict';

const path = require('path');
const fs = require('fs');

async function copyFiles(client, dir, fileNames, log, errors, callback) {

    if (!fileNames || !fileNames.length) {
        callback();
    } else {
        let fileName = fileNames.shift();
        fileName = fileName.replace(/\\/g, '/');
        const onlyFileName = fileName.split('/').pop();

        if (fs.existsSync(fileName)) {
            try {
                const webdavFilename = path.join(dir, onlyFileName);

                log.debug('WebDAV: Copy ' + onlyFileName + '...');
                let fileContent = fs.readFileSync(fileName);
                //let fileContent = fs.createReadStream(fileName);

                // Upload File
                await client.putFileContents(webdavFilename, fileContent, {
                    //format: "binary", "Content-Type": "application/octet-stream", 'maxBodyLength': Infinity})
                    format: "binary", "Content-Type": "application/octet-stream", contentLength: fileContent.length})
                    .then(result => {
                        fileContent = null;
                        setImmediate(copyFiles, client, dir, fileNames, log, errors, callback);
                    });
            } catch (e) {
                log.error('WebDAV: ' + e);
                setImmediate(copyFiles, client, dir, fileNames, log, errors, callback)
            }
        } else {
            log.error('WebDAV: File "' + fileName + '" not found');
            setImmediate(copyFiles, client, dir, fileNames, log, errors, callback)
        }
    }
}

function deleteFiles(client, files, log, errors, callback) {
    if (!files || !files.length) {
        callback && callback();
    } else {
        log.debug('WebDAV: delete ' + files[0]);
        const file = files.shift();

        try {
            client.deleteFile(file)
                .then(result => {
                    setImmediate(deleteFiles, client, files, log, errors, callback);
                });

        } catch (e) {
            log.error('WebDAV: ' + e);
            setImmediate(deleteFiles, client, files, log, errors, callback);
        }
    }
}

async function cleanFiles(client, dir, names, num, log, errors, callback) {
    if (!num) {
        return callback && callback();
    }
    try {
        const result = await client.getDirectoryContents(dir.replace(/^\/$/, ''));

        if (result) {
            const files = [];
            names.forEach(name => {
                const subResult = result.filter(a => a.basename.startsWith(name));

                if (subResult.length > num) {
                    // delete oldest files
                    subResult.sort((a, b) => {
                        const at = new Date(a.lastmod).getTime();
                        const bt = new Date(b.lastmod).getTime();
                        if (at > bt) return -1;
                        if (at < bt) return 1;
                        return 0;
                    });

                    for (let i = num; i < subResult.length; i++) {
                        files.push(subResult[i].filename);
                    }
                }

            });
            deleteFiles(client, files, log, errors, callback);
        } else {
            callback && callback(err);
        }
    } catch (e) {
        callback && callback(e);
    }
}

async function command(options, log, callback) {

    if (options.username && options.pass && options.url && options.context.fileNames.length) {

        const fileNames = JSON.parse(JSON.stringify(options.context.fileNames));
        log.debug('Start WebDAV Upload ...');

        let dir = (options.dir || '').replace(/\\/g, '/');

        if (!dir || dir[0] !== '/') {
            dir = '/' + (dir || '');
        }

        const { createClient } = require("webdav");
        var agent = require("https").Agent({rejectUnauthorized: false});
        let client;

        try {
            client = createClient(
                options.url,
                {
                    username: options.username,
                    password: options.pass,
                    maxBodyLength: Infinity,
                    httpsAgent: agent
                }
            );
        } catch (err) {
            log.error(`cannot conntect to WebDAV: ${err}`);
            callback();
        }
        try {
            if (await client.exists(dir) === false) {
                await client.createDirectory(dir);
            }
        } catch (e) {
            log.debug('cannot created the backup directory: ' + e);
            callback();
        }

        try {
            client
                .getDirectoryContents(dir)
                .then(contents => {
                    copyFiles(client, dir, fileNames, log, options.context.errors, err => {
                        if (err) {
                            options.context.errors.webdav = err;
                            log.error('WebDAV: ' + err);
                        }
                        if (options.deleteOldBackup === true) {
                            cleanFiles(client, dir, options.context.types, options.deleteBackupAfter, log, options.context.errors, err => {
                                if (err) {
                                    options.context.errors.webdav = options.context.errors.webdav || err;
                                } else {
                                    !options.context.errors.webdav && options.context.done.push('webdav');
                                }
                                callback(err);
                            });
                        } else {
                            !options.context.errors.webdav && options.context.done.push('webdav');
                            callback(err);
                        }
                    });
                        
                })
                .catch(err => {
                    log.error(`cannot conntect to WebDAV: ${err}`);
                    callback();
                });
        } catch (e) {
            log.debug(`Error WebDAV-Upload: ${e}`);
            callback(e);
        }
    } else {
        callback();
    }
}

module.exports = {
    command,
    ignoreErrors: true
};
