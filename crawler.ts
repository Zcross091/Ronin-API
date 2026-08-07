import { ExtensionRunner } from './engine/sandbox';
import { mineExtensionAllEpisodes } from './engine/waterfall';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

import { mineTrendingAndPopular } from './scrapers/anime/gogoanime';

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
    else console.log(`✅ Cached: [${title}] Ep ${episode} -> ${url}`);
}

const EXTENSION_PATH = path.join(__dirname, 'extensions/m2k3a-extensions/javascript/anime/src/en/allanime.js');

async function runCrawler() {
    console.log(`\n🕸️ Starting Ronin Fast Auto-Crawler 🕸️`);
    
    // Phase 0: Deep Mine GogoAnime 200+ Trending & Popular Series
    try {
        await mineTrendingAndPopular(10);
    } catch (gogoErr: any) {
        console.error(`⚠️ GogoAnime Auto-Crawler phase failed:`, gogoErr.message);
    }

    console.log(`\nUsing primary extension: ${EXTENSION_PATH}`);
    
    let runner: ExtensionRunner;
    try {
        runner = new ExtensionRunner(EXTENSION_PATH);
        await runner.load();
    } catch (e: any) {
        console.error(`❌ Failed to load extension for crawling: ${e.message}`);
        process.exit(1);
    }

    const maxPages = 5;
    
    // 1. Crawl Popular Anime (Sub & Dub)
    console.log(`\n🔥 Phase 1: Crawling Popular Anime (Sub & Dub)`);
    for (let page = 1; page <= maxPages; page++) {
        console.log(`\n📄 Fetching Popular Page ${page}...`);
        try {
            const resultStr = await runner.getPopular(page);
            const result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
            const animes = result.list || [];
            
            if (animes.length === 0) {
                console.log(`No more popular anime found.`);
                break;
            }

            for (const anime of animes) {
                const title = anime.name;
                if (!title) continue;

                console.log(`\n=================================================`);
                console.log(`💎 [CRAWLER] Fast Mining: "${title}"`);
                console.log(`=================================================`);
                
                // Mine SUB version via lightweight extension
                const { minedCount: subCount } = await mineExtensionAllEpisodes('allanime', title, 1, saveToSupabase);
                
                // Mine DUB version via lightweight extension
                const { minedCount: dubCount } = await mineExtensionAllEpisodes('allanime', `${title} dub`, 1, saveToSupabase);
                
                console.log(`📊 Total mined for "${title}": ${subCount} Sub episodes, ${dubCount} Dub episodes.`);
            }
            
            if (!result.hasNextPage) break;
        } catch (e: any) {
            console.error(`❌ Error crawling popular page ${page}:`, e.message);
            break;
        }
    }

    // 2. Crawl Latest Updates
    console.log(`\n✨ Phase 2: Crawling Latest Updates (Sub & Dub)`);
    for (let page = 1; page <= maxPages; page++) {
        console.log(`\n📄 Fetching Latest Updates Page ${page}...`);
        try {
            const resultStr = await runner.getLatestUpdates(page);
            const result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
            const animes = result.list || [];
            
            if (animes.length === 0) break;

            for (const anime of animes) {
                const title = anime.name;
                if (!title) continue;

                console.log(`\n=================================================`);
                console.log(`💎 [CRAWLER] Fast Mining Latest: "${title}"`);
                console.log(`=================================================`);
                
                await mineExtensionAllEpisodes('allanime', title, 1, saveToSupabase);
                await mineExtensionAllEpisodes('allanime', `${title} dub`, 1, saveToSupabase);
            }
            
            if (!result.hasNextPage) break;
        } catch (e: any) {
            console.error(`❌ Error crawling latest page ${page}:`, e.message);
            break;
        }
    }
    
import { closeSharedBrowser } from './scrapers/browserManager';

runCrawler()
    .then(async () => {
        await closeSharedBrowser();
        process.exit(0);
    })
    .catch(async (err) => {
        console.error(err);
        await closeSharedBrowser();
        process.exit(1);
    });
