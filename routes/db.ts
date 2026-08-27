import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { supabase, buildVariants } from '../services/supabase';

export default async function dbRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

    // ── Fast Database Query Proxy for Frontend ──
    fastify.get('/api/db', async (request, reply) => {
        const { title, episode, searchVariants } = request.query as { 
            title?: string; 
            episode?: string; 
            searchVariants?: string;
        };

        if (!title || !episode) {
            return reply.status(400).send({ error: "Missing 'title' or 'episode' parameter" });
        }

        if (!supabase) {
            return reply.status(503).send({ error: 'Supabase is not configured on this server' });
        }

        const epNum = parseInt(episode);
        let variants: string[] = [];

        if (searchVariants) {
            try {
                variants = JSON.parse(searchVariants);
            } catch {
                variants = buildVariants(title);
            }
        } else {
            variants = buildVariants(title);
        }

        try {
            const { data, error } = await supabase
                .from('anime_links')
                .select('title, episode, url, type')
                .in('title', variants)
                .eq('episode', epNum);

            if (error) throw error;
            return reply.send(data || []);
        } catch (e: any) {
            fastify.log.error(e);
            return reply.status(500).send({ error: e.message });
        }
    });
}
