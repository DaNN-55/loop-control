import type { ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export function MarkdownPreview({ content }: { content: string }) {
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];

  function flushList() {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {listItems.map((item, index) => <li key={`${item}-${index}`}>{renderInline(item)}</li>)}
      </ul>,
    );
    listItems = [];
  }

  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushList();
      return;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushList();
      const level = heading[1].length;
      const Heading = `h${level}` as "h1" | "h2" | "h3";
      blocks.push(<Heading key={`heading-${blocks.length}`}>{renderInline(heading[2])}</Heading>);
      return;
    }

    if (trimmed.startsWith(">")) {
      flushList();
      blocks.push(<blockquote key={`quote-${blocks.length}`}>{renderInline(trimmed.replace(/^>\s?/, ""))}</blockquote>);
      return;
    }

    const listItem = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listItem) {
      listItems.push(listItem[1]);
      return;
    }

    flushList();
    blocks.push(<p key={`paragraph-${blocks.length}`}>{renderInline(trimmed)}</p>);
  });
  flushList();

  return <article className="markdown-preview">{blocks}</article>;
}
