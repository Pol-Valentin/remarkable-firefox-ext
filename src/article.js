const ALLOWED_TAGS = new Set(
  `p br hr h1 h2 h3 h4 h5 h6 a em strong b i u s sub sup small mark code pre kbd samp var
  blockquote q cite abbr ul ol li dl dt dd figure figcaption img table thead tbody tfoot tr td th
  caption span div section article header footer aside main time del ins`.split(/\s+/),
);
const DROPPED_TAGS = "script, style, noscript, iframe, object, embed, form, input, button, select, textarea, svg, math, video, audio, canvas, source, link, meta, template";
const ALLOWED_ATTRIBUTES = {
  a: ["href"],
  img: ["src", "alt"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  ol: ["start"],
};
const MAX_IMAGES = 60;
const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;

function unwrap(el) {
  el.replaceWith(...el.childNodes);
}

function sanitize(root) {
  root.querySelectorAll(DROPPED_TAGS).forEach((el) => el.remove());
  for (const el of [...root.querySelectorAll("*")].reverse()) {
    const tag = el.localName;
    if (!ALLOWED_TAGS.has(tag)) {
      unwrap(el);
      continue;
    }
    const keep = ALLOWED_ATTRIBUTES[tag] ?? [];
    for (const { name } of [...el.attributes]) if (!keep.includes(name)) el.removeAttribute(name);
    if (tag === "a" && !/^(https?:|mailto:)/i.test(el.getAttribute("href") ?? "")) el.removeAttribute("href");
    if (tag === "img" && !el.hasAttribute("alt")) el.setAttribute("alt", "");
  }
}

async function embedImages(root, fetchImage) {
  const images = [];
  const byUrl = new Map();
  for (const img of root.querySelectorAll("img")) {
    const url = img.getAttribute("src");
    if (!byUrl.has(url)) {
      const image = images.length < MAX_IMAGES ? await fetchImage(url).catch(() => null) : null;
      if (image) {
        const href = `images/img-${images.length}.${image.mediaType === "image/png" ? "png" : "jpg"}`;
        images.push({ href, ...image });
        byUrl.set(url, href);
      } else {
        byUrl.set(url, null);
      }
    }
    const href = byUrl.get(url);
    if (href) img.setAttribute("src", href);
    else img.remove();
  }
  return images;
}

export async function toXhtml(html, fetchImage) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitize(doc.body);
  const images = await embedImages(doc.body, fetchImage);
  const serialized = new XMLSerializer().serializeToString(doc.body);
  const bodyXhtml = serialized
    .replace(/^<body[^>]*>/, "")
    .replace(/<\/body>$/, "")
    .replace(INVALID_XML_CHARS, "");
  return { bodyXhtml, images };
}
