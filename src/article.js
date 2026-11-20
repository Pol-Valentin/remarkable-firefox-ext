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
const SHOW_COMMENT = 0x80;

function unwrap(el) {
  el.replaceWith(...el.childNodes);
}

function removeComments(root) {
  const walker = root.ownerDocument.createTreeWalker(root, SHOW_COMMENT);
  const comments = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((comment) => comment.remove());
}

function sanitize(root) {
  removeComments(root);
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
  const urls = [...new Set([...root.querySelectorAll("img")].map((img) => img.getAttribute("src")))].slice(0, MAX_IMAGES);
  const fetched = await Promise.all(urls.map((url) => fetchImage(url).catch(() => null)));
  const images = [];
  const hrefByUrl = new Map();
  urls.forEach((url, i) => {
    const image = fetched[i];
    if (!image) return;
    const href = `images/img-${images.length}.${image.mediaType === "image/png" ? "png" : "jpg"}`;
    images.push({ href, ...image });
    hrefByUrl.set(url, href);
  });
  for (const img of root.querySelectorAll("img")) {
    const href = hrefByUrl.get(img.getAttribute("src"));
    if (href) img.setAttribute("src", href);
    else img.remove();
  }
  return images;
}

export async function toXhtml(html, fetchImage) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  sanitize(doc.body);
  const images = await embedImages(doc.body, fetchImage);
  const serializer = new XMLSerializer();
  const bodyXhtml = [...doc.body.childNodes].map((node) => serializer.serializeToString(node)).join("");
  return { bodyXhtml, images };
}
