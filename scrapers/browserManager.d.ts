export function getSharedBrowser(): Promise<any>;
export function closeSharedBrowser(): Promise<void>;
export function fetchWithStealthBrowser(url: string, waitSelector?: string, timeoutMs?: number): Promise<{ html: string; iframeSrc?: string }>;
