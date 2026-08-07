import dotenv from 'dotenv';
dotenv.config();

import express from 'express';

import { initDb, pool } from './db';

const PORT = Number(process.env.API_PORT);
const app = express();

app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
});

app.get('/users', async (_req, res) => {
    try {
        const { rows } = await pool.query(
            'SELECT id, name, email FROM users ORDER BY id'
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('Failed to fetch users:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

async function start() {
    // await initDb();
    app.listen(PORT, () => {
        console.log(`API listening on http:localhost::::${PORT}`);
    });
}

start().catch((error) => {
    console.error('Failed to start API:', error);
    process.exit(1);
});
