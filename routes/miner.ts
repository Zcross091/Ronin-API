import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { triggerGitHubMiner } from '../services/github_miner';

export default async function minerRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

    // ── On-Demand Miner Trigger (GET) ──
    fastify.get('/api/trigger-miner', async (request, reply) => {
        const { title, episode, source } = request.query as { title?: string; episode?: string; source?: string };

        if (!title) {
            return reply.status(400).send({ error: "Missing required 'title' query parameter" });
        }

        const epNum = parseInt(episode || '1') || 1;
        const result = await triggerGitHubMiner(title, epNum, source);

        return reply.status(result.success ? 200 : 500).send(result);
    });

    // ── On-Demand Miner Trigger (POST) ──
    fastify.post('/api/trigger-miner', async (request, reply) => {
        const { title, episode, source } = (request.body || {}) as { title?: string; episode?: number | string; source?: string };

        if (!title) {
            return reply.status(400).send({ error: "Missing required 'title' in request body" });
        }

        const epNum = typeof episode === 'number' ? episode : (parseInt(episode || '1') || 1);
        const result = await triggerGitHubMiner(title, epNum, source);

        return reply.status(result.success ? 200 : 500).send(result);
    });
}
