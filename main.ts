import Fastify from 'fastify';
import FastifyCors from '@fastify/cors';
import dotenv from 'dotenv';

import gogoanime from './routes/gogoanime';
import manga from './routes/manga';
import miningRoutes from './routes/mining';
import streamRoutes from './routes/stream';
import minerRoutes from './routes/miner';
import resolverRoutes from './routes/resolver';
import downloadRoutes from './routes/downloads';
import dbRoutes from './routes/db';

dotenv.config();

export const redis = null;

const fastify = Fastify({ logger: true });

// ── Global CORS Middleware ──
fastify.register(FastifyCors, {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// ── Register Route Plugins ──
fastify.register(streamRoutes);
fastify.register(minerRoutes);
fastify.register(resolverRoutes);
fastify.register(downloadRoutes);
fastify.register(dbRoutes);
fastify.register(miningRoutes);
fastify.register(gogoanime, { prefix: '/api/gogoanime' });
fastify.register(manga, { prefix: '/manga' });

// ── Root Health & Telemetry ──
fastify.get('/', async (request, reply) => {
    return {
        name: 'Ronin API Engine',
        version: '2.0.0',
        status: 'ONLINE',
        uptimeSeconds: Math.floor(process.uptime()),
        endpoints: {
            stream: '/api/stream/:query/:episode',
            resolve: '/api/resolve?url={embed_url}',
            downloads: '/api/downloads?title={title}&episode={ep}',
            triggerMiner: '/api/trigger-miner?title={title}&episode={ep}',
            dbLookup: '/api/db?title={title}&episode={ep}',
            manga: '/manga/:provider/:query'
        }
    };
});

// ── Start Fastify Server ──
const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

const start = async () => {
    try {
        await fastify.listen({ port: PORT, host: HOST });
        console.log(`🚀 Ronin API Server listening on http://${HOST}:${PORT}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();

export default fastify;
