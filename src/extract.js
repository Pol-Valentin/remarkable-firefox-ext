(() => {
  const absolute = (value) => {
    try {
      return new URL(value, document.baseURI).href;
    } catch {
      return null;
    }
  };

  const largestFromSrcset = (srcset) =>
    srcset
      ?.split(",")
      .map((part) => part.trim().split(/\s+/))
      .map(([url, size = "1x"]) => ({ url, weight: parseFloat(size) || 1 }))
      .sort((a, b) => b.weight - a.weight)[0]?.url;

  const clone = document.cloneNode(true);
  const liveImages = document.querySelectorAll("img");
  clone.querySelectorAll("img").forEach((img, i) => {
    const live = liveImages[i];
    const source =
      live?.currentSrc ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-src") ||
      img.getAttribute("data-original") ||
      largestFromSrcset(img.getAttribute("data-srcset") || img.getAttribute("srcset")) ||
      largestFromSrcset(img.closest("picture")?.querySelector("source")?.getAttribute("srcset")) ||
      img.getAttribute("src");
    const url = source && absolute(source);
    img.removeAttribute("srcset");
    img.removeAttribute("loading");
    if (url) img.setAttribute("src", url);
    else img.remove();
  });
  clone.querySelectorAll("a[href]").forEach((a) => {
    const url = absolute(a.getAttribute("href"));
    if (url) a.setAttribute("href", url);
    else a.removeAttribute("href");
  });

  const MIN_ARTICLE_LENGTH = 100;
  const article = new Readability(clone).parse();
  if (!article?.content || article.textContent.trim().length < MIN_ARTICLE_LENGTH) return { error: "Aucun article détecté sur cette page." };

  return {
    title: article.title || document.title || location.hostname,
    byline: article.byline,
    siteName: article.siteName,
    lang: article.lang || document.documentElement.lang || "fr",
    content: article.content,
    url: location.href,
  };
})();
