export function parseRequest(rawRequest){

    const lines = rawRequest.split('\r\n');
    const [requestLine, ...headerLines] = lines;
    const [method, path, version] = requestLine.split(' ');

    const headers = {}

    for (const line of headerLines) {
        if (!line) continue;
        const index = line.indexOf(':');

        if (index <= 0) {
            throw new Error('Invalid header');
        }

        const key = line.slice(0, index).trim().toLowerCase();
        headers[key] = line.slice(index + 1).trim();
    }
    
    return { method, path, version, headers }
}
