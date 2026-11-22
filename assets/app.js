/* 界面逻辑：库存、棋盘、结果、形状编辑器、本地保存 */
(function () {
  'use strict';

  var PZ = window.PZ;
  var ROWS = 6, COLS = 6, N = ROWS * COLS;
  var MAX_PIECES = 9;          /* 游戏限制的是总块数，不是每种各 9 块 */
  var W = 476, PAD = 10, S = (W - PAD * 2) / COLS;
  var STORE = 'pz.bag.v2';

  var $ = function (id) { return document.getElementById(id); };

  var state = {
    pieces: [],
    result: null,
    editing: null      /* 正在编辑的拼图 id，null 表示新建 */
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function cloneDefaults() {
    return PZ.DEFAULT_PIECES.map(function (p) {
      return { id: p.id, name: p.name, color: p.color, shape: p.shape.map(function (c) { return c.slice(); }), count: 0 };
    });
  }

  /* 从 id（t3 / c12）里取序号，用于图例排序；自定义拼图排在最后 */
  function numOf(id) {
    var m = /^t(\d+)$/.exec(String(id));
    return m ? parseInt(m[1], 10) : 999;
  }

  /* 把颜色调暗（k<0）或调亮（k>0），用于描边 */
  function shade(hex, k) {
    var n = parseInt(String(hex).slice(1), 16) || 0;
    var ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(function (v) {
      var x = k < 0 ? v * (1 + k) : v + (255 - v) * k;
      return Math.max(0, Math.min(255, Math.round(x)));
    });
    return '#' + ch.map(function (v) { return ('0' + v.toString(16)).slice(-2); }).join('');
  }

  /* ---------- 本地保存 ---------- */

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify(state.pieces));
    } catch (e) { /* 隐私模式下静默失败 */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      if (!raw) return null;
      var list = JSON.parse(raw);
      if (!Array.isArray(list) || !list.length) return null;
      var out = list.filter(function (p) {
        return p && p.shape && p.shape.length && p.shape.length <= N;
      }).map(function (p) {
        return {
          id: String(p.id || Math.random().toString(36).slice(2, 8)),
          name: String(p.name || '拼图').slice(0, 8),
          color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#4f8cff',
          shape: PZ.normalize(p.shape),
          count: Math.max(0, Math.min(MAX_PIECES, parseInt(p.count, 10) || 0))
        };
      });
      /* 内置的 19 种形状必须一个不少；缺的补回来，顺序固定在最前 */
      var byId = {};
      out.forEach(function (p) { byId[p.id] = p; });
      var builtin = PZ.DEFAULT_PIECES.map(function (d) {
        var hit = byId[d.id];
        return hit
          ? { id: d.id, name: d.name, color: d.color, shape: d.shape.map(function (c) { return c.slice(); }), count: hit.count }
          : { id: d.id, name: d.name, color: d.color, shape: d.shape.map(function (c) { return c.slice(); }), count: 0 };
      });
      var custom = out.filter(function (p) { return !PZ.DEFAULT_PIECES.some(function (d) { return d.id === p.id; }); });
      var all = builtin.concat(custom);
      /* 存档可能来自旧版本：总数按 9 块截断，多余的从靠后的拼图里扣 */
      var budget = MAX_PIECES;
      all.forEach(function (p) {
        if (budget <= 0) { p.count = 0; return; }
        if (p.count > budget) p.count = budget;
        budget -= p.count;
      });
      return all;
    } catch (e) { return null; }
  }

  /* ---------- 小工具 ---------- */

  /* 缩略图用「逐格小方块」绘制：小尺寸下比合并轮廓更容易数清有几格；
     格子大小固定（按最长的 4 格算），这样不同形状之间可以直接比大小 */
  function miniSvg(shape, color, size, radius) {
    var norm = PZ.normalize(shape);
    var b = PZ.bounds(norm);
    var inset = 3;
    var s = (size - inset * 2) / 4;
    var gap = Math.max(0.8, s * 0.08);
    var r = Math.min(radius, s * 0.26);
    var ox = (size - b.w * s) / 2, oy = (size - b.h * s) / 2;
    var rects = norm.map(function (c) {
      return '<rect x="' + (ox + c[1] * s + gap / 2).toFixed(2) +
        '" y="' + (oy + c[0] * s + gap / 2).toFixed(2) +
        '" width="' + (s - gap).toFixed(2) +
        '" height="' + (s - gap).toFixed(2) +
        '" rx="' + r.toFixed(2) + '"/>';
    }).join('');
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size +
      '" aria-hidden="true"><g fill="' + esc(color) + '">' + rects + '</g></svg>';
  }

  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 1900);
  }

  function totalCells() {
    return state.pieces.reduce(function (s, p) { return s + p.count * p.shape.length; }, 0);
  }

  function totalPieces() {
    return state.pieces.reduce(function (s, p) { return s + p.count; }, 0);
  }

  function activePieces() {
    return state.pieces.filter(function (p) { return p.count > 0; });
  }

  /* ---------- 库存 ---------- */

  /* 上一次求解里没放进去的块：id -> 数量 */
  function unplacedMap() {
    var m = {};
    if (!state.result || !state.result.unplaced) return m;
    state.result.unplaced.forEach(function (u) { m[u.id] = u.count; });
    return m;
  }

  function renderInventory() {
    var host = $('pieceList');
    host.innerHTML = '';
    var full = totalPieces() >= MAX_PIECES;
    var lost = unplacedMap();

    state.pieces.forEach(function (p) {
      var unl = lost[p.id] || 0;
      var row = document.createElement('div');
      row.className = 'piece-row' + (p.count === 0 ? ' is-empty' : '') + (unl > 0 ? ' is-unplaced' : '');
      row.dataset.id = p.id;

      var meta = document.createElement('button');
      meta.type = 'button';
      meta.className = 'piece-swatch';
      meta.title = p.name + ' · ' + PZ.shapeLabel(p.shape) + '（点击改形状）';
      meta.innerHTML = miniSvg(p.shape, p.color, 48, 7);
      meta.addEventListener('click', function () { openEditor(p.id); });

      if (unl > 0) {
        var badge = document.createElement('span');
        badge.className = 'unl-badge';
        badge.textContent = unl > 1 ? '×' + unl : '!';
        badge.title = '上一轮有 ' + unl + ' 块没放进去';
        meta.appendChild(badge);
      }

      var text = document.createElement('div');
      text.className = 'piece-text';
      text.innerHTML = '<div class="piece-name">' + esc(p.name) + '</div>';

      var stepper = document.createElement('div');
      stepper.className = 'stepper';
      var minus = document.createElement('button');
      minus.type = 'button'; minus.textContent = '−'; minus.setAttribute('aria-label', '减少 ' + p.name);
      if (p.count === 0) minus.disabled = true;
      var num = document.createElement('span');
      num.className = 'count' + (p.count === 0 ? ' is-zero' : '');
      num.textContent = p.count;
      var plus = document.createElement('button');
      plus.type = 'button'; plus.textContent = '+'; plus.setAttribute('aria-label', '增加 ' + p.name);
      if (full) { plus.disabled = true; plus.title = '一共最多 9 块，先减掉一块'; }

      minus.addEventListener('click', function () { bump(p, -1); });
      plus.addEventListener('click', function () { bump(p, 1); });

      stepper.appendChild(minus); stepper.appendChild(num); stepper.appendChild(plus);
      row.appendChild(meta); row.appendChild(text); row.appendChild(stepper);
      host.appendChild(row);
    });

    var t = totalPieces(), c = totalCells();
    $('invSummary').textContent = t + ' / ' + MAX_PIECES + ' 块 · ' + c + ' / 36 格';
    $('mbPieces').textContent = t;
    $('mbCells').textContent = c;

    renderWarn(t, c);
  }

  function bump(p, delta) {
    if (delta > 0 && totalPieces() >= MAX_PIECES) {
      toast('一共最多 ' + MAX_PIECES + ' 块，先减掉一块再加');
      return;
    }
    var next = Math.max(0, Math.min(MAX_PIECES, p.count + delta));
    if (next === p.count) return;
    p.count = next;
    save();
    renderInventory();
    softClear();
  }

  function renderWarn(t, c) {
    var el = $('warn'), msg = [];
    if (t > MAX_PIECES) msg.push('拼图一共 ' + t + ' 块，超过 9 块上限。');
    else if (c > N) msg.push('拼图一共 ' + c + ' 格，超过棋盘的 36 格，放不下全部。');
    if (!t) msg.push('库存还是空的：点右侧 + 增加数量，或点右上角「载入示例」。');
    if (msg.length) {
      el.innerHTML = msg.join('<br>');
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  /* ---------- 棋盘 ---------- */

  function renderBoard(res) {
    var svg = $('board');
    var parts = [];

    parts.push('<defs>' +
      '<linearGradient id="boardbg" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="#fdfaf3"/><stop offset="1" stop-color="#f4ecdc"/>' +
      '</linearGradient>' +
      '<filter id="psh" x="-15%" y="-15%" width="130%" height="130%">' +
      '<feDropShadow dx="0" dy="2.5" stdDeviation="2.6" flood-color="#4a3520" flood-opacity=".26"/>' +
      '</filter>' +
      '</defs>');

    parts.push('<rect x="0" y="0" width="' + W + '" height="' + W + '" rx="18" fill="url(#boardbg)"/>');

    /* 空格底 */
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        parts.push('<rect x="' + (PAD + c * S + 2) + '" y="' + (PAD + r * S + 2) +
          '" width="' + (S - 4) + '" height="' + (S - 4) +
          '" rx="10" fill="#f6f0e3" stroke="#e8dcc6" stroke-width="1"/>');
      }
    }

    if (res && res.placements && res.placements.length) {
      res.placements.forEach(function (pl, i) {
        var d = PZ.polyPath(pl.cells, S, PAD, 7);
        parts.push('<g class="piece-g" filter="url(#psh)" style="animation-delay:' + (i * 40) + 'ms">');
        parts.push('<title>' + esc(pl.name) + ' · ' + pl.cells.length + ' 格</title>');
        parts.push('<path d="' + d + '" fill="' + esc(pl.color) + '" stroke="' + shade(pl.color, -0.28) +
          '" stroke-width="1.4" stroke-linejoin="round"/>');
        parts.push('</g>');
      });

      /* 一块拼图是一整片颜色，再补一层极淡的格线，保证"每格多大"仍然看得清 */
      for (var k = 1; k < COLS; k++) {
        var gx = PAD + k * S, gy = PAD + k * S;
        parts.push('<line x1="' + gx + '" y1="' + PAD + '" x2="' + gx + '" y2="' + (PAD + ROWS * S) +
          '" stroke="rgba(70,52,34,.12)" stroke-width="1"/>');
        parts.push('<line x1="' + PAD + '" y1="' + gy + '" x2="' + (PAD + COLS * S) + '" y2="' + gy +
          '" stroke="rgba(70,52,34,.12)" stroke-width="1"/>');
      }
    } else {
      /* 还没求解时，给空棋盘点出浅浅的格心 */
      for (var r2 = 0; r2 < ROWS; r2++) {
        for (var c2 = 0; c2 < COLS; c2++) {
          parts.push('<circle cx="' + (PAD + c2 * S + S / 2) + '" cy="' + (PAD + r2 * S + S / 2) +
            '" r="2" fill="#ded2bc"/>');
        }
      }
    }

    svg.innerHTML = parts.join('');
  }

  /* ---------- 结果 ---------- */

  function renderResult(res) {
    var box = $('result');

    if (!res) {
      box.innerHTML = '<div class="result-idle">' +
        '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 7h16M4 12h10M4 17h13"/></svg>' +
        '<p>求解结果会显示在这里：占用格数、空位连通情况，以及还能补哪一块。</p></div>';
      return;
    }

    var covered = res.covered;
    var empty = N - covered;
    var cls, badge, title;

    if (res.status === 'exact') {
      cls = 'ok'; badge = '精确覆盖'; title = N + ' 格全部铺满';
    } else if (res.status === 'best') {
      cls = 'warn'; badge = '未铺满'; title = '已铺 ' + covered + ' 格，还空 ' + empty + ' 格';
    } else {
      cls = 'bad'; badge = '无法放置'; title = '当前拼图一块都放不下';
    }

    var html = '<div class="res-head"><span class="badge ' + cls + '">' + badge + '</span>' +
      '<span class="res-title">' + title + '</span></div>';

    /* 有拼图没放进去时，用整块醒目的提示顶在最前面 */
    var unplacedCount = (res.unplaced || []).reduce(function (s, u) { return s + u.count; }, 0);
    if (unplacedCount > 0) {
      var byId = {};
      state.pieces.forEach(function (p) { byId[p.id] = p; });

      html += '<div class="res-alert">' +
        '<div class="res-alert-head">' +
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 8.5v5"/><circle cx="12" cy="16.6" r=".9" fill="currentColor" stroke="none"/>' +
        '<path d="M10.3 3.9 2.6 17.2A1.8 1.8 0 0 0 4.2 19.9h15.6a1.8 1.8 0 0 0 1.6-2.7L13.7 3.9a1.8 1.8 0 0 0-3.4 0Z"/></svg>' +
        '还有 ' + unplacedCount + ' 块拼图没放进去' +
        '</div>' +
        '<div class="chips">' + res.unplaced.map(function (u) {
          var p = byId[u.id];
          return '<span class="chip">' +
            (p ? '<span class="chip-ico">' + miniSvg(p.shape, p.color, 20, 5) + '</span>' : '') +
            esc(u.name) + ' <b>×' + u.count + '</b></span>';
        }).join('') + '</div>' +
        '<div class="res-alert-sub">这 ' + unplacedCount + ' 块放不进当前摆法：减掉它们、或换成更小/更合适的形状再求解。</div>' +
        '<div><button type="button" class="res-alert-btn" id="btnDropUnplaced">减掉这 ' + unplacedCount + ' 块再摆</button></div>' +
        '</div>';
    }

    html += '<div class="res-meta">' +
      '<span><i>占用</i> ' + covered + ' / ' + N + ' 格</span>' +
      '<span><i>空位</i> ' + empty + ' 格</span>' +
      '<span><i>连通分量</i> ' + res.comps + '</span>' +
      '<span><i>空位周长</i> ' + res.perimeter + '</span>' +
      '<span><i>用时</i> ' + (Math.round(res.elapsedMs * 10) / 10) + ' ms</span>' +
      '</div>';

    if (res.timedOut && !res.settled) {
      html += '<div class="res-note">搜索已到时间上限，显示的是目前找到的最优方案。</div>';
    }

    if (res.placements.length) {
      /* 图例按序号排；同一种放了几块就合并成一个 ×n，避免重复几个同样的标签 */
      var agg = {}, order = [];
      res.placements.forEach(function (pl) {
        var key = pl.typeId || pl.name;
        if (!agg[key]) {
          agg[key] = { key: key, name: pl.name, color: pl.color, count: 0 };
          order.push(key);
        }
        agg[key].count++;
      });
      order.sort(function (a, b) { return numOf(a) - numOf(b); });

      html += '<div class="chips">' + order.map(function (key) {
        var a = agg[key];
        return '<span class="chip"><i class="sw" style="background:' + esc(a.color) + '"></i>' +
          esc(a.name) + (a.count > 1 ? ' <b>×' + a.count + '</b>' : '') + '</span>';
      }).join('') + '</div>';
    }

    if (empty > 0) {
      var sugg = (res.suggestions || []).slice(0, 3);

      if (sugg.length) {
        html += '<div class="sugg-title">还能补进剩余空位的拼图：</div><div class="sugg-list">';
        sugg.forEach(function (s) {
          html += '<div class="sugg">' +
            '<span class="sugg-ico">' + miniSvg(s.shape, s.color, 22, 5) + '</span>' +
            '<span class="sugg-name">' + esc(s.name) + '</span>' +
            '<span class="sugg-tag' + (s.fitsExactly ? ' hot' : '') + '">' +
            (s.fitsExactly ? '正好补满' : s.area + ' 格 · ' + s.positions + ' 处') + '</span>' +
            '</div>';
        });
        html += '</div>';
      } else {
        html += '<div class="sugg-title">剩余空位没有单块拼图放得进去，可以减少一块再试。</div>';
      }
    }

    box.innerHTML = html;

    if ($('btnDropUnplaced')) {
      $('btnDropUnplaced').addEventListener('click', dropUnplaced);
    }
  }

  /* 一键把没放进去的块减掉，再重新求解 */
  function dropUnplaced() {
    if (!state.result || !state.result.unplaced) return;
    var n = 0;
    state.result.unplaced.forEach(function (u) {
      var p = state.pieces.filter(function (x) { return x.id === u.id; })[0];
      if (!p) return;
      var cut = Math.min(p.count, u.count);
      n += cut;
      p.count -= cut;
    });
    save();
    toast('已减掉 ' + n + ' 块，重新求解');
    solveNow();
  }

  /* ---------- 求解 ---------- */

  function setBusy(on) {
    ['btnSolve', 'btnSolveMobile'].forEach(function (id) {
      var b = $(id);
      b.classList.toggle('is-busy', on);
      b.disabled = on;
    });
  }

  function solveNow() {
    var pieces = activePieces();
    var c = totalCells(), t = totalPieces();

    if (!pieces.length) {
      toast('库存是空的，先加点拼图');
      return;
    }

    var registry = state.pieces
      .filter(function (p) { return p.count > 0; })
      .map(function (p) { return { id: p.id, name: p.name, color: p.color, shape: p.shape }; });

    setBusy(true);
    $('boardHint').textContent = '正在搜索摆放方案…';

    setTimeout(function () {
      var res = PZ.solve({
        rows: ROWS, cols: COLS,
        pieces: pieces,
        registry: registry,
        timeoutMs: c > N || t > 9 ? 300 : 900
      });

      state.result = res;
      renderBoard(res);
      renderResult(res);
      renderInventory();
      updateStats(res);
      setBusy(false);

      if (res.status === 'exact') {
        setPill('ok', '已铺满');
        $('boardHint').textContent = res.placements.length + ' 块正好铺满 36 格';
      } else if (res.status === 'best') {
        var lost = (res.unplaced || []).reduce(function (s, u) { return s + u.count; }, 0);
        if (lost > 0) {
          setPill('bad', '有 ' + lost + ' 块没放下');
          $('boardHint').textContent = '棋盘装不下这 ' + lost + ' 块，看下方红色提示';
        } else {
          setPill('warn', '未铺满');
          $('boardHint').textContent = (res.suggestions && res.suggestions.length)
            ? '空位还能塞进 ' + res.suggestions.length + ' 种拼图，见下方建议'
            : '空位形状对不上现有拼图，少放一块试试';
        }
      } else {
        setPill('bad', '无法放置');
        $('boardHint').textContent = '当前拼图放在 6×6 里都放不下，换换形状吧';
      }
    }, 40);
  }

  /* 棋盘右上角的状态胶囊 */
  function setPill(kind, text) {
    var el = $('boardPill');
    el.className = 'pill' + (kind ? ' ' + kind : '');
    el.textContent = text;
  }

  function updateStats(res) {
    var covered = res ? res.covered : 0;
    $('stCovered').textContent = covered;
    $('stPieces').textContent = res ? res.placedCount : 0;
    $('stEmpty').textContent = N - covered;
  }

  /* 只清掉方案，不动库存 */
  function softClear() {
    if (!state.result) return;
    state.result = null;
    renderBoard(null);
    renderResult(null);
    renderInventory();
    updateStats(null);
    setPill('', '待求解');
    $('boardHint').textContent = '录入拼图数量后，点「开始求解」自动摆放';
  }

  /* ---------- 形状编辑器 ---------- */

  var ed = { cells: {}, color: PZ.COLORS[0] };

  function buildEditorGrid() {
    var grid = $('editorGrid');
    grid.innerHTML = '';
    for (var r = 0; r < 5; r++) {
      for (var c = 0; c < 5; c++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'scell';
        b.dataset.r = r; b.dataset.c = c;
        b.addEventListener('click', function () {
          var k = this.dataset.r + ':' + this.dataset.c;
          if (ed.cells[k]) delete ed.cells[k]; else ed.cells[k] = 1;
          this.classList.toggle('on');
          updateEditorArea();
        });
        grid.appendChild(b);
      }
    }
  }

  function buildSwatches() {
    var host = $('editorColors');
    host.innerHTML = '';
    PZ.COLORS.forEach(function (col) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = col;
      b.dataset.color = col;
      b.addEventListener('click', function () {
        ed.color = col;
        Array.prototype.forEach.call(host.children, function (n) { n.classList.toggle('on', n === b); });
      });
      host.appendChild(b);
    });
  }

  function buildPresets() {
    var host = $('editorPresets');
    host.innerHTML = '';
    PZ.PRESETS.forEach(function (ps) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.innerHTML = miniSvg(ps.cells, '#8a7f72', 18, 4) + '<span>' + esc(ps.name) + '</span>';
      b.addEventListener('click', function () {
        ed.cells = {};
        ps.cells.forEach(function (cell) { ed.cells[cell[0] + ':' + cell[1]] = 1; });
        syncEditorGrid();
      });
      host.appendChild(b);
    });
  }

  function syncEditorGrid() {
    Array.prototype.forEach.call($('editorGrid').children, function (n) {
      n.classList.toggle('on', !!ed.cells[n.dataset.r + ':' + n.dataset.c]);
    });
    updateEditorArea();
  }

  function editorCells() {
    return Object.keys(ed.cells).map(function (k) {
      var a = k.split(':');
      return [parseInt(a[0], 10), parseInt(a[1], 10)];
    });
  }

  function updateEditorArea() {
    var n = editorCells().length;
    $('editorArea').textContent = n + ' 格';
  }

  function openEditor(id) {
    if (id && String(id).charAt(0) === 't') {
      toast('内置 19 种形状是固定编号，改数量就好；要新形状点「＋ 自定义拼图」');
      return;
    }
    state.editing = id || null;
    var p = id ? state.pieces.filter(function (x) { return x.id === id; })[0] : null;

    $('editorTitle').textContent = p ? '编辑拼图 ' + p.name : '新建拼图';
    $('editorName').value = p ? p.name : '';
    $('editorDelete').hidden = !p;

    ed.cells = {};
    ed.color = p ? p.color : PZ.COLORS[state.pieces.length % PZ.COLORS.length];
    if (p) p.shape.forEach(function (c) { ed.cells[c[0] + ':' + c[1]] = 1; });

    syncEditorGrid();
    Array.prototype.forEach.call($('editorColors').children, function (n) {
      n.classList.toggle('on', n.dataset.color === ed.color);
    });

    var dlg = $('editor');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
  }

  function closeEditor() {
    var dlg = $('editor');
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  function saveEditor() {
    var cells = editorCells();
    if (!cells.length) { toast('至少点亮一格'); return; }
    if (!PZ.isConnected(cells)) { toast('格子必须上下左右连成一片'); return; }

    var name = ($('editorName').value || '').trim().slice(0, 8) || '拼图';
    var shape = PZ.normalize(cells);

    /* 同一种形状只留一块（靠数量叠加），避免列表里出现重复形状 */
    var dup = state.pieces.filter(function (x) {
      return x.id !== state.editing && PZ.shapeKey(x.shape) === PZ.shapeKey(shape);
    })[0];
    if (dup) {
      toast('这个形状已经有了（' + dup.name + '），直接调它的数量就好');
      return;
    }

    if (state.editing) {
      var p = state.pieces.filter(function (x) { return x.id === state.editing; })[0];
      if (p) { p.name = name; p.color = ed.color; p.shape = shape; }
    } else {
      state.pieces.push({
        id: 'c' + Date.now().toString(36),
        name: name, color: ed.color, shape: shape, count: 1
      });
    }

    save();
    renderInventory();
    softClear();
    closeEditor();
    toast('已保存');
  }

  function deleteEditor() {
    if (!state.editing) return;
    var target = state.pieces.filter(function (x) { return x.id === state.editing; })[0];
    if (target && !confirm('删除「' + target.name + '」这块拼图？')) return;
    state.pieces = state.pieces.filter(function (p) { return p.id !== state.editing; });
    save();
    renderInventory();
    softClear();
    closeEditor();
    toast('已删除');
  }

  /* ---------- 事件 ---------- */

  function bind() {
    $('btnSolve').addEventListener('click', solveNow);
    $('btnSolveMobile').addEventListener('click', solveNow);
    $('btnClear').addEventListener('click', function () {
      softClear();
      toast('已清空方案');
    });
    $('btnDemo').addEventListener('click', function () {
      state.pieces.forEach(function (p) { p.count = 0; });
      var used = 0, cells = 0;
      PZ.DEMO_RECIPE.forEach(function (r) {
        var p = state.pieces.filter(function (x) { return x.id === r.id; })[0];
        if (p && used + r.count <= 9) { p.count = r.count; used += r.count; cells += r.count * p.shape.length; }
      });
      save();
      renderInventory();
      solveNow();
      toast('已载入示例：' + used + ' 块 · ' + cells + ' 格');
    });
    $('btnReset').addEventListener('click', function () {
      state.pieces.forEach(function (p) { p.count = 0; });
      save();
      renderInventory();
      softClear();
      toast('已重置数量');
    });
    $('btnRestore').addEventListener('click', function () {
      var customs = state.pieces.filter(function (p) { return p.id.charAt(0) !== 't'; });
      if (!customs.length) { toast('没有自定义拼图'); return; }
      if (!confirm('删除这 ' + customs.length + ' 块自定义拼图？内置的 19 种会保留。')) return;
      state.pieces = state.pieces.filter(function (p) { return p.id.charAt(0) === 't'; });
      save();
      renderInventory();
      softClear();
      toast('已清除自定义拼图');
    });
    $('btnAddPiece').addEventListener('click', function () { openEditor(null); });
    $('editorSave').addEventListener('click', saveEditor);
    $('editorDelete').addEventListener('click', deleteEditor);
    $('editorName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); saveEditor(); }
    });
  }

  function init() {
    buildEditorGrid();
    buildSwatches();
    buildPresets();
    bind();

    var saved = load();
    if (saved) {
      state.pieces = saved;
      renderInventory();
      renderBoard(null);
      renderResult(null);
      updateStats(null);
      if (totalPieces() > 0) solveNow();
    } else {
      state.pieces = cloneDefaults();
      /* 首次打开载入示例：9 块正好铺满 36 格 */
      PZ.DEMO_RECIPE.forEach(function (r) {
        var p = state.pieces.filter(function (x) { return x.id === r.id; })[0];
        if (p) p.count = r.count;
      });
      renderInventory();
      save();
      solveNow();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
