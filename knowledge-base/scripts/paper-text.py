"""Bounded, non-executing HTML/PDF extraction. Input file is a private temp file."""
import json
import subprocess
import sys
from html.parser import HTMLParser
from pathlib import Path


class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.links, self.meta, self.hidden = [], [], {}, 0

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag in ('script', 'style', 'noscript'):
            self.hidden += 1
        if tag in ('p', 'div', 'section', 'article', 'br', 'tr', 'li', 'h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n')
        if tag in ('td', 'th'):
            self.parts.append('\t')
        if tag in ('a', 'link') and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag == 'meta':
            key = attrs.get('name', attrs.get('property', '')).lower()
            if key.startswith(('citation_', 'dc.', 'prism.')) and attrs.get('content'):
                self.meta.setdefault(key, []).append(attrs['content'])
            if key == 'citation_pdf_url' and attrs.get('content'):
                self.links.append(attrs['content'])

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            self.hidden = max(0, self.hidden - 1)
        if tag in ('p', 'div', 'section', 'article', 'tr', 'li', 'h1', 'h2', 'h3', 'h4'):
            self.parts.append('\n')

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def extract(kind, filename):
    if kind == 'pdf':
        result = subprocess.run(['pdftotext', '-layout', '-enc', 'UTF-8', filename, '-'],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
        text = result.stdout.decode('utf-8')
        pages = text.split('\f')
        return {'text': '\n'.join(f'[PDF page {i+1}]\n{p}' for i, p in enumerate(pages) if p.strip()), 'links': [], 'metadata': {}}
    parser = Text()
    parser.feed(Path(filename).read_text(encoding='utf-8', errors='replace'))
    return {'text': '\n'.join(' '.join(line.split()) for line in ''.join(parser.parts).splitlines() if line.strip()),
            'links': list(dict.fromkeys(parser.links)), 'metadata': parser.meta}


if __name__ == '__main__':
    try:
        value = extract(sys.argv[1], sys.argv[2])
        if len(value['text']) > 1000000:
            raise ValueError('extracted text too large')
        print(json.dumps(value, ensure_ascii=False))
    except Exception:
        sys.exit('paper extraction failed; document may be scanned, unsupported or too large')
