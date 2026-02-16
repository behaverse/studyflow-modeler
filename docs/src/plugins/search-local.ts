import fs from 'fs';
import path from 'path';
import type {LoadContext, Plugin} from '@docusaurus/types';

export interface SearchDoc {
  title: string;
  url: string;
  description: string;
  content: string;
  headings: string[];
}

function stripMarkdown(content: string): string {
  return content
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+.*$/gm, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/#{1,6}\s+/g, '')
    .replace(/(\*\*|__)(.*?)\1/g, '$2')
    .replace(/(\*|_)(.*?)\1/g, '$2')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>/gm, '')
    .replace(/^[-*_]{3,}$/gm, '')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHeadings(content: string): string[] {
  const headingRegex = /^#{1,6}\s+(.+)$/gm;
  const headings: string[] = [];
  let match;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push(match[1].replace(/[*_`]/g, '').trim());
  }
  return headings;
}

export default function pluginSearchLocal(context: LoadContext): Plugin {
  return {
    name: 'docusaurus-plugin-search-local',

    async allContentLoaded({allContent, actions}) {
      const {setGlobalData} = actions;
      const docsPluginContent = allContent['docusaurus-plugin-content-docs'];

      if (!docsPluginContent) {
        setGlobalData({searchDocs: []});
        return;
      }

      const searchDocs: SearchDoc[] = [];

      for (const pluginData of Object.values(docsPluginContent)) {
        const versions = (pluginData as any).loadedVersions || [];
        for (const version of versions) {
          for (const doc of version.docs || []) {
            let content = '';
            let headings: string[] = [];

            try {
              const sourcePath = (doc.source as string).replace(
                /^@site\//,
                '',
              );
              const fullPath = path.join(context.siteDir, sourcePath);
              const raw = fs.readFileSync(fullPath, 'utf-8');
              headings = extractHeadings(raw);
              content = stripMarkdown(raw);
            } catch {
              content = doc.description || '';
            }

            searchDocs.push({
              title: doc.title,
              url: doc.permalink,
              description: doc.description || '',
              content: content.slice(0, 5000),
              headings,
            });
          }
        }
      }

      setGlobalData({searchDocs});
    },
  };
}
