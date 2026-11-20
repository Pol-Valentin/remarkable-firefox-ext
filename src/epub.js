import { createZip } from "./zip.js";

const XML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

export const escapeXml = (s) => String(s).replace(/[&<>"']/g, (c) => XML_ESCAPES[c]);

const STYLE = `body { font-family: serif; line-height: 1.5; margin: 0 4%; }
h1 { font-size: 1.6em; line-height: 1.2; margin-bottom: 0.3em; }
.meta { color: #555; font-size: 0.85em; margin-bottom: 2em; word-break: break-all; }
img { max-width: 100%; height: auto; display: block; margin: 1em auto; }
figure { margin: 1em 0; }
figcaption { font-size: 0.85em; color: #555; text-align: center; }
pre { white-space: pre-wrap; font-size: 0.85em; }
blockquote { margin-left: 1em; padding-left: 1em; border-left: 3px solid #999; }
table { border-collapse: collapse; }
td, th { border: 1px solid #999; padding: 0.2em 0.4em; }
`;

function xhtmlPage({ title, lang, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXml(lang)}" lang="${escapeXml(lang)}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${body}
</body>
</html>
`;
}

export function buildEpub({ id, title, author, lang, source, modified, bodyXhtml, images }) {
  const t = escapeXml(title);
  const stamp = modified.toISOString().replace(/\.\d{3}Z$/, "Z");
  const meta = [author, source].filter(Boolean).map((v) => escapeXml(v)).join("<br/>");

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

  const imageItems = images
    .map((img, i) => `<item id="img${i}" href="${escapeXml(img.href)}" media-type="${img.mediaType}"/>`)
    .join("\n");

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${escapeXml(lang)}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${escapeXml(id)}</dc:identifier>
<dc:title>${t}</dc:title>
<dc:language>${escapeXml(lang)}</dc:language>
${author ? `<dc:creator>${escapeXml(author)}</dc:creator>` : ""}
${source ? `<dc:source>${escapeXml(source)}</dc:source>` : ""}
<meta property="dcterms:modified">${stamp}</meta>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="style" href="style.css" media-type="text/css"/>
<item id="article" href="article.xhtml" media-type="application/xhtml+xml"/>
${imageItems}
</manifest>
<spine toc="ncx">
<itemref idref="article"/>
</spine>
</package>
`;

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${escapeXml(id)}"/></head>
<docTitle><text>${t}</text></docTitle>
<navMap>
<navPoint id="article" playOrder="1"><navLabel><text>${t}</text></navLabel><content src="article.xhtml"/></navPoint>
</navMap>
</ncx>
`;

  const nav = xhtmlPage({
    title,
    lang,
    body: `<nav epub:type="toc"><ol><li><a href="article.xhtml">${t}</a></li></ol></nav>`,
  });

  const article = xhtmlPage({
    title,
    lang,
    body: `<h1>${t}</h1>\n${meta ? `<p class="meta">${meta}</p>\n` : ""}${bodyXhtml}`,
  });

  return createZip([
    { name: "mimetype", data: "application/epub+zip" },
    { name: "META-INF/container.xml", data: container },
    { name: "OEBPS/content.opf", data: opf },
    { name: "OEBPS/toc.ncx", data: ncx },
    { name: "OEBPS/nav.xhtml", data: nav },
    { name: "OEBPS/style.css", data: STYLE },
    { name: "OEBPS/article.xhtml", data: article },
    ...images.map((img) => ({ name: `OEBPS/${img.href}`, data: img.data })),
  ]);
}
