/* ===========================================================
   Shell · 一个功能有限的"终端解释器"
   - 命令表可扩展，内容来自纯静态 JSON，零依赖
   - 支持历史、Tab 补全、Ctrl+L/Ctrl+C
   - cd <world> 触发"里世界"转场
   =========================================================== */
(function () {
  'use strict';

  /* ---------------- 输出渲染 ---------------- */
  // 极小的标记：[[显示文本|https://url]] → 链接；其余全部转义
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmt(s) {
    return esc(s).replace(/\[\[(.+?)\|(https?:\/\/[^\]]+)\]\]/g,
      function (_, label, url) {
        return '<a href="' + url + '" target="_blank" rel="noopener">' + label + '</a>';
      });
  }

  /* ---------------- 路径工具 ---------------- */
  function splitPath(p) {
    return p.split('/').filter(Boolean);
  }
  function normalize(parts) {
    var out = [];
    parts.forEach(function (seg) {
      if (seg === '' || seg === '.') return;
      if (seg === '..') { out.pop(); return; }
      out.push(seg);
    });
    return out;
  }
  function joinPath(parts) {
    return parts.length ? parts.join('/') : '';
  }

  /* ---------------- 里世界转场 ---------------- */
  var Reality = {
    el: null,
    play: function (href, lines) {
      var el = document.getElementById('reality');
      if (!el) { location.href = href; return; }
      el.innerHTML = '<div class="reality__lines"></div>';
      var box = el.querySelector('.reality__lines');
      el.classList.add('on');
      var i = 0;
      (function step() {
        if (i >= lines.length) {
          setTimeout(function () { location.href = href; }, 320);
          return;
        }
        var d = document.createElement('div');
        d.className = 'l';
        d.textContent = lines[i++];
        box.appendChild(d);
        setTimeout(step, 110);
      })();
    }
  };
  window.Reality = Reality;

  /* ---------------- 主组件 ---------------- */
  function mount(opts) {
    var root = opts.root;
    var screen = root.querySelector('.shell__screen');
    var out = root.querySelector('.shell__out');
    var input = root.querySelector('input');
    var promptEl = root.querySelector('.shell__prompt');
    var files = opts.tree || {};
    var cwd = ['~'];
    var hist = [];
    var histIdx = -1;
    var busy = false;

    try {
      hist = JSON.parse(sessionStorage.getItem('shell.hist') || '[]');
    } catch (e) { hist = []; }

    function cwdLabel() { return joinPath(cwd); }
    function cwdKey() { return joinPath(cwd) || '~'; }

    function drawPrompt() {
      var p = typeof opts.prompt === 'function'
        ? opts.prompt(cwdLabel())
        : '<b>' + cwdLabel() + '</b> $';
      promptEl.innerHTML = p;
    }

    function scrollDown() { screen.scrollTop = screen.scrollHeight; }

    function emit(text, cls) {
      var lines = Array.isArray(text) ? text : [text];
      lines.forEach(function (t) {
        if (t && typeof t === 'object') {
          if (t.gap) { out.appendChild(document.createElement('div')).className = 'line gap'; return; }
          var d = document.createElement('div');
          d.className = 'line ' + (t.cls || '');
          d.innerHTML = fmt(t.text);
          out.appendChild(d);
        } else {
          var e = document.createElement('div');
          e.className = 'line ' + (cls || '');
          e.innerHTML = fmt(t);
          out.appendChild(e);
        }
      });
      scrollDown();
    }

    function emitCmd(line) {
      var d = document.createElement('div');
      d.className = 'line cmd';
      d.textContent = (opts.promptText ? opts.promptText(cwdLabel()) : cwdLabel() + ' $') + ' ' + line;
      d.style.opacity = '.55';
      out.appendChild(d);
      scrollDown();
    }

    /* 从嵌套的文件树里按路径取节点；根节点固定是 '~' */
    function nodeAt(parts) {
      var node = files['~'];
      for (var i = 1; i < parts.length; i++) {
        if (!node || node.type !== 'dir' || !node.children) return null;
        node = node.children[parts[i]];
      }
      return node || null;
    }

    /* 把用户输入解析成以 '~' 开头的绝对路径数组 */
    function resolve(arg) {
      if (!arg) return cwd.slice();
      var segs;
      if (arg === '~' || arg === '~/') return ['~'];
      if (arg.charAt(0) === '~') segs = normalize(splitPath(arg.slice(1)));
      else segs = normalize(cwd.slice(1).concat(splitPath(arg)));
      return ['~'].concat(segs);
    }

    function lookup(arg) {
      return nodeAt(resolve(arg));
    }

    /* ---------- 内置命令 ---------- */
    var commands = {
      help: function () {
        var rows = [
          '可用指令：',
          '  help              显示本帮助',
          '  ls [路径]         列出当前目录内容',
          '  cat <文件>        查看文件内容',
          '  cd <目录>         切换目录',
          '  pwd               显示当前路径',
          '  whoami            我是谁',
          '  date              当前时间',
          '  history           命令历史',
          '  theme             切换明暗主题',
          '  clear             清屏',
          '  exit              关闭终端'
        ];
        (opts.extraHelp || []).forEach(function (l) { rows.push(l); });
        return rows;
      },
      ls: function (args) {
        var node = args[0] ? lookup(args[0]) : nodeAt(cwd);
        if (!node) return { text: 'ls: 无法访问 \'' + (args[0] || '') + '\': 没有那个目录', cls: 'err' };
        if (node.type === 'file') return args[0];
        var kids = Object.keys(node.children || {});
        if (!kids.length) return { text: '（空目录）', cls: 'dim' };
        return kids.map(function (k) {
          var child = node.children[k];
          var isDir = child.type === 'dir';
          return { text: (isDir ? k + '/' : k) + (child.note ? '   ' + child.note : ''), cls: isDir ? 'dir' : '' };
        });
      },
      cat: function (args) {
        if (!args[0]) return { text: 'cat: 缺少操作对象', cls: 'err' };
        var node = lookup(args[0]);
        if (!node) return { text: 'cat: ' + args[0] + ': 没有那个文件', cls: 'err' };
        if (node.type === 'dir') return { text: 'cat: ' + args[0] + ': 是一个目录', cls: 'err' };
        return (node.content || '').split('\n');
      },
      cd: function (args) {
        var target = args[0] || '~';
        if (opts.worlds && opts.worlds[target.replace(/\/$/, '')]) {
          var w = opts.worlds[target.replace(/\/$/, '')];
          Reality.play(w.href, w.boot || ['> 正在挂载 /' + target + ' ...', '> 世界线偏移 +0.93σ', '> 欢迎。']);
          return null;
        }
        if (target === '..' && cwd.length === 1) {
          return { text: '已经在家目录了。', cls: 'dim' };
        }
        var parts = resolve(target);
        if (!parts.length) { cwd = ['~']; drawPrompt(); return null; }
        var node = nodeAt(parts);
        if (!node) return { text: 'cd: ' + target + ': 没有那个目录', cls: 'err' };
        if (node.type !== 'dir') return { text: 'cd: ' + target + ': 不是一个目录', cls: 'err' };
        cwd = parts;
        drawPrompt();
        return null;
      },
      pwd: function () { return cwdLabel(); },
      whoami: function () { return opts.whoami || 'guest'; },
      date: function () { return new Date().toLocaleString('zh-CN', { hour12: false }); },
      history: function () {
        if (!hist.length) return { text: '（无历史）', cls: 'dim' };
        return hist.map(function (h, i) { return String(i + 1).padStart(4, ' ') + '  ' + h; });
      },
      theme: function () {
        document.documentElement.classList.toggle('dark');
        return { text: '主题已切换（本 demo 未实现完整暗色，留作扩展点）', cls: 'dim' };
      },
      clear: function () { out.innerHTML = ''; return null; },
      exit: function () {
        if (opts.onExit) return opts.onExit();
        return { text: '会话结束。刷新页面可以重新连接 :)', cls: 'dim' };
      },
      echo: function (args) { return args.join(' '); },
      open: function (args) {
        if (!args[0]) return { text: 'open: 用法 open <url>', cls: 'err' };
        var url = /^https?:\/\//.test(args[0]) ? args[0] : 'https://' + args[0];
        window.open(url, '_blank', 'noopener');
        return { text: '→ ' + url, cls: 'dim' };
      }
    };

    Object.keys(opts.commands || {}).forEach(function (k) {
      commands[k] = opts.commands[k];
    });

    /* ---------- 执行 ---------- */
    function exec(raw) {
      var line = raw.trim();
      if (!line) return Promise.resolve();
      hist.push(line);
      histIdx = hist.length;
      try { sessionStorage.setItem('shell.hist', JSON.stringify(hist.slice(-50))); } catch (err) {}
      emitCmd(line);
      var argv = line.split(/\s+/);
      var name = argv[0];
      var args = argv.slice(1);
      var fn = commands[name];
      if (!fn) {
        var guess = Object.keys(commands).filter(function (c) {
          return c.indexOf(name) === 0 || name.indexOf(c) === 0;
        })[0];
        emit('command not found: ' + name + (guess ? '   （你是不是想输入 ' + guess + '？）' : '   （输入 help 看看有什么）'), 'err');
        return Promise.resolve();
      }
      busy = true;
      root.classList.add('is-busy');
      var res;
      try {
        res = fn(args, { cwd: cwdLabel(), print: emit });
      } catch (e) {
        emit('运行时错误：' + e.message, 'err');
        busy = false; root.classList.remove('is-busy');
        return Promise.resolve();
      }
      return Promise.resolve(res).then(function (r) {
        if (r === undefined || r === null) return;
        if (typeof r === 'string') { emit(r); return; }
        if (Array.isArray(r)) {
          if (r.length && r[0] && typeof r[0] === 'object') emit(r);
          else emit(r);
          return;
        }
        emit(r.text, r.cls);
      }).catch(function (e) {
        emit('错误：' + (e && e.message ? e.message : e), 'err');
      }).then(function () {
        busy = false; root.classList.remove('is-busy');
        scrollDown();
      });
    }

    /* ---------- 输入处理 ---------- */
    function complete() {
      var val = input.value;
      var parts = val.split(/\s+/);
      if (parts.length <= 1) {
        var hits = Object.keys(commands).filter(function (c) { return c.indexOf(val) === 0; });
        if (hits.length === 1) input.value = hits[0] + ' ';
        else if (hits.length > 1) emit(hits.join('  '), 'dim');
        return;
      }
      var last = parts[parts.length - 1];
      var node = (last === '' || last.indexOf('/') === -1) ? nodeAt(cwd) : null;
      var pool = [];
      if (node && node.children) pool = Object.keys(node.children);
      // 注意：不把 opts.worlds 放进补全池——彩蛋不该被 Tab 泄漏
      var m = pool.filter(function (k) { return k.indexOf(last) === 0; });
      if (m.length === 1) {
        parts[parts.length - 1] = m[0];
        input.value = parts.join(' ');
      } else if (m.length > 1) {
        emit(m.join('   '), 'dim');
      }
    }

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var v = input.value;
        input.value = '';
        exec(v);
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!hist.length) return;
        histIdx = Math.max(0, (histIdx < 0 ? hist.length : histIdx) - 1);
        input.value = hist[histIdx] || '';
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!hist.length) return;
        histIdx = Math.min(hist.length, histIdx + 1);
        input.value = hist[histIdx] || '';
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        complete();
        return;
      }
      if (e.key.toLowerCase() === 'l' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        out.innerHTML = '';
        return;
      }
      if (e.key.toLowerCase() === 'c' && e.ctrlKey) {
        // 让浏览器保留复制行为
        if (!window.getSelection().toString()) {
          e.preventDefault();
          emit('^C', 'dim');
          input.value = '';
        }
      }
    });

    screen.addEventListener('click', function (e) {
      if (e.target.tagName !== 'A') input.focus();
    });

    /* ---------- 启动 ---------- */
    drawPrompt();
    if (opts.banner) {
      emit(opts.banner, 'dim');
      emit({ gap: true });
    }
    if (opts.hint !== false) {
      emit('输入 help 查看指令 · Tab 补全 · ↑↓ 翻历史', 'dim');
    }
    input.focus({ preventScroll: true });

    return { exec: exec, print: emit, focus: function () { input.focus(); } };
  }

  window.Shell = { mount: mount };
})();
