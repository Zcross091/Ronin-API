import { ExtensionRunner } from './engine/sandbox';
import { spawnSync } from 'child_process';
import path from 'path';

const EXTENSION_PATH = path.join(__dirname, 'extensions/m2k3a-extensions/javascript/anime/src/en/allanime.js');

async function runCrawler() {
    console.log(`\n🕸️ Starting Ronin Auto-Crawler 🕸️`);
    console.log(`Using extension: ${EXTENSION_PATH}`);
    
    let runner: ExtensionRunner;
    try {
        runner = new ExtensionRunner(EXTENSION_PATH);
        await runner.load();
    } catch (e: any) {
        console.error(`❌ Failed to load extension for crawling: ${e.message}`);
        process.exit(1);
    }

    const maxPages = 10;
    
    // 1. Crawl Popular
    console.log(`\n🔥 Phase 1: Crawling Popular Anime`);
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
                console.log(`\n=================================================`);
                console.log(`💎 [CRAWLER] Mined Target: ${title}`);
                console.log(`=================================================`);
                
                // Spawn runQuery.ts to mine all episodes for this title
                const res = spawnSync('npx', ['ts-node', 'runQuery.ts', title, '1', ''], {
                    stdio: 'inherit',
                    cwd: __dirname
                });
                
                if (res.status !== 0) {
                    console.log(`⚠️ Miner exited with error code for "${title}". Continuing...`);
                }
            }
            
            if (!result.hasNextPage) {
                console.log(`No more popular pages.`);
                break;
            }
        } catch (e: any) {
            console.error(`❌ Error crawling popular page ${page}:`, e.message);
            break;
        }
    }

    // 2. Crawl Latest Updates
    console.log(`\n✨ Phase 2: Crawling Latest Updates`);
    for (let page = 1; page <= maxPages; page++) {
        console.log(`\n📄 Fetching Latest Updates Page ${page}...`);
        try {
            const resultStr = await runner.getLatestUpdates(page);
            const result = typeof resultStr === 'string' ? JSON.parse(resultStr) : resultStr;
            const animes = result.list || [];
            
            if (animes.length === 0) {
                console.log(`No more latest anime found.`);
                break;
            }

            for (const anime of animes) {
                const title = anime.name;
                console.log(`\n=================================================`);
                console.log(`💎 [CRAWLER] Mined Target: ${title}`);
                console.log(`=================================================`);
                
                const res = spawnSync('npx', ['ts-node', 'runQuery.ts', title, '1', ''], {
                    stdio: 'inherit',
                    cwd: __dirname
                });
                
                if (res.status !== 0) {
                    console.log(`⚠️ Miner exited with error code for "${title}". Continuing...`);
                }
            }
            
            if (!result.hasNextPage) {
                console.log(`No more latest pages.`);
                break;
            }
        } catch (e: any) {
            console.error(`❌ Error crawling latest page ${page}:`, e.message);
            break;
        }
    }
    
    console.log(`\n🎉 Crawl finished successfully!`);
}

runCrawler().catch(console.error);
