import { toXhtml } from "./article.js";
import { buildEpub } from "./epub.js";
import { fetchImage } from "./images.js";
import { uploadEpub, userToken } from "./remarkable.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const PAIRING_EXPIRED = "L'appairage a expiré : saisis un nouveau code dans les options.";

browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "send-to-remarkable",
    title: "Envoyer la page sur reMarkable",
    contexts: ["page", "selection"],
  });
});

browser.action.onClicked.addListener((tab) => send(tab));
browser.contextMenus.onClicked.addListener((_, tab) => send(tab));

async function badge(tabId, text, color) {
  await browser.action.setBadgeBackgroundColor({ tabId, color });
  await browser.action.setBadgeText({ tabId, text });
}

async function extract(tabId) {
  const results = await browser.scripting.executeScript({
    target: { tabId },
    files: ["vendor/Readability.js", "src/extract.js"],
  });
  const article = results.at(-1)?.result;
  if (!article) throw new Error("Impossible de lire cette page.");
  if (article.error) throw new Error(article.error);
  return article;
}

async function fetchFromPage(tabId, url) {
  const [{ result }] = await browser.scripting.executeScript({
    target: { tabId },
    func: async (src) => {
      const response = await content.fetch(src);
      if (!response.ok) return null;
      return { type: response.headers.get("Content-Type") ?? "", bytes: await response.arrayBuffer() };
    },
    args: [url],
  });
  return result;
}

export async function send(tab) {
  const { deviceToken } = await browser.storage.local.get("deviceToken");
  if (!deviceToken || !(await browser.permissions.contains(ALL_SITES))) {
    await browser.runtime.openOptionsPage();
    return;
  }

  await badge(tab.id, "…", "#666");
  const token = userToken(deviceToken);
  token.catch(() => {});
  try {
    const article = await extract(tab.id);
    const { bodyXhtml, images } = await toXhtml(article.content, (url) => fetchImage(url, (src) => fetchFromPage(tab.id, src)));
    const epub = buildEpub({
      id: `urn:uuid:${crypto.randomUUID()}`,
      title: article.title,
      author: article.byline || article.siteName,
      lang: article.lang,
      source: article.url,
      modified: new Date(),
      bodyXhtml,
      images,
    });
    await uploadEpub(await token, article.title, epub);
    await badge(tab.id, "✓", "#2e7d32");
    setTimeout(() => browser.action.setBadgeText({ tabId: tab.id, text: "" }), 4000);
  } catch (error) {
    const expired = error.status === 401;
    if (expired) {
      await browser.storage.local.remove("deviceToken");
      await browser.runtime.openOptionsPage();
    }
    await badge(tab.id, "!", "#c62828");
    await browser.notifications.create({
      type: "basic",
      iconUrl: browser.runtime.getURL("icons/icon.svg"),
      title: "Échec de l'envoi sur reMarkable",
      message: expired ? PAIRING_EXPIRED : error.message,
    });
  }
}
