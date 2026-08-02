export function handleRequest(req) {

    const { method, path, headers } = req;

    if (method === 'GET' && path === '/') {
        return {
            statusCode: 200,
            statusText: 'OK',
            contentType: 'text/plain',
            body: 'Hello from raw HTTP server!',
        };
    }

    if (method === 'GET' && path === '/headers') {

        const headerLines = Object.entries(headers).map(([key, value]) => `${key}: ${value}`);
        return {
            statusCode: 200,
            statusText: 'OK',
            contentType: 'text/plain',
            body: headerLines.join('\n'),
        };
    }

    return {
        statusCode: 404,
        statusText: 'Not Found',
        contentType: 'text/plain',
        body: '404 Not Found',
    };
}
