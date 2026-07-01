import { useMemo } from 'react';
import type { ChatReference } from '../../types';
import ReferenceBadge from './ReferenceBadge';

interface Props {
  content: string;
  references: ChatReference[];
  onNavigate?: () => void;
}

type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'cite'; index: number }
  | { type: 'br' };

type Block =
  | { type: 'p'; children: Inline[] }
  | { type: 'h3'; children: Inline[] }
  | { type: 'h4'; children: Inline[] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; items: Inline[][] }
  | { type: 'pre'; content: string }
  | { type: 'hr' };

const INLINE_RE = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[(\d+)(?:,\s*[^\]]*?)?\]|\n)/g;

export default function ChatMessageContent({ content, references, onNavigate }: Props) {
  const refMap = useMemo(() => new Map(references.map((r) => [r.index, r])), [references]);
  const blocks = useMemo(() => parse(content, refMap), [content, refMap]);
  return <div className="chat-markdown">{blocks.map((b, i) => renderBlock(b, i, refMap, onNavigate))}</div>;
}

function parseInline(src: string, refMap: Map<number, ChatReference>): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  INLINE_RE.lastIndex = 0;

  while ((m = INLINE_RE.exec(src)) !== null) {
    if (m.index > last) result.push({ type: 'text', value: src.slice(last, m.index) });
    if (m[2]) {
      result.push({ type: 'strong', children: [{ type: 'text', value: m[2] }] });
    } else if (m[3]) {
      result.push({ type: 'em', children: [{ type: 'text', value: m[3] }] });
    } else if (m[4]) {
      result.push({ type: 'code', value: m[4] });
    } else if (m[5]) {
      const idx = parseInt(m[5], 10);
      if (refMap.has(idx)) {
        result.push({ type: 'cite', index: idx });
      } else {
        result.push({ type: 'text', value: m[0] });
      }
    } else if (m[0] === '\n') {
      result.push({ type: 'br' });
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) result.push({ type: 'text', value: src.slice(last) });
  return result.length > 0 ? result : [{ type: 'text', value: src }];
}

function parse(src: string, refMap: Map<number, ChatReference>): Block[] {
  if (!src) return [];
  const lines = src.split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      blocks.push({ type: 'pre', content: codeLines.join('\n') });
      i++; continue;
    }
    if (/^---+$/.test(line.trim())) { blocks.push({ type: 'hr' }); i++; continue; }
    if (line.startsWith('### ')) { blocks.push({ type: 'h4', children: parseInline(line.slice(4), refMap) }); i++; continue; }
    if (line.startsWith('## ')) { blocks.push({ type: 'h3', children: parseInline(line.slice(3), refMap) }); i++; continue; }

    if (/^[\-\*]\s/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^[\-\*]\s/, ''), refMap)); i++; }
      blocks.push({ type: 'ul', items }); continue;
    }
    if (/^\d+[.)]\s/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) { items.push(parseInline(lines[i].replace(/^\d+[.)]\s/, ''), refMap)); i++; }
      blocks.push({ type: 'ol', items }); continue;
    }
    if (!line.trim()) { i++; continue; }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !/^[\-\*]\s/.test(lines[i]) && !/^\d+[.)]\s/.test(lines[i]) && !/^---+$/.test(lines[i].trim())) {
      para.push(lines[i]); i++;
    }
    if (para.length) blocks.push({ type: 'p', children: parseInline(para.join('\n'), refMap) });
  }
  return blocks;
}

function renderInlineNode(node: Inline, key: number, refMap: Map<number, ChatReference>, onNavigate?: () => void): React.ReactNode {
  switch (node.type) {
    case 'strong': return <strong key={key}>{node.children.map((c, j) => renderInlineNode(c, j, refMap, onNavigate))}</strong>;
    case 'em': return <em key={key}>{node.children.map((c, j) => renderInlineNode(c, j, refMap, onNavigate))}</em>;
    case 'code': return <code key={key} className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">{node.value}</code>;
    case 'cite': return <ReferenceBadge key={key} reference={refMap.get(node.index)!} onNavigate={onNavigate} />;
    case 'br': return <br key={key} />;
    default: return <span key={key}>{node.value}</span>;
  }
}

function renderBlock(node: Block, key: number, refMap: Map<number, ChatReference>, onNavigate?: () => void): React.ReactNode {
  const ri = (nodes: Inline[]) => nodes.map((n, i) => renderInlineNode(n, i, refMap, onNavigate));
  switch (node.type) {
    case 'h3': return <h3 key={key} className="font-semibold text-sm mt-3 mb-1">{ri(node.children)}</h3>;
    case 'h4': return <h4 key={key} className="font-semibold text-sm mt-2 mb-1">{ri(node.children)}</h4>;
    case 'ul': return <ul key={key} className="list-disc pl-5 my-1 space-y-0.5">{node.items.map((it, i) => <li key={i}>{ri(it)}</li>)}</ul>;
    case 'ol': return <ol key={key} className="list-decimal pl-5 my-1 space-y-0.5">{node.items.map((it, i) => <li key={i}>{ri(it)}</li>)}</ol>;
    case 'pre': return <pre key={key} className="bg-gray-900 text-gray-100 text-xs p-3 rounded-lg my-2 overflow-x-auto"><code>{node.content}</code></pre>;
    case 'hr': return <hr key={key} className="border-gray-200 my-3" />;
    case 'p': return <p key={key} className="my-1">{ri(node.children)}</p>;
  }
}
