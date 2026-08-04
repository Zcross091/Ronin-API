export declare function search(params: { query: string }): Promise<string>;
export declare function details(params: { url: string }): Promise<string>;
export declare function extractVideo(params: { url: string; title?: string; episode?: number }): Promise<string>;
export declare function scrapeAnimepahe(query: string, epNum?: number, domains?: string[]): Promise<string | null>;
export declare const ANIMEPAHE_DOMAINS: string[];
