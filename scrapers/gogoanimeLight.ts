import axios from 'axios';
import * as cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_KEY || "";
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

async function saveToSupabase(title: string, episode: number, type: string, url: string) {
    if (!supabase) return;
    const { error } = await supabase.from('anime_links').upsert(
        { title: title.toLowerCase().trim(), episode, type, url },
        { onConflict: 'title, episode, type' }
    );
    if (error) console.error("❌ Supabase Error:", error);
    else console.log(`✅ Cached to Supabase: [${title}] Ep ${episode} -> ${url}`);
}

export async function scrapeGogoanimeLight(query: string, epNum: number, domains: string[]): Promise<string | null> {
    for (const domain of domains) {
        try {
            const searchUrl = `${domain}/search.html?keyword=${encodeURIComponent(query)}`;
            const res = await axios.get(searchUrl, { timeout: 8000 });
            const $ = cheerio.load(res.data);
            
            const firstResult = $('ul.items li p.name a').first();
            if (!firstResult.length) continue;
            
            const seriesSlug = firstResult.attr('href')?.replace('/category/', '');
            const episodeUrl = `${domain}/${seriesSlug}-episode-${epNum}`;
            
            const epRes = await axios.get(episodeUrl, { timeout: 8000 });
            const ep$ = cheerio.load(epRes.data);
            const iframe = ep$('.play-video iframe').attr('src');
            
            if (iframe) {
                const videoUrl = iframe.startsWith('http') ? iframe : `https:${iframe}`;
                await saveToSupabase(query, epNum, "http", videoUrl);
                return videoUrl;
            }
        } catch (e: any) {
            console.error(`Server 1 failed on ${domain}: ${e.message}`);
        }
    }
    return null;
}
