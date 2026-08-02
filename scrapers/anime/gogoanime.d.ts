export declare function search(params: { query: string }): Promise<string>;
export declare function details(params: { url: string }): Promise<string>;
export declare function extractVideo(params: { url: string }): Promise<string>;
export declare function scrapeGogoanime(query: string, epNum: number, domains?: string[]): Promise<string | null>;
export declare function scrapeGogoanimeLight(query: string, epNum: number, domains?: string[]): Promise<string | null>;
