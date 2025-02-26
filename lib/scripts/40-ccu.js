'use strict';


const fs = require('fs');
const getDate = require('../tools').getDate;
const path = require('path');

function command(options, log, callback) {

    const connectType = options.usehttps ? 'https' : 'http';

    const request = require('request');
    // Login
    request.post({
        url: `${connectType}://${options.host}/api/homematic.cgi`,
        body: JSON.stringify({
            method: 'Session.login',
            params: {
                username: options.user,
                password: options.pass
            }
        })
    },
        (err, response, body) => {
            if (err) {
                options.context.errors.ccu = err;
                return callback && callback(err);
            }

            try {
                body = JSON.parse(body);
            } catch (e) {
                options.context.errors.ccu = 'Cannot parse answer: ' + e;
                return callback && callback('Cannot parse answer: ' + e);
            }
            if (body.error) {
                options.context.errors.ccu = body.error.message || JSON.stringify(body.error);
                return callback && callback(body.error.message || JSON.stringify(body.error));
            }
            const sid = body.result;
            if (!sid) {
                return callback && callback('No session ID found');
            }

            // Get version
            request(`${connectType}://${options.host}/api/backup/version.cgi`, (err, response, body) => {
                const version = (body || '').split('\n')[0].split('=')[1] || 'Unknown';
                log.debug('CCU Version: ' + version);

                // Get backup
                log.debug('Requesting backup from CCU');

                const fileName = path.join(options.backupDir, `homematic_${getDate()}${options.nameSuffix ? '_' + options.nameSuffix : ''}_${version}_backupiobroker.tar.sbk`);

                options.context.fileNames.push(fileName);

                let createBackupError = null;

                const writeStream = fs.createWriteStream(fileName);
                writeStream.on('error', err => {
                    createBackupError = 'CCU: Cannot write file: ' + err;
                });

                const http = require(`${connectType}`);

                http.get(`${connectType}://${options.host}/config/cp_security.cgi?sid=@${sid}@&action=create_backup`, res => {
                    res.on('end', () => {
                        if (!res.complete) {
                            createBackupError = 'CCU: The connection was terminated while the message was still being sent';
                        }
                    });

                    res.pipe(writeStream);
                })
                    .on('error', err => {
                        createBackupError = 'CCU: Response Error: ' + err;
                    })
                    .on('close', () => {
                        // Logout
                        request.post({
                            url: `${connectType}://${options.host}/api/homematic.cgi`,
                            body: JSON.stringify({ method: 'Session.logout', params: { _session_id_: sid } })
                        },
                            (err, response, body) => {
                                const errs = [];
                                createBackupError && errs.push(createBackupError);

                                if (err) {
                                    errs.push(err);
                                    options.context.errors.ccu = errs.join(', ');
                                    return callback && callback(options.context.errors.ccu);
                                }

                                try {
                                    body = JSON.parse(body);
                                } catch (e) {
                                    errs.push('Cannot parse answer: ' + e);
                                    options.context.errors.ccu = errs.join(', ');
                                    return callback && callback(options.context.errors.ccu);
                                }
                                if (body.error) {
                                    errs.push(body.error.message || JSON.stringify(body.error));
                                    options.context.errors.ccu = errs.join(', ');
                                    return callback && callback(options.context.errors.ccu);
                                }
                                options.context.done.push('ccu');
                                options.context.types.push('homematic');
                                callback && callback();
                            });
                    });
            });
        });
}

module.exports = {
    command,
    ignoreErrors: true
};