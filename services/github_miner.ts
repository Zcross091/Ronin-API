import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.GH_PAT || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'Zcross091/Ronin-API';

export async function triggerGitHubMiner(title: string, episode: number, source?: string): Promise<{ success: boolean; message: string }> {
    if (!GITHUB_TOKEN) {
        console.warn('⚠️ GITHUB_TOKEN is not configured in .env. Background runner trigger skipped.');
        return {
            success: false,
            message: 'GITHUB_TOKEN is not configured on this server. Running in local-only mode.'
        };
    }

    try {
        const dispatchUrl = `https://api.github.com/repos/${GITHUB_REPO}/dispatches`;

        const response = await axios.post(
            dispatchUrl,
            {
                event_type: 'search-or-mine',
                client_payload: {
                    query: title,
                    episode: episode.toString(),
                    source: source || 'Ronin API'
                }
            },
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'User-Agent': 'Ronin-API-Miner-Dispatcher'
                }
            }
        );

        if (response.status === 204 || response.status === 200) {
            console.log(`🚀 Successfully triggered GitHub Actions Anime Miner for "${title}" Ep ${episode} on ${GITHUB_REPO}`);
            return {
                success: true,
                message: `Dispatched background miner for "${title}" Ep ${episode} on GitHub Actions runner.`
            };
        } else {
            return {
                success: false,
                message: `GitHub returned status ${response.status}`
            };
        }
    } catch (e: any) {
        console.error('❌ Failed to dispatch GitHub Actions Anime Miner:', e.response?.data || e.message);
        return {
            success: false,
            message: `Failed to trigger GitHub Actions: ${e.response?.data?.message || e.message}`
        };
    }
}

export async function triggerMangaMiner(title: string, chapter: string = '1'): Promise<{ success: boolean; message: string }> {
    if (!GITHUB_TOKEN) {
        console.warn('⚠️ GITHUB_TOKEN is not configured in .env. Background runner trigger skipped.');
        return {
            success: false,
            message: 'GITHUB_TOKEN is not configured on this server. Running in local-only mode.'
        };
    }

    try {
        const dispatchUrl = `https://api.github.com/repos/${GITHUB_REPO}/dispatches`;

        const response = await axios.post(
            dispatchUrl,
            {
                event_type: 'search-or-mine-manga',
                client_payload: {
                    query: title,
                    chapter: chapter
                }
            },
            {
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'Authorization': `Bearer ${GITHUB_TOKEN}`,
                    'User-Agent': 'Ronin-API-Manga-Miner-Dispatcher'
                }
            }
        );

        if (response.status === 204 || response.status === 200) {
            console.log(`🚀 Successfully triggered GitHub Actions Manga Miner for "${title}" Ch ${chapter} on ${GITHUB_REPO}`);
            return {
                success: true,
                message: `Dispatched background manga miner for "${title}" Ch ${chapter} on GitHub Actions runner.`
            };
        } else {
            return {
                success: false,
                message: `GitHub returned status ${response.status}`
            };
        }
    } catch (e: any) {
        console.error('❌ Failed to dispatch GitHub Actions Manga Miner:', e.response?.data || e.message);
        return {
            success: false,
            message: `Failed to trigger GitHub Actions: ${e.response?.data?.message || e.message}`
        };
    }
}
