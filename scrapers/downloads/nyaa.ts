import axios from 'axios';
import * as cheerio from 'cheerio';

export interface TorrentItem {
    title: string;
    magnet: string;
    torrentFile?: string;
    size: string;
    seeders: number;
    leechers: number;
    downloads: number;
    date: string;
    quality: string;
}

export async function searchNyaaTorrents(title: string, episode?: number): Promise<TorrentItem[]> {
    const epPad = (episode && episode > 0) ? (episode < 10 ? `0${episode}` : `${episode}`) : '';
    const searchQuery = `${title} ${epPad}`.trim();
    const url = `https://nyaa.si/?f=0&c=1_2&q=${encodeURIComponent(searchQuery)}&s=seeders&o=desc`;

    try {
        const response = await axios.get(url, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            }
        });

        const $ = cheerio.load(response.data);
        const results: TorrentItem[] = [];

        $('tr.default, tr.success').each((_, el) => {
            const row = $(el);
            const titleCol = row.find('td:nth-child(2) a:not(.comments)');
            const itemTitle = titleCol.text().trim() || titleCol.attr('title') || '';
            const linksCol = row.find('td:nth-child(3)');
            const magnetLink = linksCol.find('a[href^="magnet:"]').attr('href') || '';
            const torrentHref = linksCol.find('a[href$=".torrent"]').attr('href');
            const torrentFile = torrentHref ? `https://nyaa.si${torrentHref}` : undefined;

            const size = row.find('td:nth-child(4)').text().trim();
            const date = row.find('td:nth-child(5)').text().trim();
            const seeders = parseInt(row.find('td:nth-child(6)').text().trim()) || 0;
            const leechers = parseInt(row.find('td:nth-child(7)').text().trim()) || 0;
            const downloads = parseInt(row.find('td:nth-child(8)').text().trim()) || 0;

            let quality = '720p';
            if (itemTitle.includes('1080p') || itemTitle.includes('1080')) quality = '1080p';
            else if (itemTitle.includes('2160p') || itemTitle.includes('4k')) quality = '4K';
            else if (itemTitle.includes('480p') || itemTitle.includes('480')) quality = '480p';

            if (itemTitle && magnetLink) {
                results.push({
                    title: itemTitle,
                    magnet: magnetLink,
                    torrentFile,
                    size,
                    seeders,
                    leechers,
                    downloads,
                    date,
                    quality
                });
            }
        });

        return results;
    } catch (e: any) {
        console.error('❌ Nyaa scraper error:', e.message);
        return [];
    }
}
