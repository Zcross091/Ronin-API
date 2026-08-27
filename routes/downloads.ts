import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { searchNyaaTorrents } from '../scrapers/downloads/nyaa';
import { saveStreamToSupabase } from '../services/supabase';

export default async function downloadRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

    // ── Torrent Magnet Search Endpoint ──
    fastify.get('/api/downloads', async (request, reply) => {
        const { title, episode, saveToDb } = request.query as { title?: string; episode?: string; saveToDb?: string };

        if (!title) {
            return reply.status(400).send({ error: "Missing required 'title' parameter" });
        }

        const epNum = episode ? parseInt(episode) : undefined;
        try {
            const results = await searchNyaaTorrents(title, epNum);

            // Optional auto-caching top magnet to Supabase
            if (saveToDb === 'true' && results.length > 0 && epNum) {
                const bestMagnet = results[0].magnet;
                await saveStreamToSupabase(title, epNum, 'torrent', bestMagnet);
            }

            return {
                status: 200,
                success: true,
                query: title,
                episode: epNum,
                totalResults: results.length,
                results
            };
        } catch (e: any) {
            fastify.log.error(e);
            return reply.status(500).send({ error: e.message });
        }
    });
}
