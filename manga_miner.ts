import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import MangaRead from './providers/mangaread'; // Correct relative path from root

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || '', process.env.SUPABASE_KEY || '');
const mangaread = new MangaRead();
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function mineTop300Manga() {
    console.log('🚀 Starting Top 300 Manga Miner for MangaRead...');
    
    let totalMined = 0;
    const targetAmount = 300;
    let page = 1;

    try {
        while (totalMined < targetAmount) {
            console.log(`\n📄 Fetching trending page ${page}...`);
            const mangaList = await mangaread.fetchTopManga(page);
            
            if (mangaList.length === 0) break; 

            for (const manga of mangaList) {
                if (totalMined >= targetAmount) break;

                console.log(`⏳ [${totalMined + 1}/300] Deep diving into: ${manga.title}`);
                try {
                    // Fetch full info to get the chapter array
                    const fullInfo = await mangaread.fetchMangaInfo(manga.id);
                    
                    // Upsert into Supabase
                    const { error } = await supabase.from('manga_links').upsert({ 
                        title: manga.title.toLowerCase().trim(), 
                        manga_id: manga.id, 
                        provider: mangaread.name,
                        chapters_data: fullInfo.chapters,
                        updated_at: new Date()
                    }, { onConflict: 'title, provider' });

                    if (error) throw error;
                    console.log(`   📖 Saved ${fullInfo.chapters?.length || 0} chapters successfully.`);

                } catch (err: any) {
                    console.error(`   ❌ Failed to fetch info for ${manga.title}: ${err.message}`);
                }
                
                totalMined++;
                await delay(1500); // 1.5s delay to prevent IP bans
            }
            page++;
        }
        console.log('\n🎉 Top 300 Daily Manga Miner completed successfully!');
    } catch (err: any) {
        console.error(`❌ Miner failed: ${err.message}`);
    }
}

mineTop300Manga();
