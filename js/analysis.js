// js/analysis.js — 拓扑分析：环路、两点路径、几何交点统计
// 依赖：core.js

    function buildCalcEdges() {
        const res = [];
        edges.forEach(e => {
            res.push({ u: e.u, v: e.v, type: e.type, sourceId: e.id, direction: 'forward' });
            if (e.bidirectional) {
                res.push({ u: e.v, v: e.u, type: e.type, sourceId: e.id, direction: 'backward' });
            }
        });
        return res;
    }

    function getCycleString(seq) {
        let str = String(seq[0].u);
        seq.forEach(e => str += e.type + e.v);
        return str;
    }

    function getCanonical(seq) {
        let best = null;
        for (let r = 0; r < seq.length; r++) {
            const rot = [];
            for (let i = 0; i < seq.length; i++) rot.push(seq[(r+i) % seq.length]);
            const s = getCycleString(rot);
            if (best === null || s < best) best = s;
        }
        return best;
    }

    function calculateCycles() {
        clearHighlight();
        const calcEdges = buildCalcEdges();
        if (calcEdges.length === 0) { alert('请先添加边'); return; }

        const adj = {};
        const allNodes = new Set();
        calcEdges.forEach(e => {
            if (!adj[e.u]) adj[e.u] = [];
            adj[e.u].push(e);
            allNodes.add(e.u); allNodes.add(e.v);
        });

        const cycleMap = new Map();
        function search(start, current, pathNodes, pathEdges) {
            (adj[current] || []).forEach(edge => {
                if (edge.v === start) {
                    if (pathEdges.length >= 1) {
                        const fullSeq = [...pathEdges, edge];
                        const canon = getCanonical(fullSeq);
                        if (!cycleMap.has(canon)) {
                            cycleMap.set(canon, fullSeq);
                        }
                    }
                } else if (!pathNodes.has(edge.v)) {
                    const newNodes = new Set(pathNodes);
                    newNodes.add(edge.v);
                    search(start, edge.v, newNodes, [...pathEdges, edge]);
                }
            });
        }

        allNodes.forEach(n => search(n, n, new Set([n]), []));
        
        const sortedKeys = Array.from(cycleMap.keys()).sort();
        cycles = sortedKeys.map(key => ({ str: key, edges: cycleMap.get(key) }));

        document.getElementById('cycleCount').textContent = cycles.length;
        renderCycleList();
    }

    function renderCycleList() {
        const list = document.getElementById('cycleList');
        list.innerHTML = '';
        cycles.forEach((c, i) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            item.textContent = `${i+1}. ${c.str}`;
            item.onclick = () => highlightCycle(i);
            list.appendChild(item);
        });
    }

    function highlightCycle(index) {
        clearHighlight();
        activeHighlightType = 'cycle';
        activeHighlightIndex = index;

        const items = document.querySelectorAll('#cycleList .result-item');
        items[index].style.color = '#e74c3c';
        items[index].style.background = '#fef0f0';

        const edgeSeq = cycles[index].edges;
        const nodeSet = new Set();

        edgeSeq.forEach(seg => {
            const el = edgesGroup.querySelector(`[data-edge-id="${seg.sourceId}"]`);
            if (el) {
                el.classList.add('highlight-edge');
                const edge = edges.find(e => e.id === seg.sourceId);
                if (edge.bidirectional) {
                    el.setAttribute('marker-start', 'url(#arrow-start-red)');
                    el.setAttribute('marker-end', 'url(#arrow-red)');
                } else {
                    el.setAttribute('marker-end', 'url(#arrow-red)');
                }
            }
            nodeSet.add(seg.u);
            nodeSet.add(seg.v);
        });

        nodeSet.forEach(id => {
            const el = nodesGroup.querySelector(`.node-shape[data-node-id="${id}"]`);
            if (el) el.classList.add('highlight-node');
        });

        clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => {
            clearHighlight();
        }, HIGHLIGHT_DURATION);
    }

    function calculatePaths() {
        clearHighlight();
        const start = +document.getElementById('pathStart').value;
        const end = +document.getElementById('pathEnd').value;
        if (start === end) { alert('起点和终点不能相同'); return; }

        const calcEdges = buildCalcEdges();
        const adj = {};
        calcEdges.forEach(e => {
            if (!adj[e.u]) adj[e.u] = [];
            adj[e.u].push(e);
        });

        const pathList = [];
        function dfs(current, pathNodes, pathEdges) {
            if (current === end) {
                let str = String(pathEdges[0].u);
                pathEdges.forEach(e => str += e.type + e.v);
                pathList.push({ str, edges: [...pathEdges] });
                return;
            }
            (adj[current] || []).forEach(edge => {
                if (!pathNodes.has(edge.v)) {
                    const newNodes = new Set(pathNodes);
                    newNodes.add(edge.v);
                    dfs(edge.v, newNodes, [...pathEdges, edge]);
                }
            });
        }
        dfs(start, new Set([start]), []);

        pathList.sort((a,b) => a.edges.length - b.edges.length);
        paths = pathList;

        document.getElementById('pathCount').textContent = paths.length;

        if (paths.length > 0) {
            const minLen = paths[0].edges.length;
            const shortestPaths = paths.filter(p => p.edges.length === minLen);
            
            document.getElementById('shortestLen').textContent = minLen;
            document.getElementById('shortestCount').textContent = shortestPaths.length;
            
            const shortList = document.getElementById('shortestList');
            shortList.innerHTML = '';
            shortestPaths.forEach((p, i) => {
                const item = document.createElement('div');
                item.className = 'result-item';
                item.textContent = `${i+1}. ${p.str}`;
                item.onclick = () => {
                    const globalIndex = paths.indexOf(p);
                    highlightPath(globalIndex);
                };
                shortList.appendChild(item);
            });
        } else {
            document.getElementById('shortestLen').textContent = '-';
            document.getElementById('shortestCount').textContent = '0';
            document.getElementById('shortestList').innerHTML = '';
        }

        const list = document.getElementById('pathList');
        list.innerHTML = '';
        paths.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            item.textContent = `${i+1}. ${p.str}`;
            item.onclick = () => highlightPath(i);
            list.appendChild(item);
        });
    }

    function highlightPath(index) {
        clearHighlight();
        activeHighlightType = 'path';
        activeHighlightIndex = index;

        const items = document.querySelectorAll('#pathList .result-item');
        items[index].style.color = '#e74c3c';
        items[index].style.background = '#fef0f0';

        const edgeSeq = paths[index].edges;
        const nodeSet = new Set();

        edgeSeq.forEach(seg => {
            const el = edgesGroup.querySelector(`[data-edge-id="${seg.sourceId}"]`);
            if (el) {
                el.classList.add('highlight-edge');
                const edge = edges.find(e => e.id === seg.sourceId);
                if (edge.bidirectional) {
                    el.setAttribute('marker-start', 'url(#arrow-start-red)');
                    el.setAttribute('marker-end', 'url(#arrow-red)');
                } else {
                    el.setAttribute('marker-end', 'url(#arrow-red)');
                }
            }
            nodeSet.add(seg.u);
            nodeSet.add(seg.v);
        });

        nodeSet.forEach(id => {
            const el = nodesGroup.querySelector(`.node-shape[data-node-id="${id}"]`);
            if (el) el.classList.add('highlight-node');
        });

        clearTimeout(highlightTimer);
        highlightTimer = setTimeout(() => {
            clearHighlight();
        }, HIGHLIGHT_DURATION);
    }

    function clearHighlight() {
        clearTimeout(highlightTimer);
        highlightTimer = null;

        document.querySelectorAll('.highlight-edge').forEach(el => {
            el.classList.remove('highlight-edge');
            const id = parseInt(el.dataset.edgeId);
            const edge = edges.find(e => e.id === id);
            if (edge.bidirectional) {
                el.setAttribute('marker-start', 'url(#arrow-start-default)');
                el.setAttribute('marker-end', 'url(#arrow-default)');
            } else {
                el.setAttribute('marker-end', 'url(#arrow-default)');
            }
        });
        document.querySelectorAll('.highlight-node').forEach(el => el.classList.remove('highlight-node'));
        document.querySelectorAll('#cycleList .result-item').forEach(el => {
            el.style.color = ''; el.style.background = '';
        });
        document.querySelectorAll('#pathList .result-item').forEach(el => {
            el.style.color = ''; el.style.background = '';
        });
        document.querySelectorAll('#shortestList .result-item').forEach(el => {
            el.style.color = ''; el.style.background = '';
        });

        activeHighlightType = null;
        activeHighlightIndex = -1;
    }

    function sampleQuadratic(p0, p1, p2, steps) {
        const points = [];
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = (1-t)*(1-t)*p0.x + 2*(1-t)*t*p1.x + t*t*p2.x;
            const y = (1-t)*(1-t)*p0.y + 2*(1-t)*t*p1.y + t*t*p2.y;
            points.push({ x, y });
        }
        return points;
    }

    function segIntersect(a1, a2, b1, b2) {
        const eps = 1e-6;
        const cross = (x1,y1,x2,y2) => x1*y2 - x2*y1;

        const share = 
            (Math.abs(a1.x-b1.x)<eps && Math.abs(a1.y-b1.y)<eps) ||
            (Math.abs(a1.x-b2.x)<eps && Math.abs(a1.y-b2.y)<eps) ||
            (Math.abs(a2.x-b1.x)<eps && Math.abs(a2.y-b1.y)<eps) ||
            (Math.abs(a2.x-b2.x)<eps && Math.abs(a2.y-b2.y)<eps);
        if (share) return false;

        const d1 = cross(b2.x-b1.x, b2.y-b1.y, a1.x-b1.x, a1.y-b1.y);
        const d2 = cross(b2.x-b1.x, b2.y-b1.y, a2.x-b1.x, a2.y-b1.y);
        const d3 = cross(a2.x-a1.x, a2.y-a1.y, b1.x-a1.x, b1.y-a1.y);
        const d4 = cross(a2.x-a1.x, a2.y-a1.y, b2.x-a1.x, b2.y-a1.y);

        return ((d1>eps && d2<-eps) || (d1<-eps && d2>eps)) &&
               ((d3>eps && d4<-eps) || (d3<-eps && d4>eps));
    }

    function getEdgeSegments(edge) {
        const u = getNodeById(edge.u);
        const v = getNodeById(edge.v);
        if (!u || !v) return [];

        const base = computeBaseEdgeEndpoints(u, v);
        const x1 = base.x1, y1 = base.y1;
        const x2 = base.x2, y2 = base.y2;

        if (edge.type === '-' || !edge.controlPoint) {
            return [{ p1: {x:x1,y:y1}, p2: {x:x2,y:y2} }];
        } else {
            const samples = sampleQuadratic(
                {x:x1, y:y1},
                edge.controlPoint,
                {x:x2, y:y2},
                ARC_SAMPLE_STEPS
            );
            const segs = [];
            for (let i = 0; i < samples.length - 1; i++) {
                segs.push({ p1: samples[i], p2: samples[i+1] });
            }
            return segs;
        }
    }

    function calculateIntersections() {
        const type = document.querySelector('input[name="interType"]:checked').value;
        
        const lineEdges = [];
        const arcEdges = [];
        edges.forEach(e => {
            if (e.type === '-') lineEdges.push(e);
            else arcEdges.push(e);
        });

        let count = 0;

        if (type === 'all' || type === 'line-line') {
            const lineSegs = lineEdges.map(e => getEdgeSegments(e)[0]);
            for (let i = 0; i < lineSegs.length; i++) {
                for (let j = i + 1; j < lineSegs.length; j++) {
                    if (segIntersect(lineSegs[i].p1, lineSegs[i].p2, lineSegs[j].p1, lineSegs[j].p2)) {
                        count++;
                    }
                }
            }
        }

        if (type === 'all' || type === 'line-arc') {
            const lineSegs = lineEdges.map(e => getEdgeSegments(e)[0]);
            arcEdges.forEach(arc => {
                const arcSegs = getEdgeSegments(arc);
                lineSegs.forEach(ls => {
                    for (let i = 0; i < arcSegs.length; i++) {
                        if (segIntersect(ls.p1, ls.p2, arcSegs[i].p1, arcSegs[i].p2)) {
                            count++;
                            break;
                        }
                    }
                });
            });
        }

        if (type === 'all' || type === 'arc-arc') {
            const allArcSegs = arcEdges.map(e => ({ edge: e, segs: getEdgeSegments(e) }));
            for (let i = 0; i < allArcSegs.length; i++) {
                for (let j = i + 1; j < allArcSegs.length; j++) {
                    let hasInter = false;
                    const segsA = allArcSegs[i].segs;
                    const segsB = allArcSegs[j].segs;
                    for (let a = 0; a < segsA.length && !hasInter; a++) {
                        for (let b = 0; b < segsB.length && !hasInter; b++) {
                            if (segIntersect(segsA[a].p1, segsA[a].p2, segsB[b].p1, segsB[b].p2)) {
                                hasInter = true;
                                count++;
                            }
                        }
                    }
                }
            }
        }

        document.getElementById('intersectionCount').textContent = count;
    }

