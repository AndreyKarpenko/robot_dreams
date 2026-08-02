import net from 'node:net';

import { parseRequest } from './parser.mjs'
import { handleRequest } from './handler.mjs'
import { buildResponse } from './response.mjs'


const PORT = 3000;

const server = net.createServer((socket) => {
    let requestBuffer = '';
    socket.on('data', (chunk) => {
        requestBuffer += chunk.toString('latin1');

        const headerEnd = requestBuffer.indexOf('\r\n\r\n');

        if (headerEnd === -1) {
            return;
        }

        try {
            const request = parseRequest(requestBuffer);
            const response = handleRequest(request);
            const rawResponse = buildResponse(response);

            socket.write(rawResponse);
            socket.end();
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

    socket.on('error', (err) => {
        console.error(err);
    });
});

server.listen(PORT, () => {
    console.log(`HTTPS server listening on http://localhost:${PORT}`);
});