import axios from 'axios';
import { IVideo } from '../models';

export class KwikExtractor {
    private client = axios.create({
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Referer': 'https://animepahe.ru/'
        }
    });

    async extract(kwikUrl: string): Promise<IVideo[]> {
        const sources: IVideo[] = [];
        try {
            const response = await this.client.get(kwikUrl);
            const html = response.data as string;

            // Extract the packed JS script
            const match = html.match(/eval\(function\(p,a,c,k,e,d\).*\)/);
            if (match) {
                const script = match[0];
                // Unpack / find the stream URL
                const srcMatch = script.match(/source=\\?'(https?:\/\/[^'"]+)\\?'/i) ||
                                 html.match(/source\s*=\s*['"](https?:\/\/[^'"]+)['"]/i) ||
                                 html.match(/src\s*=\s*['"](https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/i);

                if (srcMatch) {
                    sources.push({
                        url: srcMatch[1],
                        isM3U8: srcMatch[1].includes('.m3u8'),
                        quality: 'default'
                    });
                }
            }

            // Direct fallback
            if (sources.length === 0) {
                sources.push({
                    url: kwikUrl,
                    isM3U8: kwikUrl.includes('.m3u8'),
                    quality: 'embed'
                });
            }
        } catch (e: any) {
            console.error('❌ KwikExtractor error:', e.message);
        }
        return sources;
    }
}

export default KwikExtractor;
