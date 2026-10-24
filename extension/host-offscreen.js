/* Chrome and Edge: answers what background.js passes on to the offscreen document. Every extension page hears the
   content scripts' own messages too; only the ones background.js addressed here are answered. */
chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || msg.to !== 'yaoki-host') return false;
  self.YaokiHost.handle(msg).then(sendResponse, function (err) { sendResponse({ error: String((err && err.message) || err) }); });
  return true;
});
