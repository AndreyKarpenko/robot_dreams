import 'reflect-metadata';

import { createApp } from './app';

const { server } = createApp();
const port = Number(process.env.API_PORT) || 3000;

server.listen(port);
