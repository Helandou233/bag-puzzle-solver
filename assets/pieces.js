/* 拼图数据与几何工具（纯函数，可独立移植） */
(function (global) {
  'use strict';

  var PZ = global.PZ = global.PZ || {};

  /* ---------- 形状工具 ---------- */

  function normalize(cells) {
    var mr = Infinity, mc = Infinity, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] < mr) mr = cells[i][0];
      if (cells[i][1] < mc) mc = cells[i][1];
    }
    return cells
      .map(function (c) { return [c[0] - mr, c[1] - mc]; })
      .sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  }

  function shapeKey(cells) {
    return normalize(cells).map(function (c) { return c[0] + ':' + c[1]; }).join('|');
  }

  function area(cells) { return cells.length; }

  function isConnected(cells) {
    if (!cells.length) return false;
    var norm = normalize(cells);
    var set = {};
    norm.forEach(function (c) { set[c[0] + ':' + c[1]] = 1; });
    var stack = [[norm[0][0], norm[0][1]]];
    var seen = {}; seen[norm[0][0] + ':' + norm[0][1]] = 1;
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var count = 1;
    while (stack.length) {
      var cur = stack.pop();
      for (var d = 0; d < 4; d++) {
        var k = (cur[0] + dirs[d][0]) + ':' + (cur[1] + dirs[d][1]);
        if (set[k] && !seen[k]) { seen[k] = 1; count++; stack.push([cur[0] + dirs[d][0], cur[1] + dirs[d][1]]); }
      }
    }
    return count === norm.length;
  }

  function bounds(cells) {
    var w = 0, h = 0;
    for (var i = 0; i < cells.length; i++) {
      if (cells[i][0] + 1 > h) h = cells[i][0] + 1;
      if (cells[i][1] + 1 > w) w = cells[i][1] + 1;
    }
    return { w: w, h: h };
  }

  /* 形状说明：宽×高 + 格数，例如 "3×2 · 4 格" */
  function shapeLabel(cells) {
    var b = bounds(cells);
    return b.w + '×' + b.h + ' · ' + cells.length + ' 格';
  }

  /* ---------- 轮廓路径（带圆角的正交多边形） ---------- */

  function polyPath(cells, S, PAD, radius, ox, oy) {
    ox = ox || 0; oy = oy || 0;
    var set = {};
    cells.forEach(function (c) { set[c[0] + ':' + c[1]] = 1; });
    function has(r, c) { return !!set[r + ':' + c]; }

    var edges = [];
    cells.forEach(function (c) {
      var r = c[0], cc = c[1];
      if (!has(r - 1, cc)) edges.push([cc, r, cc + 1, r]);
      if (!has(r, cc + 1)) edges.push([cc + 1, r, cc + 1, r + 1]);
      if (!has(r + 1, cc)) edges.push([cc + 1, r + 1, cc, r + 1]);
      if (!has(r, cc - 1)) edges.push([cc, r + 1, cc, r]);
    });

    var byStart = {};
    edges.forEach(function (e) { byStart[e[0] + ',' + e[1]] = e; });

    var used = {};
    var loops = [];
    for (var ei = 0; ei < edges.length; ei++) {
      var startEdge = edges[ei];
      if (used[startEdge]) continue;
      var loop = [];
      var cur = startEdge;
      var guard = 0;
      while (cur && !used[cur] && guard++ < 500) {
        used[cur] = 1;
        loop.push([cur[0], cur[1]]);
        var nxt = byStart[cur[2] + ',' + cur[3]];
        if (nxt === startEdge) break;
        cur = nxt;
      }
      if (loop.length >= 4) loops.push(loop);
    }

    var d = '';
    loops.forEach(function (raw) {
      // 去掉共线点
      var pts = raw.slice();
      var changed = true, rounds = 0;
      while (changed && rounds++ < 20) {
        changed = false;
        var n = pts.length, out = [];
        for (var i = 0; i < n; i++) {
          var p = pts[i], q = pts[(i - 1 + n) % n], s = pts[(i + 1) % n];
          var cross = (p[0] - q[0]) * (s[1] - p[1]) - (p[1] - q[1]) * (s[0] - p[0]);
          if (Math.abs(cross) < 1e-9) { changed = true; continue; }
          out.push(p);
        }
        if (out.length < 4) break;
        pts = out;
      }
      if (pts.length < 3) return;

      var m = pts.length;
      function X(x) { return +(PAD + ox + x * S).toFixed(2); }
      function Y(y) { return +(PAD + oy + y * S).toFixed(2); }

      for (var j = 0; j < m; j++) {
        var p2 = pts[j], prev = pts[(j - 1 + m) % m], next = pts[(j + 1) % m];
        var v1x = p2[0] - prev[0], v1y = p2[1] - prev[1];
        var v2x = next[0] - p2[0], v2y = next[1] - p2[1];
        var l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
        /* radius 以像素为单位，换算成"格"再按边长截断 */
        var rr = Math.min(radius / S, l1 / 2, l2 / 2);
        var ax = p2[0] - (v1x / l1) * rr, ay = p2[1] - (v1y / l1) * rr;
        var bx = p2[0] + (v2x / l2) * rr, by = p2[1] + (v2y / l2) * rr;
        d += (j === 0 ? 'M' : 'L') + X(ax) + ',' + Y(ay);
        d += 'Q' + X(p2[0]) + ',' + Y(p2[1]) + ' ' + X(bx) + ',' + Y(by);
      }
      d += 'Z';
    });
    return d;
  }

  /* ---------- 全部 19 种「4 格上下左右连通」形状 ----------
     棋盘不能旋转/翻转，所以把旋转、镜像都算作不同种类。
     排序规则：外框行数 → 外框列数 → 逐格坐标（从小到大）。
     1 行 4 列 1 种、2×2 方框 1 种、2 行 3 列 8 种、3 行 2 列 8 种、4 行 1 列 1 种，共 19 种。 */

  PZ.SHAPES19 = [
    [[0, 0], [0, 1], [0, 2], [0, 3]],   /* 01 横四连 */
    [[0, 0], [0, 1], [1, 0], [1, 1]],   /* 02 方块 */
    [[0, 0], [0, 1], [0, 2], [1, 0]],   /* 03 ███ / █·· */
    [[0, 0], [0, 1], [0, 2], [1, 1]],   /* 04 ███ / ·█· */
    [[0, 0], [0, 1], [0, 2], [1, 2]],   /* 05 ███ / ··█ */
    [[0, 0], [0, 1], [1, 1], [1, 2]],   /* 06 ██· / ·██ */
    [[0, 0], [1, 0], [1, 1], [1, 2]],   /* 07 █·· / ███ */
    [[0, 1], [0, 2], [1, 0], [1, 1]],   /* 08 ·██ / ██· */
    [[0, 1], [1, 0], [1, 1], [1, 2]],   /* 09 ·█· / ███ */
    [[0, 2], [1, 0], [1, 1], [1, 2]],   /* 10 ··█ / ███ */
    [[0, 0], [0, 1], [1, 0], [2, 0]],   /* 11 ██ / █· / █· */
    [[0, 0], [0, 1], [1, 1], [2, 1]],   /* 12 ██ / ·█ / ·█ */
    [[0, 0], [1, 0], [1, 1], [2, 0]],   /* 13 █· / ██ / █· */
    [[0, 0], [1, 0], [1, 1], [2, 1]],   /* 14 █· / ██ / ·█ */
    [[0, 0], [1, 0], [2, 0], [2, 1]],   /* 15 █· / █· / ██ */
    [[0, 1], [1, 0], [1, 1], [2, 0]],   /* 16 ·█ / ██ / █· */
    [[0, 1], [1, 0], [1, 1], [2, 1]],   /* 17 ·█ / ██ / ·█ */
    [[0, 1], [1, 1], [2, 0], [2, 1]],   /* 18 ·█ / ·█ / ██ */
    [[0, 0], [1, 0], [2, 0], [3, 0]]    /* 19 竖四连 */
  ];

  /* 色相按黄金角（137.5°）递推：相邻序号不会撞色，19 个颜色整体分布均匀 */
  function hslHex(h, s, l) {
    s /= 100; l /= 100;
    var f = function (n) {
      var k = (n + h / 30) % 12;
      var a = s * Math.min(l, 1 - l);
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    var to = function (x) {
      var v = Math.round(255 * x).toString(16);
      return v.length < 2 ? '0' + v : v;
    };
    return '#' + to(f(0)) + to(f(8)) + to(f(4));
  }

  var PALETTE19 = [];
  for (var pi = 0; pi < 19; pi++) {
    PALETTE19.push(hslHex((pi * 137.508 + 8) % 360, 52, 64));
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  /* 内置拼图 = 全部 19 种形状，名字就是序号 #01…#19，不重复也不缺 */
  PZ.DEFAULT_PIECES = PZ.SHAPES19.map(function (shape, i) {
    return {
      id: 't' + (i + 1),
      name: '#' + pad2(i + 1),
      color: PALETTE19[i],
      shape: shape
    };
  });

  /* 首次打开/载入示例用的 9 块：形状互不相同，正好铺满 36 格
     （组合已用穷举验证存在精确覆盖，见 tests/tile-check.py） */
  PZ.DEMO_RECIPE = [
    { id: 't1', count: 1 },   /* 01 横四连 */
    { id: 't2', count: 1 },   /* 02 方块 */
    { id: 't3', count: 1 },   /* 03 ███ / █·· */
    { id: 't4', count: 1 },   /* 04 ███ / ·█· */
    { id: 't6', count: 1 },   /* 06 ██· / ·██ */
    { id: 't7', count: 1 },   /* 07 █·· / ███ */
    { id: 't10', count: 1 },  /* 10 ··█ / ███ */
    { id: 't17', count: 1 },  /* 17 ·█ / ██ / ·█ */
    { id: 't19', count: 1 }   /* 19 竖四连 */
  ];

  /* 形状编辑器里的备选颜色：就是 19 个序号色 */
  PZ.COLORS = PALETTE19.slice();

  PZ.PRESETS = [
    { name: '长条', cells: [[0, 0], [0, 1], [0, 2], [0, 3]] },
    { name: '方块', cells: [[0, 0], [0, 1], [1, 0], [1, 1]] },
    { name: 'T 形', cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
    { name: 'S 形', cells: [[0, 0], [0, 1], [1, 1], [1, 2]] },
    { name: 'Z 形', cells: [[0, 1], [0, 2], [1, 0], [1, 1]] },
    { name: 'J 形', cells: [[0, 0], [0, 1], [0, 2], [1, 0]] },
    { name: 'L 形', cells: [[0, 0], [0, 1], [0, 2], [1, 2]] }
  ];

  PZ.normalize = normalize;
  PZ.shapeKey = shapeKey;
  PZ.area = area;
  PZ.isConnected = isConnected;
  PZ.bounds = bounds;
  PZ.shapeLabel = shapeLabel;
  PZ.polyPath = polyPath;

})(typeof window !== 'undefined' ? window : globalThis);
