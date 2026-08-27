import GogoCDN from './gogocdn';
import StreamSB from './streamsb';
import KwikExtractor from './kwik';
import { IVideo } from '../models';

export {
  GogoCDN,
  StreamSB,
  KwikExtractor,
};

export async function resolveEmbedUrl(embedUrl: string): Promise<{ success: boolean; sources: IVideo[]; provider: string }> {
  try {
    const urlObj = new URL(embedUrl);
    const host = urlObj.hostname.toLowerCase();

    // 1. GogoCDN / Goload / Embtaku / Anihdplay
    if (host.includes('gogo') || host.includes('goload') || host.includes('embed') || host.includes('anihdplay') || host.includes('playgo') || host.includes('streamwish')) {
      const gogo = new GogoCDN();
      const sources = await gogo.extract(urlObj);
      return { success: sources.length > 0, sources, provider: 'GogoCDN' };
    }

    // 2. Kwik (Animepahe)
    if (host.includes('kwik') || host.includes('animepahe')) {
      const kwik = new KwikExtractor();
      const sources = await kwik.extract(embedUrl);
      return { success: sources.length > 0, sources, provider: 'Kwik' };
    }

    // 3. StreamSB / Vidplay
    if (host.includes('sb') || host.includes('streamsb') || host.includes('streamtape')) {
      const sb = new StreamSB();
      const sources = await sb.extract(urlObj);
      return { success: sources.length > 0, sources, provider: 'StreamSB' };
    }

    // Direct m3u8 or mp4 pass-through
    if (embedUrl.includes('.m3u8') || embedUrl.includes('.mp4')) {
      return {
        success: true,
        sources: [{ url: embedUrl, isM3U8: embedUrl.includes('.m3u8'), quality: 'direct' }],
        provider: 'DirectVideo'
      };
    }

    // Generic embed pass-through
    return {
      success: true,
      sources: [{ url: embedUrl, isM3U8: false, quality: 'embed' }],
      provider: 'GenericEmbed'
    };
  } catch (e: any) {
    console.error('❌ resolveEmbedUrl error:', e.message);
    return { success: false, sources: [], provider: 'none' };
  }
}
