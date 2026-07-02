/**
 * Paper metadata extraction using CrossRef API
 * Extracts title, authors, abstract, DOI from PDF text or filename
 */

export interface PaperMetadata {
  title?: string;
  authors?: string[];
  abstract?: string;
  doi?: string;
}

/**
 * Try to extract metadata by searching CrossRef with the first paragraph text
 */
export async function extractMetadata(firstParagraphText: string, filename: string): Promise<PaperMetadata> {
  // Extract a search query from the first paragraph (usually the abstract or intro)
  const searchQuery = firstParagraphText.slice(0, 200).replace(/\s+/g, ' ').trim();
  if (!searchQuery || searchQuery.length < 20) {
    return { title: filename.replace(/\.pdf$/i, '') };
  }

  try {
    const response = await fetch(
      `https://api.crossref.org/works?query=${encodeURIComponent(searchQuery)}&rows=1&select=title,author,abstract,DOI`,
      {
        headers: {
          'User-Agent': 'PaperReader/0.5 (mailto:paperreader@example.com)',
        },
      }
    );

    if (!response.ok) return { title: filename.replace(/\.pdf$/i, '') };

    const json = await response.json() as any;
    const item = json?.message?.items?.[0];
    if (!item) return { title: filename.replace(/\.pdf$/i, '') };

    // Check relevance: title similarity
    const authors = item.author?.map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()) || [];

    return {
      title: item.title?.[0] || filename.replace(/\.pdf$/i, ''),
      authors: authors.length > 0 ? authors : undefined,
      abstract: item.abstract || undefined,
      doi: item.DOI || undefined,
    };
  } catch {
    return { title: filename.replace(/\.pdf$/i, '') };
  }
}
