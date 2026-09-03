// js/core.js — 核心状态、图编辑、SVG 渲染、右键菜单、导入导出、全局重置
// 依赖：无（最先加载）。供 analysis.js / layout.js 调用。

    const svg = document.getElementById('graphSvg');
    const viewportGroup = document.getElementById('viewportGroup');
    const edgesGroup = document.getElementById('edgesGroup');
    const nodesGroup = document.getElementById('nodesGroup');
    const controlPointsGroup = document.getElementById('controlPointsGroup');
    const tempDrawGroup = document.getElementById('tempDrawGroup');
    const contextMenu = document.getElementById('contextMenu');
    const newNodePanel = document.getElementById('newNodePanel');

    let nodes = [];
    let edges = [];
    let nextNodeId = 0;
    let nextEdgeId = 0;

    let currentTool = 'select';
    let dragging = null;
    let drawingTemp = null;
    let newNodeCallback = null;

    // 画布视图：世界坐标 = (屏幕坐标 - 位移) / 缩放
    let viewTx = 0;
    let viewTy = 0;
    let viewScale = 1;

    let cycles = [];
    let paths = [];
    let activeHighlightType = null;
    let activeHighlightIndex = -1;
    let highlightTimer = null;
    let autoOptimizeArcs = false;   // 画布开关：开启后自动优化弧线形状

    const ARROW_OFFSET = 4;
    const ARC_SAMPLE_STEPS = 24;
    const HIGHLIGHT_DURATION = 2000;

    function getRegularPolygonPoints(cx, cy, radius, sides, rotation = -Math.PI/2) {
        const points = [];
        for (let i = 0; i < sides; i++) {
            const angle = rotation + i * 2 * Math.PI / sides;
            points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
        }
        return points.join(' ');
    }

    // 计算从节点中心沿 angle 方向到形状边缘的实际距离（与渲染的几何一致）
    function getShapeBoundaryRadius(shape, size, angle) {
        if (shape === 'circle') return size;
        if (shape === 'square') {
            // 圆角方形，近似按轴对齐方形处理
            const c = Math.abs(Math.cos(angle));
            const s = Math.abs(Math.sin(angle));
            return size / Math.max(c, s, 1e-6);
        }
        let sides;
        if (shape === 'triangle') sides = 3;
        else if (shape === 'pentagon') sides = 5;
        else if (shape === 'hexagon') sides = 6;
        else return size;

        // 正多边形：外接圆半径 = size，边心距 = size*cos(pi/n)
        // 多边形每条边外法线角（首顶点在正上方，与 getRegularPolygonPoints 一致）
        const apothem = size * Math.cos(Math.PI / sides);
        const step = 2 * Math.PI / sides;
        let best = -Math.PI / 2 + step / 2;
        let bestDiff = Infinity;
        for (let i = 0; i < sides; i++) {
            const beta = -Math.PI / 2 + (2 * i + 1) * step / 2;
            let diff = angle - beta;
            while (diff > Math.PI) diff -= 2 * Math.PI;
            while (diff < -Math.PI) diff += 2 * Math.PI;
            const ad = Math.abs(diff);
            if (ad < bestDiff) { bestDiff = ad; best = beta; }
        }
        let delta = angle - best;
        while (delta > Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        return apothem / Math.cos(delta);
    }

    // 精确计算边两端点：分别按两端节点自身形状/大小取边界半径，
    // 避免大小、形状不同的节点导致箭头悬空或穿透节点
    function computeBaseEdgeEndpoints(u, v) {
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const aUV = Math.atan2(dy, dx);
        const rU = getShapeBoundaryRadius(u.shape, u.size, aUV) + ARROW_OFFSET;
        const rV = getShapeBoundaryRadius(v.shape, v.size, aUV + Math.PI) + ARROW_OFFSET;
        return {
            x1: u.x + dx * rU / len,
            y1: u.y + dy * rU / len,
            x2: v.x - dx * rV / len,
            y2: v.y - dy * rV / len
        };
    }

    // ===== 画布视图（平移 / 缩放）=====
    function applyViewTransform() {
        viewportGroup.setAttribute('transform',
            `translate(${viewTx}, ${viewTy}) scale(${viewScale})`);
    }

    function resetView() {
        viewTx = 0;
        viewTy = 0;
        viewScale = 1;
        applyViewTransform();
    }

    // 当前可视区域对应的世界坐标矩形（供生成/布局内容时适配任意视图）
    function getViewWorldRect() {
        const r = svg.getBoundingClientRect();
        return {
            x: -viewTx / viewScale,
            y: -viewTy / viewScale,
            w: r.width / viewScale,
            h: r.height / viewScale
        };
    }

    // 以屏幕坐标 (sx, sy) 为中心缩放，保持该点下的内容不动
    function zoomViewAt(sx, sy, factor) {
        const MIN_SCALE = 0.15;
        const MAX_SCALE = 8;
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewScale * factor));
        const f = next / viewScale;
        if (f === 1) return;
        viewScale = next;
        viewTx = sx - (sx - viewTx) * f;
        viewTy = sy - (sy - viewTy) * f;
        applyViewTransform();
    }

    function onSvgWheel(e) {
        e.preventDefault();
        const rect = svg.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomViewAt(sx, sy, factor);
    }

    function init() {
        addNode(200, 150);
        addNode(400, 150);
        addNode(500, 300);
        addNode(300, 400);
        addNode(150, 300);
        
        addEdgeById(0, 1, '-', false);
        addEdgeById(0, 1, '~', false);
        addEdgeById(1, 2, '-', false);
        addEdgeById(2, 3, '~', true);
        addEdgeById(3, 4, '-', false);
        addEdgeById(4, 0, '-', false);

        updatePathSelects();
        render();
        bindEvents();
        setupRandInputListeners();
    }

    function switchTool(tool) {
        currentTool = tool;
        drawingTemp = null;
        clearTempDraw();
        hideAllMenus();
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });
        render();
    }

    function addNode(x, y, color = '#409eff', shape = 'circle', size = 18) {
        if (x === undefined) {
            // 默认放在当前可视区域中心附近
            const vr = getViewWorldRect();
            x = vr.x + vr.w / 2 + (Math.random() - 0.5) * (100 / viewScale);
            y = vr.y + vr.h / 2 + (Math.random() - 0.5) * (100 / viewScale);
        }
        const node = { id: nextNodeId++, x, y, color, shape, size };
        nodes.push(node);
        updatePathSelects();
        render();
        return node;
    }

    function getNodeById(id) {
        return nodes.find(n => n.id === id);
    }

    function deleteNode(id) {
        edges = edges.filter(e => e.u !== id && e.v !== id);
        nodes = nodes.filter(n => n.id !== id);
        updatePathSelects();
        render();
        hideAllMenus();
    }

    function hideAllMenus() {
        contextMenu.style.display = 'none';
        newNodePanel.style.display = 'none';
    }

    function openNewNodePanel(x, y, callback) {
        document.getElementById('newNodeColor').value = '#409eff';
        document.getElementById('newNodeShape').value = 'circle';
        document.getElementById('newEdgeType').value = '-';
        newNodeCallback = callback;

        newNodePanel.style.left = x + 'px';
        newNodePanel.style.top = y + 'px';
        newNodePanel.style.display = 'block';

        const rect = newNodePanel.getBoundingClientRect();
        if (rect.right > window.innerWidth) {
            newNodePanel.style.left = (x - rect.width) + 'px';
        }
        if (rect.bottom > window.innerHeight) {
            newNodePanel.style.top = (y - rect.height) + 'px';
        }
    }

    function closeNewNodePanel(confirm) {
        newNodePanel.style.display = 'none';
        if (confirm && newNodeCallback) {
            const config = {
                color: document.getElementById('newNodeColor').value,
                shape: document.getElementById('newNodeShape').value,
                edgeType: document.getElementById('newEdgeType').value
            };
            newNodeCallback(config);
        }
        newNodeCallback = null;
    }

    function changeNodeColor(id) {
        const node = getNodeById(id);
        const input = document.createElement('input');
        input.type = 'color';
        input.value = node.color;
        input.onchange = () => {
            node.color = input.value;
            render();
        };
        input.click();
        hideAllMenus();
    }

    function changeNodeSize(id) {
        const node = getNodeById(id);
        const size = prompt('设置节点大小（10-50）', node.size);
        if (size !== null) {
            const val = parseFloat(size);
            if (!isNaN(val)) {
                node.size = Math.max(10, Math.min(50, val));
                render();
            }
        }
        hideAllMenus();
    }

    function changeNodeShape(id, shape) {
        const node = getNodeById(id);
        node.shape = shape;
        render();
        hideAllMenus();
    }

    function updatePathSelects() {
        ['pathStart', 'pathEnd'].forEach(id => {
            const sel = document.getElementById(id);
            sel.innerHTML = '';
            nodes.forEach(n => sel.innerHTML += `<option value="${n.id}">${n.id}</option>`);
        });
        if (nodes.length >= 2) document.getElementById('pathEnd').value = nodes[1].id;
    }

    function addEdgeById(u, v, type, bidirectional) {
        if (u === v) return;
        const edge = {
            id: nextEdgeId++,
            u, v, type, bidirectional,
            color: type === '-' ? '#606266' : '#409eff'
        };
        if (type === '~') {
            edge.controlPoint = computeDefaultControlPoint(u, v);
            edge.manualCp = false;  // 该弧线控制点尚未被手动拖拽过
        }
        edges.push(edge);
        return edge;
    }

    function computeDefaultControlPoint(uId, vId) {
        const u = getNodeById(uId);
        const v = getNodeById(vId);
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const offset = len * 0.25;
        const nx = -dy / len * offset;
        const ny = dx / len * offset;
        return { x: (u.x + v.x) / 2 + nx, y: (u.y + v.y) / 2 + ny };
    }

    // ===== 弧线自动优化 =====
    // 在“自动优化弧线”开启时调用：让每条未经手动调整的弧线自动选择更合适的
    // 弯曲方向与幅度——避开途经的节点、平行弧线交错分布在两侧，观感更整齐。
    function sampleBezierXY(x1, y1, cx, cy, x2, y2, steps) {
        const pts = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const mt = 1 - t;
            pts.push({
                x: mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
                y: mt * mt * y1 + 2 * mt * t * cy + t * t * y2
            });
        }
        return pts;
    }

    // 返回弧线穿过其它节点的“穿透程度”，0 表示完全避让干净
    function arcCollisionScore(u, v, cp) {
        const pts = sampleBezierXY(u.x, u.y, cp.x, cp.y, v.x, v.y, 16);
        let worst = 0;
        for (const n of nodes) {
            if (n.id === u.id || n.id === v.id) continue;
            const need = n.size + 8;
            for (const p of pts) {
                const d = Math.hypot(p.x - n.x, p.y - n.y);
                if (d < need) {
                    const pen = need - d;
                    if (pen > worst) worst = pen;
                }
            }
        }
        return worst;
    }

    // 为单条弧线挑选一个较好的控制点（返回 { cp, score, h }）
    function pickArcControl(u, v, forcedSide) {
        const dx = v.x - u.x;
        const dy = v.y - u.y;
        const len = Math.hypot(dx, dy) || 1;
        // 左法线（与 computeDefaultControlPoint 一致：默认弧线向左侧弯曲）
        const nx = -dy / len;
        const ny = dx / len;
        const mx = (u.x + v.x) / 2;
        const my = (u.y + v.y) / 2;
        const minR = Math.max(u.size, v.size);
        // 基准弯曲高度：过短/节点过大时保证仍有可见弯曲，同时避免过度外甩
        const hBase = Math.min(Math.max(len * 0.28, minR + 12), len * 0.8);
        const sides = forcedSide ? [forcedSide] : [1, -1];
        const mults = [1, 1.9, 3.2];
        let best = null;
        for (const side of sides) {
            for (const mult of mults) {
                const h = hBase * mult;
                const cp = { x: mx + nx * h * side, y: my + ny * h * side };
                const score = arcCollisionScore(u, v, cp);
                if (!best || score < best.score || (score === best.score && h < best.h)) {
                    best = { cp, score, h };
                }
            }
        }
        return best;
    }

    function optimizeArcs() {
        if (!autoOptimizeArcs) return;
        if (nodes.length < 2) return;

        // 统计同一“有向节点对”上的平行弧线，避免同向多条弧线完全重叠
        const dirCount = {};
        edges.forEach(e => {
            if (e.type === '~' && e.controlPoint) {
                const k = e.u + '>' + e.v;
                dirCount[k] = (dirCount[k] || 0) + 1;
            }
        });
        const laneUsed = {};

        edges.forEach(edge => {
            if (edge.type !== '~' || !edge.controlPoint || edge.manualCp) return;
            const u = getNodeById(edge.u);
            const v = getNodeById(edge.v);
            if (!u || !v) return;

            const k = edge.u + '>' + edge.v;
            const lane = laneUsed[k] || 0;
            laneUsed[k] = lane + 1;

            // 若同向存在多条平行弧线，按次序左右交错，防止彼此重叠
            const forcedSide = dirCount[k] > 1 ? (lane % 2 === 0 ? 1 : -1) : null;
            const res = pickArcControl(u, v, forcedSide);
            if (res) {
                edge.controlPoint = res.cp;
            }
        });
    }

    // 仅在开关开启时触发一次“优化 + 重绘”
    function maybeOptimizeArcs() {
        if (!autoOptimizeArcs) return;
        optimizeArcs();
        render();
    }

    // 画布角落开关
    function onArcAutoChange() {
        const cb = document.getElementById('arcAutoCb');
        autoOptimizeArcs = !!cb.checked;
        if (autoOptimizeArcs) {
            maybeOptimizeArcs();
        }
    }

    function deleteEdge(id) {
        edges = edges.filter(e => e.id !== id);
        render();
        hideAllMenus();
    }

    function toggleEdgeShape(id) {
        const edge = edges.find(e => e.id === id);
        if (edge.type === '-') {
            edge.type = '~';
            edge.controlPoint = computeDefaultControlPoint(edge.u, edge.v);
            edge.manualCp = false;
            edge.color = '#409eff';
        } else {
            edge.type = '-';
            delete edge.controlPoint;
            delete edge.manualCp;
            edge.color = '#606266';
        }
        render();
        if (edge.type === '~') maybeOptimizeArcs();
        hideAllMenus();
    }

    function toggleEdgeDirection(id) {
        const edge = edges.find(e => e.id === id);
        edge.bidirectional = !edge.bidirectional;
        render();
        hideAllMenus();
    }

    function changeEdgeColor(id) {
        const edge = edges.find(e => e.id === id);
        const input = document.createElement('input');
        input.type = 'color';
        input.value = edge.color;
        input.onchange = () => {
            edge.color = input.value;
            render();
        };
        input.click();
        hideAllMenus();
    }

    function render() {
        renderEdges();
        renderNodes();
        renderControlPoints();
    }

    function renderNodes() {
        nodesGroup.innerHTML = '';
        nodes.forEach(node => {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            
            let shapeEl;
            const s = node.size;

            if (node.shape === 'circle') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                shapeEl.setAttribute('cx', node.x);
                shapeEl.setAttribute('cy', node.y);
                shapeEl.setAttribute('r', s);
            } else if (node.shape === 'square') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                shapeEl.setAttribute('x', node.x - s);
                shapeEl.setAttribute('y', node.y - s);
                shapeEl.setAttribute('width', s * 2);
                shapeEl.setAttribute('height', s * 2);
                shapeEl.setAttribute('rx', 3);
            } else if (node.shape === 'triangle') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                shapeEl.setAttribute('points', getRegularPolygonPoints(node.x, node.y, s, 3));
            } else if (node.shape === 'pentagon') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                shapeEl.setAttribute('points', getRegularPolygonPoints(node.x, node.y, s, 5));
            } else if (node.shape === 'hexagon') {
                shapeEl = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
                shapeEl.setAttribute('points', getRegularPolygonPoints(node.x, node.y, s, 6));
            }

            shapeEl.classList.add('node-shape');
            shapeEl.style.fill = node.color;
            shapeEl.dataset.nodeId = node.id;

            const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            text.setAttribute('x', node.x);
            text.setAttribute('y', node.y);
            text.classList.add('node-text');
            text.textContent = node.id;

            g.appendChild(shapeEl);
            g.appendChild(text);
            nodesGroup.appendChild(g);
        });
    }

    function renderEdges() {
        edgesGroup.innerHTML = '';

        // 第一步：统计每个节点上的所有箭头落点（含双向边两端），记录入射角
        const incomingMap = {}; // nodeId -> [{edge, direction, hubId, angle}]
        edges.forEach(edge => {
            const u = getNodeById(edge.u);
            const v = getNodeById(edge.v);
            if (!u || !v) return;

            // u -> v 方向（箭头落在 v 上）
            const angleUV = Math.atan2(v.y - u.y, v.x - u.x);
            if (!incomingMap[v.id]) incomingMap[v.id] = [];
            incomingMap[v.id].push({ edge, direction: 'forward', hubId: v.id, angle: angleUV });

            // 双向边 v -> u 方向（箭头落在 u 上）
            if (edge.bidirectional) {
                const angleVU = Math.atan2(u.y - v.y, u.x - v.x);
                if (!incomingMap[u.id]) incomingMap[u.id] = [];
                incomingMap[u.id].push({ edge, direction: 'backward', hubId: u.id, angle: angleVU });
            }
        });

        // 第二步：把每个节点的箭头沿“节点边缘”扇形排布。
        // 与原切线平移不同，落点始终保持在节点边界环上，因此不会偏移出节点范围；
        // 相邻箭头按约 12px 弧距错开并限制最大偏转 60°，避免箭头互相重叠。
        const landingPoint = {}; // "edgeId_direction" -> {x, y}
        const FAN_STEP = 12;     // 相邻箭头在节点边缘的最小弧距（像素）
        const FAN_MAX_DELTA = Math.PI / 3; // 最大偏转角度 ±60°
        Object.keys(incomingMap).forEach(nodeId => {
            const hub = getNodeById(+nodeId);
            if (!hub) return;
            const list = incomingMap[nodeId];
            list.sort((a, b) => a.angle - b.angle);
            const n = list.length;
            list.forEach((item, i) => {
                // 从节点中心指向“来箭方向”的落点基准角（入射角反向）
                const aIn = item.angle + Math.PI;
                const rb = getShapeBoundaryRadius(hub.shape, hub.size, aIn);
                // 弧长 -> 圆心角：delta = 弧长 / 边界半径
                let delta = 0;
                if (n > 1) {
                    const arc = (i - (n - 1) / 2) * FAN_STEP;
                    delta = arc / Math.max(rb, 1);
                    delta = Math.max(-FAN_MAX_DELTA, Math.min(FAN_MAX_DELTA, delta));
                }
                const ang = aIn + delta;
                // 落点半径需按最终角度再求一次边界，保证箭头始终紧贴实际边缘
                const rbAng = getShapeBoundaryRadius(hub.shape, hub.size, ang);
                landingPoint[`${item.edge.id}_${item.direction}`] = {
                    x: hub.x + Math.cos(ang) * (rbAng + ARROW_OFFSET),
                    y: hub.y + Math.sin(ang) * (rbAng + ARROW_OFFSET)
                };
            });
        });

        // 第三步：渲染每条边，应用按形状精确计算的端点与扇形落点
        edges.forEach(edge => {
            const u = getNodeById(edge.u);
            const v = getNodeById(edge.v);
            if (!u || !v) return;

            const base = computeBaseEdgeEndpoints(u, v);
            let x1 = base.x1, y1 = base.y1;
            let x2 = base.x2, y2 = base.y2;

            const fwd = landingPoint[`${edge.id}_forward`];
            if (fwd) { x2 = fwd.x; y2 = fwd.y; }
            if (edge.bidirectional) {
                const bwd = landingPoint[`${edge.id}_backward`];
                if (bwd) { x1 = bwd.x; y1 = bwd.y; }
            }

            let pathEl;
            if (edge.type === '~' && edge.controlPoint) {
                pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                pathEl.setAttribute('d', `M ${x1} ${y1} Q ${edge.controlPoint.x} ${edge.controlPoint.y} ${x2} ${y2}`);
                pathEl.classList.add('edge-arc');
            } else {
                pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                pathEl.setAttribute('x1', x1);
                pathEl.setAttribute('y1', y1);
                pathEl.setAttribute('x2', x2);
                pathEl.setAttribute('y2', y2);
                pathEl.classList.add('edge-line');
            }

            pathEl.style.stroke = edge.color;
            pathEl.dataset.edgeId = edge.id;

            if (edge.bidirectional) {
                pathEl.setAttribute('marker-start', 'url(#arrow-start-default)');
                pathEl.setAttribute('marker-end', 'url(#arrow-default)');
            } else {
                pathEl.setAttribute('marker-end', 'url(#arrow-default)');
            }

            edgesGroup.appendChild(pathEl);
        });
    }

    function renderControlPoints() {
        controlPointsGroup.innerHTML = '';
        if (currentTool !== 'select') return;

        edges.forEach(edge => {
            if (edge.type !== '~' || !edge.controlPoint) return;
            const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            circle.setAttribute('cx', edge.controlPoint.x);
            circle.setAttribute('cy', edge.controlPoint.y);
            circle.setAttribute('r', 5);
            circle.classList.add('control-point');
            circle.dataset.edgeId = edge.id;
            controlPointsGroup.appendChild(circle);
        });
    }

    function clearTempDraw() {
        tempDrawGroup.innerHTML = '';
    }

    function updateTempDraw(x1, y1, x2, y2) {
        tempDrawGroup.innerHTML = '';
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', x1);
        line.setAttribute('y1', y1);
        line.setAttribute('x2', x2);
        line.setAttribute('y2', y2);
        line.classList.add('temp-draw-line');
        tempDrawGroup.appendChild(line);
    }

    function bindEvents() {
        svg.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        svg.addEventListener('contextmenu', onContextMenu);
        svg.addEventListener('wheel', onSvgWheel, { passive: false });

        document.addEventListener('mousedown', (e) => {
            if (!e.target.closest('.context-menu') && 
                !e.target.closest('.new-node-panel') &&
                !e.target.closest('#graphSvg')) {
                hideAllMenus();
            }
        });
    }

    function getSvgPoint(e) {
        const rect = svg.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        // 屏幕坐标 → 世界坐标（考虑平移与缩放）
        return {
            x: (sx - viewTx) / viewScale,
            y: (sy - viewTy) / viewScale
        };
    }

    function getNodeAtPoint(x, y) {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            const dx = x - node.x;
            const dy = y - node.y;
            if (Math.sqrt(dx*dx + dy*dy) <= node.size) {
                return node;
            }
        }
        return null;
    }

    function onMouseDown(e) {
        if (e.button !== 0) return;
        hideAllMenus();

        const point = getSvgPoint(e);
        const target = e.target;

        if (target.classList.contains('node-shape')) {
            const nodeId = parseInt(target.dataset.nodeId);
            const node = getNodeById(nodeId);

            if (currentTool === 'select') {
                // 记录关联弧线控制点与节点的相对偏移，拖动时保持自定义形状
                const arcOffsets = [];
                edges.forEach(edge => {
                    if (edge.type === '~' && edge.controlPoint) {
                        if (edge.u === nodeId || edge.v === nodeId) {
                            arcOffsets.push({
                                edge: edge,
                                dx: edge.controlPoint.x - node.x,
                                dy: edge.controlPoint.y - node.y
                            });
                        }
                    }
                });

                dragging = {
                    type: 'node',
                    target: node,
                    offsetX: point.x - node.x,
                    offsetY: point.y - node.y,
                    arcOffsets: arcOffsets
                };
            } else if (currentTool === 'draw') {
                drawingTemp = { startNodeId: nodeId, startX: node.x, startY: node.y };
                updateTempDraw(node.x, node.y, point.x, point.y);
            }
            return;
        }

        if (target.classList.contains('control-point')) {
            const edgeId = parseInt(target.dataset.edgeId);
            const edge = edges.find(e => e.id === edgeId);
            dragging = {
                type: 'control',
                target: edge,
                offsetX: point.x - edge.controlPoint.x,
                offsetY: point.y - edge.controlPoint.y
            };
            return;
        }

        if (currentTool === 'select') {
            clearHighlight();
        }

        // 空白区域：左键按下开始拖动画布
        dragging = {
            type: 'pan',
            startClientX: e.clientX,
            startClientY: e.clientY,
            startTx: viewTx,
            startTy: viewTy
        };
        svg.classList.add('panning');
    }

    function onMouseMove(e) {
        const point = getSvgPoint(e);

        if (dragging) {
            if (dragging.type === 'pan') {
                viewTx = dragging.startTx + (e.clientX - dragging.startClientX);
                viewTy = dragging.startTy + (e.clientY - dragging.startClientY);
                applyViewTransform();
                return;
            }

            if (dragging.type === 'node') {
                dragging.target.x = point.x - dragging.offsetX;
                dragging.target.y = point.y - dragging.offsetY;
                
                // 按偏移量同步更新关联弧线控制点，保持自定义弯曲形状
                if (dragging.arcOffsets) {
                    dragging.arcOffsets.forEach(item => {
                        item.edge.controlPoint.x = dragging.target.x + item.dx;
                        item.edge.controlPoint.y = dragging.target.y + item.dy;
                    });
                }
            } else if (dragging.type === 'control') {
                dragging.target.controlPoint.x = point.x - dragging.offsetX;
                dragging.target.controlPoint.y = point.y - dragging.offsetY;
            }
            render();
            return;
        }

        if (currentTool === 'draw' && drawingTemp) {
            updateTempDraw(drawingTemp.startX, drawingTemp.startY, point.x, point.y);
        }
    }

    function onMouseUp(e) {
        const point = getSvgPoint(e);

        if (dragging) {
            const wasDragging = dragging;
            dragging = null;

            if (wasDragging.type === 'pan') {
                svg.classList.remove('panning');
                return;
            }

            if (wasDragging.type === 'control' && wasDragging.target) {
                // 用户手动拖过该弧线控制点 → 之后不再被自动优化覆盖
                wasDragging.target.manualCp = true;
            } else if (wasDragging.type === 'node' && autoOptimizeArcs) {
                // 开启自动优化时，节点移动结束后重排其关联的弧线形状
                optimizeArcs();
                render();
            }

            if (activeHighlightIndex >= 0) {
                if (activeHighlightType === 'cycle') highlightCycle(activeHighlightIndex);
                else if (activeHighlightType === 'path') highlightPath(activeHighlightIndex);
            }
            return;
        }

        if (currentTool === 'draw' && drawingTemp) {
            const targetNode = getNodeAtPoint(point.x, point.y);
            
            if (targetNode && targetNode.id !== drawingTemp.startNodeId) {
                const startId = drawingTemp.startNodeId;
                const endId = targetNode.id;
                setTimeout(() => {
                    showEdgeTypeMenu(e.clientX, e.clientY, startId, endId);
                }, 10);
            } else if (!targetNode) {
                const startId = drawingTemp.startNodeId;
                const endX = point.x;
                const endY = point.y;
                setTimeout(() => {
                    openNewNodePanel(e.clientX, e.clientY, (config) => {
                        const newNode = addNode(endX, endY, config.color, config.shape);
                        let type, bidir;
                        if (config.edgeType === '-') { type = '-'; bidir = false; }
                        else if (config.edgeType === '~') { type = '~'; bidir = false; }
                        else if (config.edgeType === '=') { type = '-'; bidir = true; }
                        else { type = '~'; bidir = true; }
                        addEdgeById(startId, newNode.id, type, bidir);
                        render();
                        maybeOptimizeArcs();
                    });
                }, 10);
            }

            drawingTemp = null;
            clearTempDraw();
        }
    }

    function showEdgeTypeMenu(x, y, startId, endId) {
        const items = [
            { subtitle: '选择连线类型' },
            { label: '单向直线', action: () => { addEdgeById(startId, endId, '-', false); render(); maybeOptimizeArcs(); hideAllMenus(); } },
            { label: '单向弧线', action: () => { addEdgeById(startId, endId, '~', false); render(); maybeOptimizeArcs(); hideAllMenus(); } },
            { label: '双向直线', action: () => { addEdgeById(startId, endId, '-', true); render(); maybeOptimizeArcs(); hideAllMenus(); } },
            { label: '双向弧线', action: () => { addEdgeById(startId, endId, '~', true); render(); maybeOptimizeArcs(); hideAllMenus(); } }
        ];
        showContextMenu(x, y, items);
    }

    function onContextMenu(e) {
        e.preventDefault();
        const target = e.target;
        let menuItems = [];
        const point = getSvgPoint(e);

        if (target.classList.contains('node-shape')) {
            const id = parseInt(target.dataset.nodeId);
            const node = getNodeById(id);
            menuItems = [
                { label: '修改颜色', action: () => changeNodeColor(id) },
                { label: '修改大小', action: () => changeNodeSize(id) },
                { subtitle: '节点形状' },
                { label: '● 圆形', action: () => changeNodeShape(id, 'circle'), active: node.shape === 'circle' },
                { label: '■ 方形', action: () => changeNodeShape(id, 'square'), active: node.shape === 'square' },
                { label: '▲ 三角形', action: () => changeNodeShape(id, 'triangle'), active: node.shape === 'triangle' },
                { label: '⬠ 五边形', action: () => changeNodeShape(id, 'pentagon'), active: node.shape === 'pentagon' },
                { label: '⬡ 六边形', action: () => changeNodeShape(id, 'hexagon'), active: node.shape === 'hexagon' },
                { label: '删除节点', danger: true, action: () => deleteNode(id) }
            ];
        } else if (target.classList.contains('edge-line') || target.classList.contains('edge-arc')) {
            const id = parseInt(target.dataset.edgeId);
            const edge = edges.find(e => e.id === id);
            menuItems = [
                { label: edge.type === '-' ? '转为弧线' : '转为直线', action: () => toggleEdgeShape(id) },
                { label: edge.bidirectional ? '改为单向' : '改为双向', action: () => toggleEdgeDirection(id) },
                { label: '修改颜色', action: () => changeEdgeColor(id) },
                { label: '删除边', danger: true, action: () => deleteEdge(id) }
            ];
        } else {
            menuItems = [
                { 
                    label: '在此处添加节点', 
                    action: () => {
                        addNode(point.x, point.y);
                        hideAllMenus();
                    }
                }
            ];
        }

        showContextMenu(e.clientX, e.clientY, menuItems);
    }

    function showContextMenu(x, y, items) {
        contextMenu.innerHTML = '';
        items.forEach(item => {
            if (item.subtitle) {
                const div = document.createElement('div');
                div.className = 'menu-subtitle';
                div.textContent = item.subtitle;
                contextMenu.appendChild(div);
                return;
            }
            const div = document.createElement('div');
            div.className = 'menu-item' + (item.danger ? ' danger' : '');
            div.textContent = item.label;
            if (item.active) div.style.color = '#409eff';
            div.onclick = item.action;
            contextMenu.appendChild(div);
        });

        contextMenu.style.left = x + 'px';
        contextMenu.style.top = y + 'px';
        contextMenu.style.display = 'block';

        const rect = contextMenu.getBoundingClientRect();
        if (rect.right > window.innerWidth) contextMenu.style.left = (x - rect.width) + 'px';
        if (rect.bottom > window.innerHeight) contextMenu.style.top = (y - rect.height) + 'px';
    }

    function exportToText() {
        const parts = [];
        edges.forEach(e => {
            let sep;
            if (e.bidirectional) {
                sep = e.type === '-' ? '=' : '~~';
            } else {
                sep = e.type;
            }
            parts.push(`${e.u}${sep}${e.v}`);
        });
        document.getElementById('importText').value = parts.join('，');
    }

    function importFromText() {
        const text = document.getElementById('importText').value;
        if (!text.trim()) return;

        nodes = []; edges = [];
        nextNodeId = 0; nextEdgeId = 0;

        const list = text.split(/[，,\n\r]/).map(s => s.trim()).filter(s => s !== '');
        const pattern = /^(\d+)(-|~|=|~~)(\d+)$/;
        const nodeSet = new Set();
        list.forEach(s => {
            const m = s.match(pattern);
            if (m) { nodeSet.add(+m[1]); nodeSet.add(+m[3]); }
        });

        const nodeArr = Array.from(nodeSet).sort((a,b) => a-b);
        // 布局在当前可视区域中心，适配已缩放/平移的视图
        const vr = getViewWorldRect();
        const cx = vr.x + vr.w / 2, cy = vr.y + vr.h / 2;
        const radius = Math.max(0, Math.min(vr.w, vr.h) * 0.35);

        nodeArr.forEach((id, i) => {
            const angle = -Math.PI/2 + i * 2 * Math.PI / nodeArr.length;
            nodes.push({
                id, x: cx + radius*Math.cos(angle), y: cy + radius*Math.sin(angle),
                color: '#409eff', shape: 'circle', size: 18
            });
            if (id >= nextNodeId) nextNodeId = id + 1;
        });

        list.forEach(s => {
            const m = s.match(pattern);
            if (m) {
                const u = +m[1], sep = m[2], v = +m[3];
                let type, bidir;
                if (sep === '-') { type='-'; bidir=false; }
                else if (sep === '~') { type='~'; bidir=false; }
                else if (sep === '=') { type='-'; bidir=true; }
                else { type='~'; bidir=true; }
                addEdgeById(u, v, type, bidir);
            }
        });

        updatePathSelects();
        render();
        maybeOptimizeArcs();
    }



    function resetAll() {
        nodes = []; edges = []; cycles = []; paths = [];
        nextNodeId = 0; nextEdgeId = 0;
        activeHighlightType = null;
        activeHighlightIndex = -1;
        clearTimeout(highlightTimer);
        highlightTimer = null;
        ['cycleCount','pathCount','shortestCount','intersectionCount'].forEach(id => document.getElementById(id).textContent = '0');
        document.getElementById('shortestLen').textContent = '-';
        ['cycleList','pathList','shortestList'].forEach(id => document.getElementById(id).innerHTML = '');
        document.getElementById('importText').value = '';
        updatePathSelects();
        render();
    }

    function clearAll() {
        if (!confirm('确定清空所有内容吗？')) return;
        resetAll();
    }
