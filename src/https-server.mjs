import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

import { parseRequest } from './parser.mjs'
import { handleRequest } from './handler.mjs'
import { buildResponse } from './response.mjs'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3443;

const server = tls.createServer({
    key: fs.readFileSync(path.join(__dirname, '../cert/server.key')),
    cert: fs.readFileSync(path.join(__dirname, '../cert/server.pem')),
}, (socket) => {
    let requestBuffer = '';

    socket.on('data', (chunk) => {
        requestBuffer += chunk.toString('latin1');

        if (!requestBuffer.includes('\r\n\r\n')) {
            return;
        }

        try {
            const request = parseRequest(requestBuffer);

            const response = handleRequest(request);

            const rawResponse = buildResponse(response);

            socket.end(rawResponse);
        } catch (error) {
            socket.end(
                buildResponse({
                    statusCode: 400,
                    statusText: 'Bad Request',
                    contentType: 'text/plain',
                    body: '400 Bad Request',
                })
            );
        }

    });

    socket.on('error', console.error);

});

server.listen(PORT, () => {
    console.log(`HTTPS server listening on https://localhost:${PORT}`);
});
