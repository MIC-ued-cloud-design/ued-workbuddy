xterm.js 5.5.0 + addon-fit 0.10.0（MIT）· 自托管而不是走 cdnjs：
公司网络可能拦外部 CDN，而这是页面唯一的外部依赖来源，拦了整个终端就没了。
升级方法：npm pack @xterm/xterm@<ver> @xterm/addon-fit@<ver>，取 lib/*.js 和 css/xterm.css。
