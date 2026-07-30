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
    const cleanQuery = query.toLowerCase().trim();
    const querySlug = cleanQuery.replace(/[^a-z0-9]+/g, '-');

    for (const domain of domains) {
        try {
            // 1. Try direct episode URL prediction first for maximum speed
            const directEpUrl = `${domain}/${querySlug}-episode-${epNum}`;
            try {
                const epRes = await axios.get(directEpUrl, { timeout: 6000 });
                const ep$ = cheerio.load(epRes.data);
                const iframe = ep$('.play-video iframe, iframe').attr('src');
                if (iframe) {
                    const videoUrl = iframe.startsWith('http') ? iframe : `https:${iframe}`;
                    console.log(`⚡ Instant Direct Gogo Match: [${query}] Ep ${epNum} -> ${videoUrl}`);
                    await saveToSupabase(query, epNum, "embed", videoUrl);
                    return videoUrl;
                }
            } catch (directErr) {}

            // 2. Search Gogoanime catalogue
            const searchUrl = `${domain}/search.html?keyword=${encodeURIComponent(query)}`;
            const res = await axios.get(searchUrl, { timeout: 8000 });
            const $ = cheerio.load(res.data);
            
            let chosenResult = $('ul.items li p.name a').first();
            $('ul.items li p.name a').each((_, el) => {
                const text = $(el).text().toLowerCase().trim();
                const href = $(el).attr('href') || '';
                if (text === cleanQuery || href.includes(querySlug)) {
                    chosenResult = $(el);
                }
            });

            if (!chosenResult.length) continue;
            const href = chosenResult.attr('href') || '';
            const seriesSlug = href.replace('/category/', '').replace('/anime/', '').replace(/\/$/, '');
            const episodeUrl = `${domain}/${seriesSlug}-episode-${epNum}`;
            
            const epRes = await axios.get(episodeUrl, { timeout: 8000 });
            const ep$ = cheerio.load(epRes.data);
            const iframe = ep$('.play-video iframe, iframe').attr('src');
            
            if (iframe) {
                const videoUrl = iframe.startsWith('http') ? iframe : `https:${iframe}`;
                console.log(`✅ Gogo Mined: [${query}] Ep ${epNum} -> ${videoUrl}`);
                await saveToSupabase(query, epNum, "embed", videoUrl);
                return videoUrl;
            }
        } catch (e: any) {
            console.error(`Gogo Light failed on ${domain}: ${e.message}`);
        }
    }
    return null;
}
