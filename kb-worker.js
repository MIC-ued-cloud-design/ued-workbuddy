/**
 * 检索用的 Web Worker。
 *
 * 存在的理由：kb.js 是 7.2 MB，在主线程里解析要 1686ms，界面会冻住；
 * 语料对象加上小写缓存还会把主线程堆推到 18MB。
 * 放进 Worker 之后主线程既不解析也不持有，堆回到 2MB 上下，那一下冻结消失。
 *
 * importScripts 是同步阻塞的，但阻塞的是 Worker 自己的线程，界面照常响应。
 */
self.importScripts('kb-search.js', 'kb.js');

self.onmessage = function (e) {
  var d = e.data || {};
  try {
    if (d.type === 'ping') {
      var kb = self.WBKB;
      self.postMessage({ type: 'ready', meta: kb ? {
        docs: kb.docs, chunks: kb.chunks, chars: kb.chars, by: kb.by, gen: kb.gen
      } : null });
      return;
    }
    if (d.type === 'query') {
      var out = self.WBSearch.retrieve(self.WBKB, d.q, d.budget);
      self.postMessage({ type: 'result', id: d.id, chunks: out });
      return;
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: d.id, message: String(err && err.message || err) });
  }
};
