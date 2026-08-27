import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { getCachedStreams, saveStreamToSupabase } from '../services/supabase';
import { triggerGitHubMiner } from '../services/github_miner';
import { scrapeGogoanimeLight } from '../scrapers/anime/gogoanime';
import { resolveEmbedUrl } from '../extractors';

const GOGO_DOMAINS = (process.env.GOGO_DOMAINS || 'https://gogoanime.or.at,https://gogoanimes.cv,https://gogoanime.ist,https://gogoanime.cl')
    .split(',')
    .map(d => d.trim())
    .filter(Boolean);

export default async function streamRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

    fastify.get('/api/stream/:query/:episode', async (request, reply) => {
        const { query, episode } = request.params as { query: string; episode: string };
        const epNum = parseInt(episode) || 1;
        const { source, dub, forceScrape } = request.query as { source?: string; dub?: string; forceScrape?: string };
        const isDub = dub === 'true' || dub === '1' || query.toLowerCase().endsWith(' dub');

        // ── 1. Check Supabase DB Cache (Unless forcing fresh scrape) ──
        if (forceScrape !== 'true') {
            const cached = await getCachedStreams(query, epNum, isDub);
            if (cached && cached.length > 0) {
                request.log.info(`⚡ [Stream] 0ms Supabase Cache hit for "${query}" Ep ${epNum} (Dub: ${isDub})`);
                return {
                    status: 200,
                    cached: true,
                    source: 'supabase_cache',
                    query,
                    episode: epNum,
                    results: cached.map(item => ({
                        title: `${item.title} - Ep ${item.episode}`,
                        url: item.url,
                        type: item.type,
                        source: 'Supabase DB'
                    }))
                };
            }
        }

        // ── 2. Cache Miss: Run Fast Lightweight Scraper ──
        request.log.info(`🔍 [Stream] Cache miss for "${query}" Ep ${epNum}. Running instant scraper...`);
        try {
            const searchQuery = isDub ? `${query} (Dub)` : query;
            const embedUrl = await scrapeGogoanimeLight(searchQuery, epNum, GOGO_DOMAINS);

            if (embedUrl) {
                // Save resolved embed to Supabase
                const streamType = isDub ? 'dub' : 'sub';
                await saveStreamToSupabase(isDub ? `${query} dub` : query, epNum, streamType, embedUrl);

                // Extract direct video stream
                const resolved = await resolveEmbedUrl(embedUrl);

                return {
                    status: 200,
                    cached: false,
                    source: 'scraped_live',
                    query,
                    episode: epNum,
                    results: [
                        {
                            title: `${query} - Ep ${epNum}`,
                            url: embedUrl,
                            type: streamType,
                            source: 'Gogoanime Light',
                            directSources: resolved.sources
                        }
                    ]
                };
            }
        } catch (scrapeErr: any) {
            request.log.warn(`⚠️ Instant scraper failed: ${scrapeErr.message}`);
        }

        // ── 3. On-Demand GitHub Actions Runner Trigger ──
        request.log.info(`🤖 Dispatched on-demand GitHub Actions background miner for "${query}" Ep ${epNum}...`);
        const dispatchResult = await triggerGitHubMiner(query, epNum, source);

        return reply.status(202).send({
            status: 202,
            cached: false,
            miningTriggered: dispatchResult.success,
            message: dispatchResult.message,
            query,
            episode: epNum,
            hint: 'Stream was not immediately cached. A background miner has been queued to resolve and save it to the database.'
        });
    });
}
