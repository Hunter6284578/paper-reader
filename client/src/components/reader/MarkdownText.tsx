import { useMemo } from 'react';
import type { ChatReference } from '../../types';
import ReferenceBadge from './ReferenceBadge';

interface Props {
  text: string;
  references?: ChatReference[];
  onCitationClick?: (index: number) => void;
}

type Node =
  | { type: 'p'; children: Inline[] }
  | { type: 'h3'; children: Inline[] }
  | { type: 'h4'; children: Inline[] }
  | { type: 'ul'; items: Inline[][] }
  | { type: 'ol'; items: Inline[][] }
  | { type: 'code'; lang: string; content: string }
  | { type: 'hr' };

type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string }
  | { type: 'cite'; index: number }
  | { type: 'br' };

const INLINE_RE = /(\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[(\d+)(?:,\s*[^\]]*?)?\]|\n)/g;

export default function MarkdownText({ text, references, onCitationClick }: Props) {
  const refMap = useMemo(
    () => new Map((references ?? []).map((r) => [r.index, r])),
    [references],
  );
  const hasCitations = refMap.size > 0;
  const nodes = useMemo(() => parseMarkdown(text, hasCitations ? refMap : undefined), [text, hasCitations, refMap]);
  return <div className="chat-markdown">{nodes.map((n, i) => renderBlock(n, i, refMap, onCitationClick))}</div>;
}

function parseMarkdown(src: string, refMap?: Map<number, ChatReference>): Node[] {
  if (!src) return [];
  const lines = src.split('\n');
  const nodes: Node[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      nodes.push({ type: 'code', lang, content: codeLines.join('\n') });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      nodes.push({ type: 'hr' });
      i++;
      continue;
    }

    // Headings
    if (line.startsWith('### ')) {
      nodes.push({ type: 'h4', children: parseInline(line.slice(4), refMap) });
      i++;
      continue;
    }
    if (line.startsWith('## ')) {
      nodes.push({ type: 'h3', children: parseInline(line.slice(3), refMap) });
      i++;
      continue;
    }

    // Unordered list
    if (/^[\-\*]\s/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^[\-\*]\s/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^[\-\*]\s/, ''), refMap));
        i++;
      }
      nodes.push({ type: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\d+[.)]\s/.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length && /^\d+[.)]\s/.test(lines[i])) {
        items.push(parseInline(lines[i].replace(/^\d+[.)]\s/, ''), refMap));
        i++;
      }
      nodes.push({ type: 'ol', items });
      continue;
    }

    // Empty line
    if (!line.trim()) {
      i++;
      continue;
    }

    // Paragraph — collect consecutive non-empty lines
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('#') && !lines[i].startsWith('```') && !/^[\-\*]\s/.test(lines[i]) && !/^\d+[.)]\s/.test(lines[i]) && !/^---+$/.test(lines[i].trim())) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const combined = paraLines.join('\n');
      nodes.push({ type: 'p', children: parseInline(combined, refMap) });
    }
  }

  return nodes;
}

function parseInline(text: string, refMap?: Map<number, ChatReference>): Inline[] {
  const result: Inline[] = [];
  INLINE_RE.lastIndex = 0;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) {
      result.push({ type: 'text', value: text.slice(last, m.index) });
    }
    if (m[2]) {
      result.push({ type: 'strong', value: m[2] });
    } else if (m[3]) {
      result.push({ type: 'em', value: m[3] });
    } else if (m[4]) {
      result.push({ type: 'code', value: m[4] });
    } else if (m[5]) {
      const idx = parseInt(m[5], 10);
      if (refMap?.has(idx)) {
        result.push({ type: 'cite', index: idx });
      } else {
        result.push({ type: 'text', value: m[0] });
      }
    } else if (m[0] === '\n') {
      result.push({ type: 'br' });
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    result.push({ type: 'text', value: text.slice(last) });
  }
  return result.length > 0 ? result : [{ type: 'text', value: text }];
}

function renderInline(nodes: Inline[], refMap: Map<number, ChatReference>, onCitationClick?: (index: number) => void, key?: number) {
  return (
    <span key={key}>
      {nodes.map((n, i) => {
        if (n.type === 'strong') return <strong key={i}>{n.value}</strong>;
        if (n.type === 'em') return <em key={i}>{n.value}</em>;
        if (n.type === 'code') return <code key={i} className="bg-gray-100 text-gray-800 px-1 py-0.5 rounded text-xs font-mono">{n.value}</code>;
        if (n.type === 'cite') {
          const ref = refMap.get(n.index);
          if (ref) return <ReferenceBadge key={i} reference={ref} onNavigate={() => onCitationClick?.(n.index)} />;
          return <span key={i}>[{n.index}]</span>;
        }
        if (n.type === 'br') return <br key={i} />;
        return <span key={i}>{n.value}</span>;
      })}
    </span>
  );
}

function renderBlock(node: Node, key: number, refMap: Map<number, ChatReference>, onCitationClick?: (index: number) => void): React.ReactNode {
  const ri = (nodes: Inline[]) => renderInline(nodes, refMap, onCitationClick);
  switch (node.type) {
    case 'h3':
      return <h3 key={key} className="font-semibold text-sm mt-3 mb-1">{ri(node.children)}</h3>;
    case 'h4':
      return <h4 key={key} className="font-semibold text-sm mt-2 mb-1">{ri(node.children)}</h4>;
    case 'ul':
      return (
        <ul key={key} className="list-disc pl-5 my-1 space-y-0.5">
          {node.items.map((item, i) => <li key={i}>{ri(item)}</li>)}
        </ul>
      );
    case 'ol':
      return (
        <ol key={key} className="list-decimal pl-5 my-1 space-y-0.5">
          {node.items.map((item, i) => <li key={i}>{ri(item)}</li>)}
        </ol>
      );
    case 'code':
      return (
        <pre key={key} className="bg-gray-900 text-gray-100 text-xs p-3 rounded-lg my-2 overflow-x-auto">
          <code>{node.content}</code>
        </pre>
      );
    case 'hr':
      return <hr key={key} className="border-gray-200 my-3" />;
    case 'p':
      return <p key={key} className="my-1">{ri(node.children)}</p>;
  }
}
