import axios from 'axios';
import { ISource } from '../models';

/**
 * Fallback to Miruro-API to extract streaming URLs.
 * Requires MIRURO_API_URL in .env, defaults to a placeholder.
 */
export const fetchFromMiruro = async (episodeId: string): Promise<ISource> => {
  const baseUrl = process.env.MIRURO_API_URL || 'http://localhost:8000'; // Defaulting to local instance of walterwhite-69/Miruro-API
  
  try {
    // The specific route depends on the Miruro-API implementation you host.
    // Example: /watch?episodeId=...
    const response = await axios.get(`${baseUrl}/watch`, {
      params: { episodeId },
      timeout: 10000, // 10s timeout
    });

    if (response.data && response.data.sources) {
      return {
        headers: response.data.headers || {},
        sources: response.data.sources,
        download: response.data.download || '',
      };
    }
    
    throw new Error('No sources returned from Miruro-API');
  } catch (error) {
    throw new Error(`Miruro-API fetch failed: ${(error as Error).message}`);
  }
};

/**
 * Fallback to Anify API to extract streaming URLs.
 * Requires ANIFY_API_URL in .env, defaults to public API.
 */
export const fetchFromAnify = async (episodeId: string): Promise<ISource> => {
  const baseUrl = process.env.ANIFY_API_URL || 'https://api.anify.tv';
  
  try {
    // Note: Anify typically requires AniList ID or internal ID. 
    // If the episodeId is a raw string from Gogoanime, we may need to use Anify's search or rely on a custom endpoint that maps watchIds.
    // Assuming a hypothetical direct watchId endpoint for Gogoanime mapping:
    const response = await axios.get(`${baseUrl}/sources`, {
      params: { 
        providerId: 'gogoanime', 
        watchId: episodeId 
      },
      timeout: 10000,
    });

    if (response.data && response.data.sources) {
      return {
        headers: response.data.headers || {},
        sources: response.data.sources.map((s: any) => ({
          url: s.url,
          isM3U8: s.url.includes('.m3u8'),
          quality: s.quality || 'auto'
        })),
        download: '',
      };
    }

    throw new Error('No sources returned from Anify API');
  } catch (error) {
    throw new Error(`Anify API fetch failed: ${(error as Error).message}`);
  }
};
