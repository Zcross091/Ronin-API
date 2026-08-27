import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { resolveEmbedUrl } from '../extractors';

export default async function resolverRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

    // ── Resolve Embed URL to Direct Video Stream (GET) ──
    fastify.get('/api/resolve', async (request, reply) => {
        const { url } = request.query as { url?: string };

        if (!url) {
            return reply.status(400).send({ error: "Missing 'url' query parameter" });
        }

        try {
            const result = await resolveEmbedUrl(url);
            if (result.success && result.sources.length > 0) {
                return {
                    status: 200,
                    success: true,
                    provider: result.provider,
                    sources: result.sources
                };
            } else {
                return reply.status(404).send({
                    status: 404,
                    success: false,
                    error: 'Could not extract direct video streams from provided embed URL.'
                });
            }
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });

    // ── Resolve Embed URL (POST) ──
    fastify.post('/api/resolve', async (request, reply) => {
        const { url } = (request.body || {}) as { url?: string };

        if (!url) {
            return reply.status(400).send({ error: "Missing 'url' in request body" });
        }

        try {
            const result = await resolveEmbedUrl(url);
            return reply.status(result.success ? 200 : 404).send(result);
        } catch (e: any) {
            return reply.status(500).send({ error: e.message });
        }
    });
}
