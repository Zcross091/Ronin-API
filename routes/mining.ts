import { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ExtensionRunner } from '../engine/sandbox';
import path from 'path';
import fs from 'fs/promises';

export default async function miningRoutes(fastify: FastifyInstance, options: FastifyPluginOptions) {

    // Helper to find extension file in the various language folders
    async function findExtensionPath(extensionName: string): Promise<string | null> {
        const baseDirs = [
            path.join(__dirname, '..', 'extensions', 'm2k3a-extensions', 'javascript', 'anime', 'src'),
            path.join(__dirname, '..', 'extensions', 'swak-extensions', 'javascript', 'anime', 'src')
        ];
        for (const baseDir of baseDirs) {
            try {
                const langs = await fs.readdir(baseDir);
                for (const lang of langs) {
                    const langDir = path.join(baseDir, lang);
                    const stat = await fs.stat(langDir);
                    if (stat.isDirectory()) {
                        const files = await fs.readdir(langDir);
                        if (files.includes(`${extensionName}.js`)) {
                            return path.join(langDir, `${extensionName}.js`);
                        }
                    }
                }
            } catch (e) {
                // Ignore
            }
        }
        return null;
    }

    fastify.get('/api/mine/:extension/search', async (request, reply) => {
        const { extension } = request.params as { extension: string };
        const { q, page } = request.query as { q: string, page?: string };

        if (!q) return reply.status(400).send({ error: 'Missing query parameter q' });

        const scriptPath = await findExtensionPath(extension);
        if (!scriptPath) return reply.status(404).send({ error: `Extension ${extension} not found` });

        try {
            const runner = new ExtensionRunner(scriptPath);
            await runner.load();
            const results = await runner.search(q, page ? parseInt(page) : 1);
            return reply.send({ success: true, data: results });
        } catch (e: any) {
            fastify.log.error(e);
            return reply.status(500).send({ success: false, error: e.message });
        }
    });

    fastify.get('/api/mine/:extension/detail', async (request, reply) => {
        const { extension } = request.params as { extension: string };
        const { url } = request.query as { url: string };

        if (!url) return reply.status(400).send({ error: 'Missing url parameter' });

        const scriptPath = await findExtensionPath(extension);
        if (!scriptPath) return reply.status(404).send({ error: `Extension ${extension} not found` });

        try {
            const runner = new ExtensionRunner(scriptPath);
            await runner.load();
            const details = await runner.getDetail(url);
            return reply.send({ success: true, data: details });
        } catch (e: any) {
            fastify.log.error(e);
            return reply.status(500).send({ success: false, error: e.message });
        }
    });

    fastify.get('/api/mine/:extension/watch', async (request, reply) => {
        const { extension } = request.params as { extension: string };
        const { url } = request.query as { url: string };

        if (!url) return reply.status(400).send({ error: 'Missing url parameter' });

        const scriptPath = await findExtensionPath(extension);
        if (!scriptPath) return reply.status(404).send({ error: `Extension ${extension} not found` });

        try {
            const runner = new ExtensionRunner(scriptPath);
            await runner.load();
            const videos = await runner.getVideoList(url);
            return reply.send({ success: true, data: videos });
        } catch (e: any) {
            fastify.log.error(e);
            return reply.status(500).send({ success: false, error: e.message });
        }
    });
}
