# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Cresmaia Inc. See LICENSES/MIT-cresmaia-glue.txt.
# Takes the text of the Eclipse Public License v1.0 out of the HTML page of the Eclipse Foundation (https://www.eclipse.org/legal/epl-v10.html).
# Standard library only. It reads one file and writes one file; it does not run anything it reads.
#   python3 -I tools/r8-notices/extract_epl10.py <epl-v10.html> <out.txt>
# The HTML page has to have the sha256 below (fetched 2026-11-02T13:25:16Z; records/schematic-sources.tsv). The output is the text of the <body>:
#   every <p> is a paragraph (a blank line between paragraphs; the line breaks inside a paragraph are those of the page), <p class="list"> is indented by 4 spaces,
#   tags are dropped, character references are decoded. Nothing else is changed.
import hashlib, html, re, sys
from html.parser import HTMLParser

EXPECT = 'a40741b59364cc49449255e9b9bfe1fcfe6a2e7ab4d37ca89db3bacbfb14e9d2'

class P(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.in_body = False; self.out = []; self.cur = None; self.cls = None; self.h2 = False
    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == 'body': self.in_body = True
        if not self.in_body: return
        if tag in ('p', 'h2'):
            self.cur = []; self.cls = a.get('class'); self.h2 = (tag == 'h2')
    def handle_endtag(self, tag):
        if tag in ('p', 'h2') and self.cur is not None:
            raw = ''.join(self.cur)
            lines = [re.sub(r'[ \t\r\n]+', ' ', l).strip() for l in raw.split('\n')]
            lines = [l for l in lines if l]
            if self.cls == 'list': lines = ['    ' + l for l in lines]
            self.out.append('\n'.join(lines)); self.cur = None; self.cls = None
    def handle_data(self, d):
        if self.in_body and self.cur is not None: self.cur.append(d)

def main(src, dst):
    b = open(src, 'rb').read()
    if hashlib.sha256(b).hexdigest() != EXPECT: raise SystemExit('STOP: sha256 of %s is not %s' % (src, EXPECT))
    t = b.decode('iso-8859-1')   # the page says charset=ISO-8859-1
    p = P(); p.feed(t)
    text = '\n\n'.join(x for x in p.out if x) + '\n'
    # checks: the four conditions of section 3 and the end of the page are there
    for s in ['3. REQUIREMENTS', 'i) effectively disclaims on behalf of all Contributors', 'ii) effectively excludes on behalf of all Contributors',
              'iii) states that any provisions which differ from this', 'iv) states that source code for the Program is available', '7. GENERAL']:
        if s not in text: raise SystemExit('STOP: the text has no "%s"' % s)
    open(dst, 'w', encoding='utf-8', newline='\n').write(text)
    print('wrote', dst, len(text.encode('utf-8')), 'bytes', hashlib.sha256(text.encode('utf-8')).hexdigest())

if __name__ == '__main__':
    if len(sys.argv) != 3: raise SystemExit('usage: extract_epl10.py <epl-v10.html> <out.txt>')
    main(sys.argv[1], sys.argv[2])
