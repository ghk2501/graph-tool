// js/layout.js — 力导向自动布局、随机拓扑生成（含结构预设）
// 依赖：core.js、analysis.js。本文件最后加载并启动应用。

    // ===== 力导向自动布局 =====
    // 节点间斥力 + 边引力迭代收敛，降低边交叉与节点重叠，让箭头指向更清晰
    function applyForceLayout(iterations) {
        iterations = iterations || 300;
        const n = nodes.length;
        if (n < 2) return;

        const rect = svg.getBoundingClientRect();
        const w = Math.max(320, rect.width || 800);
        const h = Math.max(240, rect.height || 600);
        const margin = 80;

        // 保存弧线控制点相对两端节点的几何参数（沿边比例 + 法向高度），布局后按新位置还原
        const arcSnap = [];
        edges.forEach(edge => {
            if (edge.type !== '~' || !edge.controlPoint) return;
            const u = getNodeById(edge.u);
            const v = getNodeById(edge.v);
            const cp = edge.controlPoint;
            const dx = v.x - u.x;
            const dy = v.y - u.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ex = dx / len, ey = dy / len;
            const nx = -ey, ny = ex;
            const along = (cp.x - u.x) * ex + (cp.y - u.y) * ey;
            const height = (cp.x - (u.x + ex * along)) * nx + (cp.y - (u.y + ey * along)) * ny;
            arcSnap.push({ edge, t: clampNum(along / len, 0, 1), height });
        });

        // 理想边长与初始温度（Fruchterman-Reingold）
        const k = Math.sqrt((w - 2 * margin) * (h - 2 * margin) / Math.max(n, 1)) * 0.85;
        let temp = Math.min(w, h) / 5;
        const cooling = Math.pow(0.08 / Math.max(temp, 0.01), 1 / iterations);

        // 无向去重边表（平行边只计算一次引力）
        const seen = new Set();
        const links = [];
        edges.forEach(e => {
            const key = e.u < e.v ? e.u + '_' + e.v : e.v + '_' + e.u;
            if (!seen.has(key)) { seen.add(key); links.push([e.u, e.v]); }
        });

        for (let it = 0; it < iterations; it++) {
            const disp = [];
            for (let i = 0; i < n; i++) disp.push({ x: 0, y: 0 });

            // 斥力（库仑式）
            for (let i = 0; i < n; i++) {
                for (let j = i + 1; j < n; j++) {
                    let dx = nodes[j].x - nodes[i].x;
                    let dy = nodes[j].y - nodes[i].y;
                    let d = Math.sqrt(dx * dx + dy * dy);
                    if (d < 1) {
                        dx = (Math.random() - 0.5) * 2;
                        dy = (Math.random() - 0.5) * 2;
                        d = Math.sqrt(dx * dx + dy * dy) || 1;
                    }
                    const f = k * k / d;
                    const fx = dx / d * f;
                    const fy = dy / d * f;
                    disp[i].x -= fx; disp[i].y -= fy;
                    disp[j].x += fx; disp[j].y += fy;
                }
            }

            // 引力（弹簧式）
            links.forEach(link => {
                const a = nodes[link[0]];
                const b = nodes[link[1]];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const d = Math.sqrt(dx * dx + dy * dy) || 1;
                const f = d * d / k;
                const fx = dx / d * f;
                const fy = dy / d * f;
                disp[link[0]].x += fx; disp[link[0]].y += fy;
                disp[link[1]].x -= fx; disp[link[1]].y -= fy;
            });

            // 限制最大位移并约束在画布内
            for (let i = 0; i < n; i++) {
                let dx = disp[i].x;
                let dy = disp[i].y;
                const dl = Math.sqrt(dx * dx + dy * dy);
                if (dl > temp) { dx = dx / dl * temp; dy = dy / dl * temp; }
                nodes[i].x = Math.max(margin, Math.min(w - margin, nodes[i].x + dx));
                nodes[i].y = Math.max(margin, Math.min(h - margin, nodes[i].y + dy));
            }
            temp *= cooling;
        }

        // 还原弧线控制点：两端已移动，按保存的比例/高度重建，保持弧度形状
        arcSnap.forEach(s => {
            const u = getNodeById(s.edge.u);
            const v = getNodeById(s.edge.v);
            const dx = v.x - u.x;
            const dy = v.y - u.y;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const ex = dx / len, ey = dy / len;
            const nx = -ey, ny = ex;
            const along = s.t * len;
            s.edge.controlPoint = {
                x: u.x + ex * along + nx * s.height,
                y: u.y + ey * along + ny * s.height
            };
        });
    }

    // 工具栏“自动布局”入口：对当前画布所有节点重新布局
    function layoutGraph() {
        if (nodes.length === 0) return;
        hideAllMenus();
        applyForceLayout(320);
        optimizeArcs();   // 开启“自动优化弧线”时在布局后重排弧线，否则为无操作
        render();
    }

    // ===== 随机拓扑生成 =====
    const NODE_SHAPES = ['circle', 'square', 'triangle', 'pentagon', 'hexagon'];
    const NODE_COLORS = [
        '#409eff', '#67c23a', '#e6a23c', '#f56c6c', '#9b59b6',
        '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#1abc9c',
        '#8e44ad', '#e67e22', '#27ae60', '#2980b9', '#c0392b',
        '#16a085', '#d35400', '#7f8c8d', '#34495e', '#2c3e50'
    ];

    function randInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function clampNum(v, min, max) {
        return Math.max(min, Math.min(max, v));
    }

    function readNum(id, fallback) {
        const v = Math.floor(Number(document.getElementById(id).value));
        return Number.isFinite(v) ? v : fallback;
    }

    const RAND_PRESET_INFO = {
        random: { label: '完全随机' },
        ring:   { label: '环形',   minN: 3,   maxN: 100, defaultN: 10,
                  desc: n => `环形：${n} 个节点围成一圈，自动生成 ${n} 条边，适合测试环路。` },
        star:   { label: '星形',   minN: 2,   maxN: 100, defaultN: 9,
                  desc: n => `星形：1 个中心 + ${n - 1} 个外围节点，自动生成 ${n - 1} 条边。` },
        tree:   { label: '树形',   minN: 2,   maxN: 150, defaultN: 12,
                  desc: n => `树形：连通且无环，自动生成 ${n - 1} 条边。` },
        wheel:  { label: '轮辐',   minN: 4,   maxN: 100, defaultN: 9,
                  desc: n => `轮辐：中心节点 + ${n - 1} 个轮缘节点（轮缘成环），自动生成 ${2 * (n - 1)} 条边。` },
        grid:   { label: '网格', desc: (r, c) => `网格：${r} 行 × ${c} 列 = ${r * c} 个节点，自动生成 ${r * (c - 1) + (r - 1) * c} 条边。` }
    };

    function refreshPresetTip() {
        const preset = document.getElementById('randPreset').value;
        const tip = document.getElementById('randPresetTip');
        if (preset === 'random') {
            const isRange = document.querySelector('input[name="randMode"]:checked').value === 'range';
            tip.textContent = isRange
                ? '完全随机：节点/连线数量在范围内随机选取。连线数上限 = 节点数 ×（节点数-1），超限自动截断。'
                : '指定数量：按下方节点/连线数量生成随机图。连线数上限 = 节点数 ×（节点数-1），超限自动截断。';
        } else if (preset === 'grid') {
            const r = clampNum(readNum('randGridRows', 4), 2, 20);
            const c = clampNum(readNum('randGridCols', 6), 2, 20);
            tip.textContent = RAND_PRESET_INFO.grid.desc(r, c);
        } else {
            const info = RAND_PRESET_INFO[preset];
            const n = clampNum(readNum('randPresetNodeCount', info.defaultN), info.minN, info.maxN);
            tip.textContent = info.desc(n);
        }
    }

    function togglePreset() {
        const preset = document.getElementById('randPreset').value;
        const isRandom = preset === 'random';
        const isGrid = preset === 'grid';
        const isCountOnly = !isRandom && !isGrid; // ring / star / tree / wheel

        document.getElementById('randModeRow').style.display = isRandom ? 'flex' : 'none';
        document.getElementById('randPresetNodeRow').style.display = isCountOnly ? 'flex' : 'none';
        document.getElementById('randGridRow').style.display = isGrid ? 'flex' : 'none';

        if (isCountOnly) {
            const info = RAND_PRESET_INFO[preset];
            const input = document.getElementById('randPresetNodeCount');
            input.min = info.minN;
            input.max = info.maxN;
            input.value = clampNum(readNum('randPresetNodeCount', info.defaultN), info.minN, info.maxN);
            document.getElementById('randPresetNodeLabel').textContent = `节点数量（${info.minN}~${info.maxN}）`;
        }
        if (isRandom) toggleRandMode(); // 按当前 radio 显示对应行
        refreshPresetTip();
    }

    function toggleRandMode() {
        const isRange = document.querySelector('input[name="randMode"]:checked').value === 'range';
        document.getElementById('randFixedRow').style.display = isRange ? 'none' : 'flex';
        document.getElementById('randNodeRangeRow').style.display = isRange ? 'flex' : 'none';
        document.getElementById('randEdgeRangeRow').style.display = isRange ? 'flex' : 'none';
        refreshPresetTip();
    }

    function setupRandInputListeners() {
        ['randPresetNodeCount', 'randGridRows', 'randGridCols'].forEach(id => {
            document.getElementById(id).addEventListener('input', refreshPresetTip);
        });
    }

    // 将节点散布在画布网格中并加入随机抖动，避免大量重叠
    function computeGridPositions(count, rect) {
        const margin = 70;
        const w = Math.max(200, rect.width - margin * 2);
        const h = Math.max(150, rect.height - margin * 2);
        const cols = Math.ceil(Math.sqrt(count * w / h));
        const rows = Math.ceil(count / cols);
        const cellW = w / cols;
        const cellH = h / rows;
        const positions = [];
        for (let i = 0; i < count; i++) {
            const c = i % cols;
            const r = Math.floor(i / cols);
            positions.push({
                x: margin + (c + 0.5) * cellW + (Math.random() - 0.5) * cellW * 0.6,
                y: margin + (r + 0.5) * cellH + (Math.random() - 0.5) * cellH * 0.6
            });
        }
        return shuffleArray(positions);
    }

    // 生成随机无向节点对：先构造随机生成树保证连通，再补充剩余边（避免同对重复）
    function buildRandomEdges(n, m) {
        const used = new Set();
        const specs = [];
        function tryAdd(u, v) {
            if (u === v) return false;
            const key = u < v ? u + '|' + v : v + '|' + u;
            if (used.has(key)) return false;
            used.add(key);
            return true;
        }

        if (m >= n - 1 && n > 1) {
            const order = shuffleArray([...Array(n).keys()]);
            for (let i = 1; i < n; i++) {
                const u = order[i];
                const v = order[randInt(0, i - 1)];
                tryAdd(u, v);
                specs.push({ u, v });
            }
        }

        let guard = 0;
        while (specs.length < m && guard < m * 30 + 200) {
            guard++;
            const u = randInt(0, n - 1);
            const v = randInt(0, n - 1);
            if (tryAdd(u, v)) specs.push({ u, v });
        }
        return specs;
    }

    function circlePositions(count, cx, cy, radius) {
        const arr = [];
        for (let i = 0; i < count; i++) {
            const a = -Math.PI / 2 + i * 2 * Math.PI / count;
            arr.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
        }
        return arr;
    }

    function gridPositions(rows, cols, rect) {
        const pad = 70;
        const w = Math.max(160, rect.width - pad * 2);
        const h = Math.max(160, rect.height - pad * 2);
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const stepX = cols > 1 ? w / (cols - 1) : 0;
        const stepY = rows > 1 ? h / (rows - 1) : 0;
        const arr = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                arr.push({
                    x: cx + (c - (cols - 1) / 2) * stepX,
                    y: cy + (r - (rows - 1) / 2) * stepY
                });
            }
        }
        return arr;
    }

    // 根据“随机连线”开关为一条无向边生成方向/弯曲规格
    function pickEdgeSpec(randEdge) {
        if (!randEdge) return { type: '-', bidir: false };
        const r = randInt(0, 3);
        return { type: r < 2 ? '-' : '~', bidir: r % 2 === 1 };
    }

    // 规划一份“预设图”：返回 { n, m, positions, pairs }
    function buildPresetPlan(rect) {
        const preset = document.getElementById('randPreset').value;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const radius = Math.max(90, Math.min(rect.width, rect.height) / 2 - 90);

        if (preset === 'random') {
            const mode = document.querySelector('input[name="randMode"]:checked').value;
            let n, m;
            if (mode === 'fixed') {
                n = clampNum(readNum('randNodeCount', 8), 2, 60);
                m = clampNum(readNum('randEdgeCount', 0), 0, n * (n - 1));
            } else {
                let nMin = clampNum(readNum('randNodeMin', 6), 2, 60);
                let nMax = clampNum(readNum('randNodeMax', 12), 2, 60);
                if (nMin > nMax) [nMin, nMax] = [nMax, nMin];
                n = randInt(nMin, nMax);
                const maxM = n * (n - 1);
                let mMin = clampNum(readNum('randEdgeMin', 4), 0, maxM);
                let mMax = clampNum(readNum('randEdgeMax', 15), 0, maxM);
                if (mMin > mMax) mMin = mMax;
                m = randInt(mMin, mMax);
            }
            m = Math.min(m, n * (n - 1));
            return {
                label: '随机图',
                n, m,
                positions: computeGridPositions(n, rect),
                pairs: buildRandomEdges(n, m)
            };
        }

        if (preset === 'grid') {
            const rows = clampNum(readNum('randGridRows', 4), 2, 20);
            const cols = clampNum(readNum('randGridCols', 6), 2, 20);
            const n = rows * cols;
            const pairs = [];
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    const idx = r * cols + c;
                    if (c < cols - 1) pairs.push({ u: idx, v: idx + 1 });       // → 右
                    if (r < rows - 1) pairs.push({ u: idx, v: idx + cols });    // ↓ 下
                }
            }
            return {
                label: '网格图',
                n, m: pairs.length,
                positions: gridPositions(rows, cols, rect),
                pairs
            };
        }

        if (preset === 'ring') {
            const info = RAND_PRESET_INFO.ring;
            const n = clampNum(readNum('randPresetNodeCount', info.defaultN), info.minN, info.maxN);
            const pairs = [];
            for (let i = 0; i < n; i++) pairs.push({ u: i, v: (i + 1) % n });
            return { label: '环形图', n, m: n, positions: circlePositions(n, cx, cy, radius), pairs };
        }

        if (preset === 'star') {
            const info = RAND_PRESET_INFO.star;
            const n = clampNum(readNum('randPresetNodeCount', info.defaultN), info.minN, info.maxN);
            const positions = [{ x: cx, y: cy }].concat(circlePositions(n - 1, cx, cy, radius * 0.9));
            const pairs = [];
            for (let i = 1; i < n; i++) pairs.push({ u: 0, v: i });
            return { label: '星形图', n, m: n - 1, positions, pairs };
        }

        if (preset === 'tree') {
            const info = RAND_PRESET_INFO.tree;
            const n = clampNum(readNum('randPresetNodeCount', info.defaultN), info.minN, info.maxN);
            // 随机标号树：每个节点随机连到一个更早的节点，保证连通无环
            const order = shuffleArray([...Array(n).keys()]);
            const pairs = [];
            for (let i = 1; i < n; i++) {
                pairs.push({ u: order[i], v: order[randInt(0, i - 1)] });
            }
            return { label: '树形图', n, m: n - 1, positions: circlePositions(n, cx, cy, radius), pairs };
        }

        if (preset === 'wheel') {
            const info = RAND_PRESET_INFO.wheel;
            const n = clampNum(readNum('randPresetNodeCount', info.defaultN), info.minN, info.maxN);
            const rim = n - 1;
            const positions = [{ x: cx, y: cy }].concat(circlePositions(rim, cx, cy, radius));
            const pairs = [];
            for (let i = 1; i < n; i++) pairs.push({ u: 0, v: i });          // 辐条
            for (let i = 1; i < n; i++) {                                     // 轮缘环
                pairs.push({ u: i, v: i + 1 > rim ? 1 : i + 1 });
            }
            return { label: '轮辐图', n, m: 2 * (n - 1), positions, pairs };
        }

        return null;
    }

    function generateRandomTopology() {
        refreshPresetTip();
        const rect = svg.getBoundingClientRect();
        const plan = buildPresetPlan(rect);
        if (!plan) return;

        const msg = `将清空当前画布，生成${plan.label}：${plan.n} 个节点、${plan.m} 条连线。\n是否继续？`;
        if (nodes.length > 0 && !confirm(msg)) return;

        const randShape = document.getElementById('randShape').checked;
        const randColor = document.getElementById('randColor').checked;
        const randSize = document.getElementById('randSize').checked;
        const randEdge = document.getElementById('randEdgeType').checked;
        const preset = document.getElementById('randPreset').value;

        resetAll();

        plan.positions.forEach(p => {
            nodes.push({
                id: nextNodeId++,
                x: p.x, y: p.y,
                color: randColor ? NODE_COLORS[randInt(0, NODE_COLORS.length - 1)] : '#409eff',
                shape: randShape ? NODE_SHAPES[randInt(0, NODE_SHAPES.length - 1)] : 'circle',
                size: randSize ? randInt(13, 26) : 18
            });
        });

        plan.pairs.forEach(s => {
            const spec = pickEdgeSpec(randEdge);
            addEdgeById(s.u, s.v, spec.type, spec.bidir);
        });

        // 随机图与树形图用力导向收敛，使布局更均匀；规则图（环/星/轮辐/网格）保留几何结构
        if (preset === 'random' || preset === 'tree') applyForceLayout(320);
        updatePathSelects();
        optimizeArcs();   // 开启“自动优化弧线”时在此优化，否则为无操作
        render();
    }


    init();

