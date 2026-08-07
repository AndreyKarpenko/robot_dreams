import dotenv from 'dotenv';
dotenv.config();

import express from 'express';

const PORT = Number(process.env.API_PORT) || 3000;
const app = express();

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

async function start() {
    app.listen(PORT, () => {
        console.log(`API listening on http:localhost::::${PORT}`);
    });
}

start().catch((error) => {
    console.error('Failed to start API:', error);
    process.exit(1);
});
