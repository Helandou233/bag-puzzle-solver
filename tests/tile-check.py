# -*- coding: utf-8 -*-
"""校验 assets/pieces.js 里的形状定义：

1. 4 格上下左右连通、固定朝向的形状一共 19 种（旋转/镜像算不同）；
2. PZ.SHAPES19 里的 19 条与穷举结果一一对应，不缺不重；
3. PZ.DEMO_RECIPE 那 9 块确实能精确铺满 6x6。

运行：python tests/tile-check.py
"""

import json
import re
import sys
from pathlib import Path

N = 6
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "pieces.js"


def norm(cells):
    mr = min(r for r, c in cells)
    mc = min(c for r, c in cells)
    return tuple(sorted((r - mr, c - mc) for r, c in cells))


def all_tetrominoes():
    """从单个格子生长出所有 4 格连通形状。"""
    cur = {norm([(0, 0)])}
    for _ in range(3):
        nxt = set()
        for sh in cur:
            cells = set(sh)
            for (r, c) in sh:
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    p = (r + dr, c + dc)
                    if p not in cells:
                        nxt.add(norm(list(cells | {p})))
        cur = nxt
    return sorted(
        cur,
        key=lambda sh: (
            max(r for r, c in sh) + 1,
            max(c for r, c in sh) + 1,
            sh,
        ),
    )


def parse_shapes(src):
    """从 pieces.js 里抠出 SHAPES19 的 19 组坐标。"""
    block = re.search(r"PZ\.SHAPES19\s*=\s*\[(.*?)\n  \];", src, re.S)
    if not block:
        raise SystemExit("找不到 PZ.SHAPES19")
    groups = re.findall(r"\[((?:\[\s*\d+\s*,\s*\d+\s*\][,\s]*)+)\]", block.group(1))
    return [norm(json.loads("[%s]" % g)) for g in groups]


def parse_recipe(src):
    block = re.search(r"PZ\.DEMO_RECIPE\s*=\s*\[(.*?)\n  \];", src, re.S)
    if not block:
        raise SystemExit("找不到 PZ.DEMO_RECIPE")
    return [(m.group(1), int(m.group(2))) for m in
            re.finditer(r"id:\s*'(\w+)',\s*count:\s*(\d+)", block.group(1))]


def placements(shape):
    h = max(r for r, c in shape) + 1
    w = max(c for r, c in shape) + 1
    return [
        frozenset((r + dr) * N + (c + dc) for r, c in shape)
        for dr in range(N - h + 1)
        for dc in range(N - w + 1)
    ]


def can_tile(shapes):
    """给定形状多重集，判定 6x6 能否精确覆盖（最先落空格、候选最少的格子优先）。"""
    pl = {sh: placements(sh) for sh in set(shapes)}
    occ = [0] * (N * N)
    used = [False] * len(shapes)
    nodes = 0

    def rec():
        nonlocal nodes
        nodes += 1
        if nodes > 2000000:
            raise SystemExit("搜索超限，结论不可信")
        free = [i for i in range(N * N) if not occ[i]]
        if not free:
            return True
        best_opts = None
        for cell in free:
            opts = []
            for i, sh in enumerate(shapes):
                if used[i]:
                    continue
                for p in pl[sh]:
                    if cell in p and not any(occ[x] for x in p):
                        opts.append((i, p))
            if best_opts is None or len(opts) < len(best_opts):
                best_opts = opts
                if not opts:
                    return False
        for i, p in best_opts:
            for x in p:
                occ[x] = 1
            used[i] = True
            if rec():
                return True
            used[i] = False
            for x in p:
                occ[x] = 0
        return False

    ok = rec()
    return ok, nodes


def main():
    src = SRC.read_text(encoding="utf-8")
    ref = all_tetrominoes()
    got = parse_shapes(src)

    print("穷举得到的四格连通形状：%d 种" % len(ref))
    if len(ref) != 19:
        raise SystemExit("数量不是 19")

    print("pieces.js 里的 SHAPES19：%d 条" % len(got))
    if len(set(got)) != len(got):
        raise SystemExit("SHAPES19 里有重复形状")
    if set(got) != set(ref):
        miss = set(ref) - set(got)
        extra = set(got) - set(ref)
        raise SystemExit("SHAPES19 与穷举结果不一致：缺 %s / 多 %s" % (miss, extra))

    recipe = parse_recipe(src)
    shapes = []
    for pid, count in recipe:
        idx = int(pid[1:]) - 1
        shapes.extend([got[idx]] * count)
    area = sum(len(s) for s in shapes)
    print("DEMO_RECIPE：%d 块 / %d 格" % (len(shapes), area))
    if area != N * N:
        raise SystemExit("示例组合不是 36 格")

    ok, nodes = can_tile(shapes)
    print("示例组合可精确铺满 6x6：%s（%d 结点）" % ("是" if ok else "否", nodes))
    if not ok:
        raise SystemExit("示例组合铺不满，换一组")

    print("全部检查通过")


if __name__ == "__main__":
    sys.exit(main())
