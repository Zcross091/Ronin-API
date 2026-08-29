import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { triggerGitHubMiner, triggerMangaMiner } from '../services/github_miner';

export default async function minerRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

    // ── On-Demand Anime Miner Trigger (GET) ──
    fastify.get('/api/trigger-miner', async (request, reply) => {
        const { title, episode, source } = request.query as { title?: string; episode?: string; source?: string };

        if (!title) {
            return reply.status(400).send({ error: "Missing required 'title' query parameter" });
        }

        const epNum = parseInt(episode || '1') || 1;
        const result = await triggerGitHubMiner(title, epNum, source);

        return reply.status(result.success ? 200 : 500).send(result);
    });

    // ── On-Demand Anime Miner Trigger (POST) ──
    fastify.post('/api/trigger-miner', async (request, reply) => {
        const { title, episode, source } = (request.body || {}) as { title?: string; episode?: number | string; source?: string };

        if (!title) {
            return reply.status(400).send({ error: "Missing required 'title' in request body" });
        }

        const epNum = typeof episode === 'number' ? episode : (parseInt(episode || '1') || 1);
        const result = await triggerGitHubMiner(title, epNum, source);

        return reply.status(result.success ? 200 : 500).send(result);
    });

    // ── On-Demand Manga Miner Trigger (GET) ──
    fastify.get('/api/trigger-manga-miner', async (request, reply) => {
        const { title, chapter } = request.query as { title?: string; chapter?: string };

        if (!title) {
            return reply.status(400).send({ error: "Missing required 'title' parameter" });
        }

        const result = await triggerMangaMiner(title, chapter || '1');
        return reply.status(result.success ? 200 : 500).send(result);
    });

    // ── On-Demand Manga Miner Trigger (POST) ──
    fastify.post('/api/trigger-manga-miner', async (request, reply) => {
        const { title, chapter } = (request.body || {}) as { title?: string; chapter?: string };

        if (!title) {
            return reply.status(400).send({ error: "Missing required 'title' in request body" });
        }

        const result = await triggerMangaMiner(title, chapter || '1');
        return reply.status(result.success ? 200 : 500).send(result);
    });
}
