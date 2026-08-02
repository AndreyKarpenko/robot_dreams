export function buildResponse(res) {
    const {body, statusCode, statusText, contentType} = res;
    const lines = [
        `HTTP/1.1 ${statusCode} ${statusText}`,
        `Content-Type: ${contentType}`,
        `Content-Length: ${Buffer.byteLength(body)}`,
        '',
        body,
    ];

    return lines.join('\r\n');
}
