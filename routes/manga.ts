import { FastifyRequest, FastifyReply, FastifyInstance, RegisterOptions } from 'fastify';
import MangaRead from '../providers/mangaread';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// Initialize Supabase Client[cite: 7]
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_KEY || '';
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

async function saveMangaToSupabase(title: string, mangaId: string, provider: string) {
    if (!supabase) return;
    const { error } = await supabase.from('manga_links').upsert(
        { title: title.toLowerCase().trim(), manga_id: mangaId, provider },
        { onConflict: 'title, provider' }
    );
    if (error) console.error(`❌ Supabase manga error:`, error.message);
    else console.log(`✅ Saved Manga: [${title}] (${provider})`);
}

const routes = async (fastify: FastifyInstance, options: RegisterOptions) => {
  const mangaread = new MangaRead();
  
  const getProvider = (providerName: string) => {
      // Defaulting all requests to MangaRead since MangaDex/Comick are removed[cite: 7]
      return mangaread; 
  };

  fastify.get('/', (_, rp) => {
    rp.status(200).send({
      intro: "Welcome to the Manga provider.",
      routes: [
        '/:provider/:query',
        '/:provider/info/:id',
        '/:provider/read/:chapterId',
      ],
    });
  });

  fastify.get('/:provider/:query', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider, query } = request.params as { provider: string, query: string };
    const page = (request.query as { page: number }).page || 1;
    const mangaProvider = getProvider(provider);

    try {
        const res = await mangaProvider.search(query, page);
        reply.status(200).send(res);
    } catch (err: any) {
        reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/:provider/info/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider, id } = request.params as { provider: string, id: string };
    const mangaProvider = getProvider(provider);

    try {
        const res = await mangaProvider.fetchMangaInfo(id);
        
        // Save to supabase in background[cite: 7]
        if (typeof res.title === 'string') {
           saveMangaToSupabase(res.title, res.id, mangaProvider.name).catch(() => {});
        } else if (res.title && typeof res.title === 'object' && res.title.english) {
           saveMangaToSupabase(res.title.english, res.id, mangaProvider.name).catch(() => {});
        }
        
        reply.status(200).send(res);
    } catch (err: any) {
        reply.status(500).send({ error: err.message });
    }
  });

  fastify.get('/:provider/read/:chapterId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { provider, chapterId } = request.params as { provider: string, chapterId: string };
    const mangaProvider = getProvider(provider);

    try {
        // MangaRead requires the chapter path, not just the ID[cite: 7]
        const res = await mangaProvider.fetchChapterPages(chapterId);
        reply.status(200).send(res);
    } catch (err: any) {
        reply.status(500).send({ error: err.message });
    }
  });
};

export default routes;
