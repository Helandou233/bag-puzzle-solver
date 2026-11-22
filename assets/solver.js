/* 6×6 拼图回溯求解器（纯逻辑，不依赖 DOM）
 * 1) 贪心先求一个可行解，抬高下界；
 * 2) 按“第一个空格子”递归：用某块拼图盖住它，或把该格固定为空；
 * 3) 单次搜索有节点上限，超限就换一种候选顺序重启（随机化重排），
 *    在时间预算内多试几条不同的分支，避免卡在同一个死角。
 * 目标按字典序：占用格数最多 → 空位连通分量最少 → 空位周长最小。 */
(function (global) {
  'use strict';

  var PZ = global.PZ = global.PZ || {};

  var NOW = (typeof performance !== 'undefined' && performance.now)
    ? function () { return performance.now(); }
    : function () { return Date.now(); };

  /* 固定朝向下，一种形状在棋盘上的全部合法平移 */
  function placementsFor(shape, rows, cols) {
    var norm = PZ.normalize(shape);
    var b = PZ.bounds(norm);
    var out = [];
    for (var r = 0; r <= rows - b.h; r++) {
      for (var c = 0; c <= cols - b.w; c++) {
        var cells = [], idx = [];
        for (var i = 0; i < norm.length; i++) {
          var rr = norm[i][0] + r, cc = norm[i][1] + c;
          cells.push([rr, cc]);
          idx.push(rr * cols + cc);
        }
        out.push({ r: r, c: c, cells: cells, idx: idx });
      }
    }
    return out;
  }

  function allCells(rows, cols) {
    var out = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) out.push([r, c]);
    return out;
  }

  function solve(cfg) {
    var rows = cfg.rows || 6;
    var cols = cfg.cols || 6;
    var N = rows * cols;
    var timeout = cfg.timeoutMs || 900;
    var maxNodes = cfg.maxNodes || 8000000;
    var t0 = NOW();

    var types = (cfg.pieces || [])
      .filter(function (p) { return p.count > 0 && p.shape && p.shape.length; })
      .map(function (p) {
        var shape = PZ.normalize(p.shape);
        return {
          id: p.id, name: p.name, color: p.color,
          shape: shape, area: shape.length, count: p.count,
          placements: placementsFor(shape, rows, cols)
        };
      });

    var registry = cfg.registry || [];
    var totalCount = types.reduce(function (s, t) { return s + t.count; }, 0);

    if (!types.length) {
      var emptyBoard = allCells(rows, cols);
      return {
        status: 'none', placements: [], covered: 0, emptyCells: emptyBoard,
        comps: 1, perimeter: 0, placedCount: 0, totalCount: 0, unplaced: [],
        suggestions: buildSuggestions(emptyBoard, registry, rows, cols),
        elapsedMs: 0, timedOut: false, nodes: 0
      };
    }

    /* 每个格子 -> 覆盖它的 (类型, 放置)，按“贴边程度”从高到低排序 */
    var coverMap = [];
    for (var i = 0; i < N; i++) coverMap.push([]);

    for (var ti = 0; ti < types.length; ti++) {
      var t = types[ti];
      for (var pi = 0; pi < t.placements.length; pi++) {
        var pl = t.placements[pi];
        var edge = 0;
        for (var k = 0; k < pl.cells.length; k++) {
          var rr = pl.cells[k][0], cc = pl.cells[k][1];
          if (rr === 0 || rr === rows - 1 || cc === 0 || cc === cols - 1) edge++;
        }
        pl.edge = edge;
        for (var k2 = 0; k2 < pl.idx.length; k2++) {
          coverMap[pl.idx[k2]].push({ ti: ti, pi: pi, edge: edge });
        }
      }
    }
    for (var ci = 0; ci < N; ci++) {
      coverMap[ci].sort(function (a, b) { return b.edge - a.edge; });
    }

    /* 空位连通分量 + 空位周长 */
    function scoreOf(occ) {
      var comps = 0, perimeter = 0;
      var seen = new Uint8Array(N);
      var stack = [];
      for (var s0 = 0; s0 < N; s0++) {
        if (occ[s0] || seen[s0]) continue;
        comps++;
        seen[s0] = 1; stack.length = 0; stack.push(s0);
        while (stack.length) {
          var x = stack.pop();
          var r = (x / cols) | 0, c = x % cols;
          if (r > 0) { var u = x - cols; if (!occ[u] && !seen[u]) { seen[u] = 1; stack.push(u); } }
          if (r < rows - 1) { var d = x + cols; if (!occ[d] && !seen[d]) { seen[d] = 1; stack.push(d); } }
          if (c > 0) { var l = x - 1; if (!occ[l] && !seen[l]) { seen[l] = 1; stack.push(l); } }
          if (c < cols - 1) { var rt = x + 1; if (!occ[rt] && !seen[rt]) { seen[rt] = 1; stack.push(rt); } }
        }
      }
      for (var r2 = 0; r2 < rows; r2++) {
        for (var c2 = 0; c2 < cols; c2++) {
          var i2 = r2 * cols + c2;
          if (occ[i2]) continue;
          if (r2 === 0 || occ[i2 - cols]) perimeter++;
          if (r2 === rows - 1 || occ[i2 + cols]) perimeter++;
          if (c2 === 0 || occ[i2 - 1]) perimeter++;
          if (c2 === cols - 1 || occ[i2 + 1]) perimeter++;
        }
      }
      return { comps: comps, perimeter: perimeter };
    }

    var best = null;

    function better(cov, sc) {
      return !best ||
        cov > best.covered ||
        (cov === best.covered && sc.comps < best.comps) ||
        (cov === best.covered && sc.comps === best.comps && sc.perimeter < best.perimeter);
    }

    /* ---------- 贪心：先拿一个可行解当下界 ---------- */
    (function greedy() {
      var used = types.map(function () { return 0; });
      var g = new Uint8Array(N);
      var gCovered = 0;
      var picks = [];

      var order = types.map(function (_, i) { return i; })
        .sort(function (a, b) { return types[a].placements.length - types[b].placements.length; });

      for (var oi = 0; oi < order.length; oi++) {
        var idx = order[oi], tt = types[idx];
        for (var n = 0; n < tt.count; n++) {
          var chosen = -1, chosenScore = -1;
          for (var p = 0; p < tt.placements.length; p++) {
            var ppl = tt.placements[p];
            var ok = true;
            for (var q = 0; q < ppl.idx.length; q++) { if (g[ppl.idx[q]]) { ok = false; break; } }
            if (!ok) continue;
            /* 接触分：贴边算 2，贴已有拼图算 1 —— 越大越紧凑 */
            var sc2 = 0;
            for (var c2 = 0; c2 < ppl.cells.length; c2++) {
              var r3 = ppl.cells[c2][0], cc2 = ppl.cells[c2][1];
              if (r3 === 0) sc2 += 2;
              if (r3 === rows - 1) sc2 += 2;
              if (cc2 === 0) sc2 += 2;
              if (cc2 === cols - 1) sc2 += 2;
              if (r3 > 0 && g[(r3 - 1) * cols + cc2]) sc2++;
              if (r3 < rows - 1 && g[(r3 + 1) * cols + cc2]) sc2++;
              if (cc2 > 0 && g[r3 * cols + cc2 - 1]) sc2++;
              if (cc2 < cols - 1 && g[r3 * cols + cc2 + 1]) sc2++;
            }
            if (sc2 > chosenScore) { chosenScore = sc2; chosen = p; }
          }
          if (chosen < 0) break;
          var cp = tt.placements[chosen];
          for (var q2 = 0; q2 < cp.idx.length; q2++) g[cp.idx[q2]] = 1;
          gCovered += tt.area;
          used[idx]++;
          picks.push({ ti: idx, pi: chosen });
        }
      }

      if (picks.length) {
        var sc3 = scoreOf(g);
        if (better(gCovered, sc3)) {
          best = {
            covered: gCovered, comps: sc3.comps, perimeter: sc3.perimeter,
            picks: picks,
            remain: types.map(function (tt2, i2) { return tt2.count - used[i2]; })
          };
        }
      }
    })();

    /* ---------- 回溯（可重启） ---------- */
    var occ = new Uint8Array(N);
    var fixedEmpty = new Uint8Array(N);
    var remain = types.map(function (t3) { return t3.count; });
    var remainArea = types.reduce(function (s, t4) { return s + t4.count * t4.area; }, 0);
    var covered = 0;
    var picked = [];
    var nodes = 0;
    var attemptNodeLimit = 0;
    var timedOut = false;
    var perfect = false;
    var stop = false;

    function record() {
      var sc = scoreOf(occ);
      if (better(covered, sc)) {
        best = {
          covered: covered, comps: sc.comps, perimeter: sc.perimeter,
          picks: picked.map(function (p) { return { ti: p.ti, pi: p.pi }; }),
          remain: remain.slice()
        };
      }
    }

    function dfs() {
      if (stop || perfect || timedOut) return;
      nodes++;
      if ((nodes & 255) === 0) {
        if (nodes > maxNodes || NOW() - t0 > timeout) { timedOut = true; return; }
        if (nodes > attemptNodeLimit) { stop = true; return; }
      }
      if (best && covered + remainArea < best.covered) return;

      if (covered === N || remainArea === 0) {
        record();
        if (covered === N) perfect = true;
        return;
      }

      var cell = -1;
      for (var i = 0; i < N; i++) { if (!occ[i] && !fixedEmpty[i]) { cell = i; break; } }
      if (cell < 0) { record(); return; }

      var opts = coverMap[cell];
      for (var oi = 0; oi < opts.length; oi++) {
        var opt = opts[oi];
        var tt = types[opt.ti];
        if (remain[opt.ti] <= 0) continue;
        var p = tt.placements[opt.pi];
        var ok = true;
        for (var c3 = 0; c3 < p.idx.length; c3++) { if (occ[p.idx[c3]]) { ok = false; break; } }
        if (!ok) continue;

        for (var c4 = 0; c4 < p.idx.length; c4++) occ[p.idx[c4]] = 1;
        remain[opt.ti]--; remainArea -= tt.area; covered += tt.area;
        picked.push({ ti: opt.ti, pi: opt.pi });
        dfs();
        picked.pop();
        covered -= tt.area; remainArea += tt.area; remain[opt.ti]++;
        for (var c5 = 0; c5 < p.idx.length; c5++) occ[p.idx[c5]] = 0;
        if (stop || perfect || timedOut) return;
      }

      fixedEmpty[cell] = 1;
      dfs();
      fixedEmpty[cell] = 0;
    }

    /* 每次重启换一种候选顺序：用固定种子，结果可复现 */
    var seedState = 20240917;
    function rnd() {
      seedState = (seedState * 1103515245 + 12345) & 0x7fffffff;
      return seedState / 0x7fffffff;
    }
    function shuffleOrders() {
      for (var ci2 = 0; ci2 < N; ci2++) {
        var arr = coverMap[ci2];
        for (var j = arr.length - 1; j > 0; j--) {
          var kk = (rnd() * (j + 1)) | 0;
          var tmp = arr[j]; arr[j] = arr[kk]; arr[kk] = tmp;
        }
      }
    }

    var perAttempt = Math.max(40000, Math.floor(maxNodes / 6));
    var attempt = 0;

    while (true) {
      occ.fill(0); fixedEmpty.fill(0);
      remain = types.map(function (t6) { return t6.count; });
      remainArea = types.reduce(function (s, t7) { return s + t7.count * t7.area; }, 0);
      covered = 0; picked = []; stop = false;

      /* 第一轮用“贴边优先”的原始顺序（精确覆盖通常很快），之后换随机顺序 */
      if (attempt > 0) shuffleOrders();
      attemptNodeLimit = nodes + (attempt === 0 ? perAttempt * 2 : perAttempt);

      dfs();
      attempt++;

      if (perfect || timedOut) break;
      if (!stop) break;              /* 本轮把空间穷尽了，不用再重启 */
      if (attempt >= 24) break;
    }

    var elapsed = NOW() - t0;

    if (!best) {
      var emptyAll = allCells(rows, cols);
      return {
        status: 'none', placements: [], covered: 0, emptyCells: emptyAll,
        comps: 1, perimeter: 0, placedCount: 0, totalCount: totalCount,
        unplaced: types.map(function (t5) { return { id: t5.id, name: t5.name, color: t5.color, count: t5.count }; }),
        suggestions: buildSuggestions(emptyAll, registry, rows, cols),
        elapsedMs: elapsed, timedOut: timedOut, nodes: nodes
      };
    }

    /* 用最优解重建占用与空位 */
    var occupied = new Uint8Array(N);
    var placements = best.picks.map(function (p) {
      var tt = types[p.ti];
      var ppl = tt.placements[p.pi];
      for (var i = 0; i < ppl.idx.length; i++) occupied[ppl.idx[i]] = 1;
      return {
        typeId: tt.id, name: tt.name, color: tt.color,
        cells: ppl.cells.map(function (c) { return [c[0], c[1]]; }),
        anchor: [ppl.r, ppl.c]
      };
    });

    var emptyCells = [];
    for (var e = 0; e < N; e++) {
      if (!occupied[e]) emptyCells.push([(e / cols) | 0, e % cols]);
    }

    var placedCount = 0;
    for (var q = 0; q < types.length; q++) placedCount += (types[q].count - best.remain[q]);

    var unplaced = [];
    for (var u = 0; u < types.length; u++) {
      if (best.remain[u] > 0) {
        unplaced.push({ id: types[u].id, name: types[u].name, color: types[u].color, count: best.remain[u] });
      }
    }

    /* 所有拼图都放下了，占用格数不可能再增加，可以直接认定为最优 */
    var settled = best.covered === N || placedCount === totalCount;

    return {
      status: best.covered === N ? 'exact' : (best.covered > 0 ? 'best' : 'none'),
      placements: placements,
      covered: best.covered,
      emptyCells: emptyCells,
      comps: best.comps,
      perimeter: best.perimeter,
      placedCount: placedCount,
      totalCount: totalCount,
      unplaced: unplaced,
      suggestions: buildSuggestions(emptyCells, registry, rows, cols),
      elapsedMs: elapsed,
      timedOut: timedOut,
      settled: settled,
      nodes: nodes
    };
  }

  /* 剩余空位能整体放下哪些拼图（供“补位建议”） */
  function buildSuggestions(emptyCells, registry, rows, cols) {
    if (!emptyCells.length || !registry.length) return [];
    var empty = {};
    emptyCells.forEach(function (c) { empty[c[0] * cols + c[1]] = 1; });
    var emptyCount = emptyCells.length;

    var out = [];
    for (var i = 0; i < registry.length; i++) {
      var item = registry[i];
      if (!item.shape || !item.shape.length) continue;
      var pls = placementsFor(item.shape, rows, cols);
      var positions = 0, sample = null;
      for (var j = 0; j < pls.length; j++) {
        var fits = true;
        for (var k = 0; k < pls[j].idx.length; k++) {
          if (!empty[pls[j].idx[k]]) { fits = false; break; }
        }
        if (fits) { positions++; if (!sample) sample = pls[j].cells; }
      }
      if (positions > 0) {
        out.push({
          id: item.id, name: item.name, color: item.color,
          shape: item.shape, area: item.shape.length,
          fitsExactly: item.shape.length === emptyCount,
          positions: positions,
          sample: sample
        });
      }
    }

    out.sort(function (a, b) {
      if (a.fitsExactly !== b.fitsExactly) return a.fitsExactly ? -1 : 1;
      if (a.area !== b.area) return b.area - a.area;
      return b.positions - a.positions;
    });
    return out;
  }

  PZ.placementsFor = placementsFor;
  PZ.solve = solve;
  PZ.suggest = buildSuggestions;

})(typeof window !== 'undefined' ? window : globalThis);
