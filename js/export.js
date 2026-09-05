// js/export.js — 导出功能：图数据 / 节点 / 连线 / 环路 / 计算路径 / 交点统计
// 支持格式：JSON、Markdown(.md)、Word(.docx)、纯文本(.txt)
// 依赖：core.js、analysis.js（nodes、edges、getNodeById、buildCalcEdges、
//       getCanonical、getCycleString、getEdgeSegments、segIntersect、ARC_SAMPLE_STEPS 等）
// 说明：.docx 采用“零依赖”方式生成（最小 zip 容器 + WordprocessingML 文档）。

const EXP_SECTIONS = [
    { key: 'graph', title: '一、图数据（拓扑结构）' },
    { key: 'nodes', title: '二、节点详细信息' },
    { key: 'edges', title: '三、连线详细信息' },
    { key: 'cycles', title: '四、环路分析' },
    { key: 'paths', title: '五、计算的路径' },
    { key: 'intersections', title: '六、交点数量统计' }
];

const SHAPE_NAMES = { circle: '圆形', square: '方形', triangle: '三角形', pentagon: '五边形', hexagon: '六边形' };
const CAT_NAMES = { 'line-line': '直线-直线', 'line-arc': '直线-弧线', 'arc-arc': '弧线-弧线' };
// 连线符号声明：拓扑文本（图数据）以及路径/环路字符串中的 “-” “~” “=” “~~” 含义
const SYMBOL_LEGEND = [
    { symbol: '-', name: '单向直线', desc: '由起点节点（符号左侧）指向终点节点（符号右侧）的直线连线' },
    { symbol: '~', name: '单向弧线', desc: '由起点节点（符号左侧）指向终点节点（符号右侧）的弧线连线' },
    { symbol: '=', name: '双向直线', desc: '两个节点之间可双向通行的直线连线' },
    { symbol: '~~', name: '双向弧线', desc: '两个节点之间可双向通行的弧线连线' }
];
const FORMAT_TIPS = {
    json: 'JSON 结构化数据文件，适合程序化读取与再处理。',
    md: 'Markdown 报告（.md），含表格与列表。',
    txt: '纯文本报告（.txt）。',
    docx: '生成 Word 文档（.docx），可直接用 Word / WPS 打开。'
};
// 文本型文档中单条环路 / 单组路径的最大列出条数，超出仅保留统计并在“备注”中提示
const MAX_LISTED = 5000;

// 用户在导出对话框中配置的“路径起点→终点”对
let expPairs = [];

function r2(n) { return Math.round(n * 100) / 100; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function expStamp() {
    const d = new Date();
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' +
           pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
}
function edgeSymbol(e) { return e.bidirectional ? (e.type === '-' ? '=' : '~~') : e.type; }
function edgeTypeName(e) { return (e.bidirectional ? '双向' : '单向') + (e.type === '-' ? '直线' : '弧线'); }
function cpText(cp) { return cp ? '(' + cp.x + ', ' + cp.y + ')' : '—'; }

/* ================= 导出对话框 ================= */

function openExportDialog() {
    // 保留上次配置的路径对；剔除已不存在的节点
    if (expPairs.length) {
        expPairs = expPairs.filter(p => getNodeById(p.s) && getNodeById(p.e));
    }
    // 首次打开：默认取“两点路径分析”面板当前的起点→终点
    if (nodes.length >= 2 && !expPairs.length) {
        let s = parseInt(document.getElementById('pathStart').value);
        let e = parseInt(document.getElementById('pathEnd').value);
        if (!getNodeById(s)) s = nodes[0].id;
        if (!getNodeById(e) || e === s) e = nodes[1].id;
        expPairs.push({ s: s, e: e });
    }
    renderExpPairRows();
    onExpItemChange();
    onExpFmtChange();
    document.getElementById('exportModal').style.display = 'flex';
}

function closeExportDialog() {
    document.getElementById('exportModal').style.display = 'none';
}

function toggleExpAll(on) {
    document.querySelectorAll('#exportModal input[data-exp]').forEach(cb => { cb.checked = !!on; });
    onExpItemChange();
}

// 勾选项变化：联动“路径对”配置区显隐
function onExpItemChange() {
    const pathsOn = !!document.querySelector('#exportModal input[data-exp="paths"]').checked;
    document.getElementById('expPathSection').style.display = pathsOn ? '' : 'none';
}

function onExpFmtChange() {
    const fmtEl = document.querySelector('#exportModal input[name="exportFmt"]:checked');
    const fmt = fmtEl ? fmtEl.value : 'json';
    document.getElementById('expCopyBtn').disabled = (fmt === 'docx');
    const tip = document.getElementById('expTip');
    if (tip) tip.textContent = FORMAT_TIPS[fmt] || '';
}

function addExportPair() {
    if (nodes.length < 2) return;
    expPairs.push({ s: nodes[0].id, e: nodes[1].id });
    renderExpPairRows();
}

function removeExportPair(i) {
    expPairs.splice(i, 1);
    renderExpPairRows();
}

function onPairChange(sel) {
    const i = +sel.dataset.i;
    const key = sel.dataset.pair;
    expPairs[i][key] = +sel.value;
    if (expPairs[i].s === expPairs[i].e) {
        // 自动纠正：另一端切换到其它节点
        const other = nodes.find(n => n.id !== expPairs[i].s);
        if (other) expPairs[i][key === 's' ? 'e' : 's'] = other.id;
    }
    renderExpPairRows();
}

function nodeOptionsHtml(selected) {
    return nodes.map(n => '<option value="' + n.id + '"' + (n.id === selected ? ' selected' : '') + '>' + n.id + '</option>').join('');
}

function renderExpPairRows() {
    const box = document.getElementById('expPairRows');
    const tip = document.getElementById('expPairTip');
    if (nodes.length < 2) {
        box.innerHTML = '';
        expPairs = [];
        tip.style.display = 'block';
        return;
    }
    tip.style.display = 'none';
    box.innerHTML = expPairs.map((p, i) => {
        const sVal = getNodeById(p.s) ? p.s : nodes[0].id;
        const eVal = (getNodeById(p.e) && p.e !== sVal) ? p.e : nodes[1].id;
        return '<div class="exp-pair-row">' +
            '<span style="flex:none;color:#909399;">' + (i + 1) + '.</span>' +
            '<div class="form-item"><select data-pair="s" data-i="' + i + '" onchange="onPairChange(this)">' + nodeOptionsHtml(sVal) + '</select></div>' +
            '<span class="exp-pair-arrow">→</span>' +
            '<div class="form-item"><select data-pair="e" data-i="' + i + '" onchange="onPairChange(this)">' + nodeOptionsHtml(eVal) + '</select></div>' +
            '<button class="exp-del-btn" onclick="removeExportPair(' + i + ')">删除</button>' +
            '</div>';
    }).join('');
    if (!expPairs.length) {
        box.innerHTML = '<div class="exp-empty-tip">尚未添加路径对，请点击右上角“＋ 添加一组”。</div>';
    }
}

function readExpCfg() {
    const include = {};
    EXP_SECTIONS.forEach(s => { include[s.key] = !!document.querySelector('#exportModal input[data-exp="' + s.key + '"]').checked; });
    const fmtEl = document.querySelector('#exportModal input[name="exportFmt"]:checked');
    const fmt = fmtEl ? fmtEl.value : 'json';
    return { include: include, fmt: fmt };
}

/* ================= 运行导出 / 复制 ================= */

function runExport() {
    try {
        const cfg = readExpCfg();
        if (!Object.values(cfg.include).some(Boolean)) { alert('请至少勾选一项导出内容。'); return; }
        if (cfg.include.paths) {
            const valid = expPairs.filter(p => getNodeById(p.s) && getNodeById(p.e) && p.s !== p.e);
            if (!valid.length) {
                alert('路径分析需要至少一组有效的“起点 → 终点”（节点需存在且不相同）。\n请展开“计算的路径”并添加路径对。');
                return;
            }
        }
        const model = buildExportModel(cfg.include);
        const stamp = expStamp();
        if (cfg.fmt === 'json') {
            downloadTextFile(JSON.stringify(model, null, 2), 'graph-export-' + stamp + '.json', 'application/json;charset=utf-8', false);
        } else if (cfg.fmt === 'md') {
            downloadTextFile(renderMarkdown(model), 'graph-export-' + stamp + '.md', 'text/markdown;charset=utf-8', true);
        } else if (cfg.fmt === 'txt') {
            downloadTextFile(renderTxt(model), 'graph-export-' + stamp + '.txt', 'text/plain;charset=utf-8', true);
        } else if (cfg.fmt === 'docx') {
            downloadBlob(buildDocxBlob(model), 'graph-export-' + stamp + '.docx');
        }
    } catch (err) {
        console.error(err);
        alert('导出失败：' + err.message);
    }
}

function copyExport() {
    const fmt = readExpCfg().fmt;
    if (fmt === 'docx') { alert('Word(.docx) 格式无法复制，请使用「导出文件」下载。'); return; }
    try {
        const cfg = readExpCfg();
        const model = buildExportModel(cfg.include);
        const text = fmt === 'json' ? JSON.stringify(model, null, 2)
                   : fmt === 'md'   ? renderMarkdown(model)
                   : renderTxt(model);
        const done = () => alert('已复制到剪贴板。');
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
        } else {
            fallbackCopy(text, done);
        }
    } catch (err) {
        console.error(err);
        alert('复制失败：' + err.message);
    }
}

function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); if (done) done(); }
    catch (e) { alert('复制失败，请改用「导出文件」下载。'); }
    ta.remove();
}

function downloadTextFile(text, filename, mime, withBom) {
    const blob = new Blob([(withBom ? '\ufeff' : '') + text], { type: mime });
    downloadBlob(blob, filename);
}

function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
}

/* ================= 数据模型（统一从当前画布实时计算） ================= */

function buildExportModel(include) {
    const warnings = [];
    const sections = {};

    if (include.graph) {
        sections.graph = { text: buildGraphText() };
    }
    if (include.nodes) {
        sections.nodes = {
            count: nodes.length,
            items: nodes.map(n => ({
                id: n.id, x: r2(n.x), y: r2(n.y),
                shape: n.shape, size: n.size, color: n.color
            }))
        };
    }
    if (include.edges) {
        sections.edges = {
            count: edges.length,
            items: edges.map(e => ({
                id: e.id, u: e.u, v: e.v,
                type: e.type, bidirectional: !!e.bidirectional,
                color: e.color,
                controlPoint: (e.type === '~' && e.controlPoint)
                    ? { x: r2(e.controlPoint.x), y: r2(e.controlPoint.y) } : null
            }))
        };
    }
    if (include.cycles) {
        const c = computeCyclesData();
        if (c.truncated) warnings.push('环路共 ' + c.count + ' 个，正文/文件中仅列出前 ' + MAX_LISTED + ' 个（JSON 中 count 仍为真实总数）。');
        sections.cycles = c;
    }
    if (include.paths) {
        const validPairs = expPairs.filter(p => getNodeById(p.s) && getNodeById(p.e) && p.s !== p.e);
        if (!validPairs.length) {
            warnings.push('未配置有效的路径起点→终点对，“计算的路径”部分为空。');
            sections.paths = { items: [] };
        } else {
            const items = validPairs.map(p => computePathPairData(p.s, p.e, warnings));
            sections.paths = { items: items };
        }
    }
    if (include.intersections) {
        const it = computeIntersectionsData();
        if (it.truncated) warnings.push('交点明细超过 ' + MAX_LISTED + ' 条，仅列出前 ' + MAX_LISTED + ' 条（数量统计不受影响）。');
        sections.intersections = it;
    }

    return {
        meta: {
            tool: '可视化拓扑构建/分析工具',
            title: '拓扑数据与分析导出报告',
            generatedAt: new Date().toISOString(),
            nodeCount: nodes.length,
            edgeCount: edges.length,
            include: include
        },
        sections: sections,
        legend: SYMBOL_LEGEND.map(l => ({ symbol: l.symbol, name: l.name, desc: l.desc })),
        warnings: warnings
    };
}

// 与 core.js exportToText 一致的拓扑文本（不写回文本框）
function buildGraphText() {
    return edges.map(e => e.u + edgeSymbol(e) + e.v).join('，');
}

function segInfo(s) {
    const edge = edges.find(x => x.id === s.sourceId) || {};
    return {
        u: s.u, v: s.v, type: s.type,
        edgeId: s.sourceId,
        bidirectional: !!edge.bidirectional,
        forward: s.direction === 'forward'
    };
}

// 环路（与 analysis.js calculateCycles 相同算法，纯计算不触碰界面）
function computeCyclesData() {
    const calcEdges = buildCalcEdges();
    const adj = {};
    const allNodes = new Set();
    calcEdges.forEach(e => {
        if (!adj[e.u]) adj[e.u] = [];
        adj[e.u].push(e);
        allNodes.add(e.u);
        allNodes.add(e.v);
    });
    const cycleMap = new Map();
    function search(start, current, pathNodes, pathEdges) {
        (adj[current] || []).forEach(edge => {
            if (edge.v === start) {
                if (pathEdges.length >= 1) {
                    const fullSeq = [...pathEdges, edge];
                    const canon = getCanonical(fullSeq);
                    if (!cycleMap.has(canon)) cycleMap.set(canon, fullSeq);
                }
            } else if (!pathNodes.has(edge.v)) {
                const newNodes = new Set(pathNodes);
                newNodes.add(edge.v);
                search(start, edge.v, newNodes, [...pathEdges, edge]);
            }
        });
    }
    allNodes.forEach(n => search(n, n, new Set([n]), []));
    const keys = Array.from(cycleMap.keys()).sort();
    const truncated = keys.length > MAX_LISTED;
    const shown = truncated ? keys.slice(0, MAX_LISTED) : keys;
    return {
        count: keys.length,
        truncated: truncated,
        items: shown.map(key => {
            const seq = cycleMap.get(key);
            return { str: key, edgeCount: seq.length, sequence: seq.map(segInfo) };
        })
    };
}

// 单组“起点→终点”路径（与 analysis.js calculatePaths 相同算法）
function computePathPairData(s, e, warnings) {
    const base = {
        start: s, end: e, valid: true, reason: null,
        count: 0, shortestEdgeCount: null, shortestCount: 0,
        shortest: [], all: [], truncated: false
    };
    if (!getNodeById(s) || !getNodeById(e)) {
        base.valid = false; base.reason = '起点/终点节点不存在';
        warnings.push('路径对 ' + s + ' → ' + e + '：' + base.reason + '，已跳过。');
        return base;
    }
    const calcEdges = buildCalcEdges();
    const adj = {};
    calcEdges.forEach(x => {
        if (!adj[x.u]) adj[x.u] = [];
        adj[x.u].push(x);
    });
    const list = [];
    function dfs(cur, pathNodes, pathEdges) {
        if (cur === e) { list.push([...pathEdges]); return; }
        (adj[cur] || []).forEach(x => {
            if (!pathNodes.has(x.v)) {
                const ns = new Set(pathNodes);
                ns.add(x.v);
                dfs(x.v, ns, [...pathEdges, x]);
            }
        });
    }
    dfs(s, new Set([s]), []);
    list.sort((a, b) => a.length - b.length);

    const truncated = list.length > MAX_LISTED;
    const shown = truncated ? list.slice(0, MAX_LISTED) : list;
    const all = shown.map(seq => ({
        str: buildPathStr(seq),
        edgeCount: seq.length,
        sequence: seq.map(segInfo)
    }));
    const minLen = list.length ? list[0].length : null;
    const shortCount = minLen === null ? 0 : list.filter(x => x.length === minLen).length;

    base.count = list.length;
    base.shortestEdgeCount = minLen;
    base.shortestCount = shortCount;
    base.shortest = all.filter(x => x.edgeCount === minLen).map(x => ({ str: x.str, edgeCount: x.edgeCount }));
    base.all = all;
    base.truncated = truncated;
    if (truncated) {
        warnings.push('路径组 ' + s + ' → ' + e + ' 共找到 ' + list.length + ' 条简单路径，正文仅列出前 ' + MAX_LISTED + ' 条。');
    }
    return base;
}

function buildPathStr(seq) {
    return seq[0].u + seq.map(x => x.type + x.v).join('');
}

function segIntersectionPoint(a1, a2, b1, b2) {
    const d = (a2.x - a1.x) * (b2.y - b1.y) - (a2.y - a1.y) * (b2.x - b1.x);
    if (Math.abs(d) < 1e-9) return null;
    const t = ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / d;
    return { x: r2(a1.x + (a2.x - a1.x) * t), y: r2(a1.y + (a2.y - a1.y) * t) };
}
function midPoint(a, b) {
    return { x: r2((a.p1.x + a.p2.x) / 2), y: r2((a.p1.y + a.p2.y) / 2) };
}

// 交点统计（含各类型计数 + 明细；算法与 analysis.js calculateIntersections 一致）
function computeIntersectionsData() {
    const lineEdges = edges.filter(e => e.type === '-');
    const arcEdges = edges.filter(e => e.type === '~');
    const lineSegs = lineEdges.map(e => ({ id: e.id, seg: getEdgeSegments(e)[0] }));
    const arcSegs = arcEdges.map(e => ({ id: e.id, segs: getEdgeSegments(e) }));

    let lineLine = 0, lineArc = 0, arcArc = 0;
    const details = [];

    for (let i = 0; i < lineSegs.length; i++) {
        for (let j = i + 1; j < lineSegs.length; j++) {
            const A = lineSegs[i].seg, B = lineSegs[j].seg;
            if (segIntersect(A.p1, A.p2, B.p1, B.p2)) {
                lineLine++;
                details.push({ edgeA: lineSegs[i].id, edgeB: lineSegs[j].id, cat: 'line-line', point: segIntersectionPoint(A.p1, A.p2, B.p1, B.p2) });
            }
        }
    }
    lineSegs.forEach(ls => {
        arcSegs.forEach(ar => {
            for (let k = 0; k < ar.segs.length; k++) {
                const s = ar.segs[k];
                if (segIntersect(ls.seg.p1, ls.seg.p2, s.p1, s.p2)) {
                    lineArc++;
                    details.push({ edgeA: ls.id, edgeB: ar.id, cat: 'line-arc', point: midPoint(s, s) });
                    break;
                }
            }
        });
    });
    for (let i = 0; i < arcSegs.length; i++) {
        for (let j = i + 1; j < arcSegs.length; j++) {
            let found = false;
            for (let a = 0; a < arcSegs[i].segs.length && !found; a++) {
                for (let b = 0; b < arcSegs[j].segs.length && !found; b++) {
                    const sa = arcSegs[i].segs[a], sb = arcSegs[j].segs[b];
                    if (segIntersect(sa.p1, sa.p2, sb.p1, sb.p2)) {
                        arcArc++;
                        found = true;
                        details.push({ edgeA: arcSegs[i].id, edgeB: arcSegs[j].id, cat: 'arc-arc', point: midPoint(sa, sb) });
                    }
                }
            }
        }
    }

    const truncated = details.length > MAX_LISTED;
    return {
        total: lineLine + lineArc + arcArc,
        counts: { lineLine: lineLine, lineArc: lineArc, arcArc: arcArc },
        details: truncated ? details.slice(0, MAX_LISTED) : details,
        truncated: truncated
    };
}

/* ================= 文档结构（供 md / txt / docx 共用） ================= */

function buildDocItems(model) {
    const s = model.sections;
    const items = [];
    items.push({ t: 'h1', text: model.meta.title });
    items.push({
        t: 'list',
        lines: [
            '导出工具：' + model.meta.tool,
            '导出时间：' + new Date(model.meta.generatedAt).toLocaleString('zh-CN'),
            '节点数量：' + model.meta.nodeCount,
            '连线数量：' + model.meta.edgeCount
        ]
    });

    // 只要导出内容里可能含连线符号（图数据 / 环路 / 路径），就在开头声明符号含义
    if (model.sections.graph || model.sections.cycles || model.sections.paths) {
        items.push({ t: 'h2', text: '符号说明' });
        items.push({ t: 'p', text: '本报告中连线符号含义如下（符号两端为节点 ID，节点用数字编号表示）：' });
        items.push({
            t: 'table',
            header: ['符号', '名称', '含义'],
            rows: (model.legend || SYMBOL_LEGEND).map(l => [l.symbol, l.name, l.desc])
        });
        items.push({ t: 'p', text: '“图数据”中的拓扑文本由若干“节点ID 符号 节点ID”段组成，段之间用中文逗号（，）或换行分隔，可直接粘贴回本工具的“数据导入导出”重新导入。' });
    }

    EXP_SECTIONS.forEach(sec => {
        if (!s[sec.key]) return;
        items.push({ t: 'h2', text: sec.title });
        const data = s[sec.key];
        if (sec.key === 'graph') {
            items.push({ t: 'p', text: '节点 ' + model.meta.nodeCount + ' 个，连线 ' + model.meta.edgeCount + ' 条。' });
            items.push({ t: 'p', text: '拓扑文本（可直接粘贴到“数据导入导出”中导入）：' });
            items.push({ t: 'code', text: data.text || '（空）' });
        } else if (sec.key === 'nodes') {
            items.push({ t: 'p', text: '共 ' + data.count + ' 个节点。' });
            items.push({
                t: 'table',
                header: ['#', '节点 ID', 'X 坐标', 'Y 坐标', '形状', '大小', '颜色'],
                rows: data.items.map((n, i) => [
                    String(i + 1), String(n.id), String(n.x), String(n.y),
                    SHAPE_NAMES[n.shape] || n.shape, String(n.size), n.color
                ])
            });
        } else if (sec.key === 'edges') {
            items.push({ t: 'p', text: '共 ' + data.count + ' 条连线。' });
            items.push({
                t: 'table',
                header: ['#', '边 ID', '起点', '终点', '符号', '类型 / 方向', '颜色', '控制点'],
                rows: data.items.map((e, i) => [
                    String(i + 1), String(e.id), String(e.u), String(e.v),
                    edgeSymbol(e), edgeTypeName(e), e.color,
                    cpText(e.controlPoint)
                ])
            });
        } else if (sec.key === 'cycles') {
            items.push({ t: 'p', text: '共找到 ' + data.count + ' 个简单环路。' });
            if (data.items.length) {
                items.push({ t: 'p', text: '环路列表（按“节点-连线”顺序表示）：' });
                items.push({ t: 'list', lines: data.items.map((c, i) => (i + 1) + ') ' + c.str + '（' + c.edgeCount + ' 条边）') });
            }
        } else if (sec.key === 'paths') {
            if (!data.items.length) {
                items.push({ t: 'p', text: '（未配置有效的“起点 → 终点”路径对）' });
            } else {
                data.items.forEach((p, i) => {
                    items.push({ t: 'h3', text: (i + 1) + '. 起点 ' + p.start + ' → 终点 ' + p.end });
                    if (!p.valid) {
                        items.push({ t: 'list', lines: ['该路径对无效：' + p.reason] });
                        return;
                    }
                    items.push({
                        t: 'list',
                        lines: [
                            '简单路径总数：' + p.count + ' 条',
                            '最短路径边数：' + p.shortestEdgeCount,
                            '最短路径条数：' + p.shortestCount + ' 条'
                        ]
                    });
                    if (p.shortestCount > 0) {
                        items.push({ t: 'p', text: '最短路径：' });
                        items.push({ t: 'list', lines: p.shortest.map(x => x.str) });
                    }
                    items.push({ t: 'p', text: '全部简单路径：' });
                    items.push({ t: 'list', lines: p.all.map(x => x.str) });
                });
            }
        } else if (sec.key === 'intersections') {
            const c = data.counts;
            items.push({
                t: 'list',
                lines: [
                    '直线-直线交点：' + c.lineLine,
                    '直线-弧线交点：' + c.lineArc,
                    '弧线-弧线交点：' + c.arcArc,
                    '交点合计：' + data.total
                ]
            });
            if (data.details.length) {
                items.push({ t: 'p', text: '交点明细（两两相交的边对）：' });
                items.push({ t: 'list', lines: data.details.map((d, i) => (i + 1) + ') 边 ' + d.edgeA + ' 与 边 ' + d.edgeB + '（' + (CAT_NAMES[d.cat] || d.cat) + '）') });
            }
        }
    });

    if (model.warnings && model.warnings.length) {
        items.push({ t: 'h2', text: '备注' });
        items.push({ t: 'list', lines: model.warnings });
    }
    return items;
}

/* ================= Markdown 渲染 ================= */

function mdCell(v) { return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '); }
function mdTable(t) {
    const head = t.header.map(mdCell).join(' | ');
    const sep = t.header.map(() => '---').join(' | ');
    const rows = t.rows.map(r => r.map(mdCell).join(' | '));
    return ['| ' + head + ' |', '| ' + sep + ' |'].concat(rows.map(r => '| ' + r + ' |')).join('\n');
}

function renderMarkdown(model) {
    const out = [];
    buildDocItems(model).forEach(it => {
        if (it.t === 'h1') { out.push('# ' + it.text, ''); }
        else if (it.t === 'h2') { out.push('## ' + it.text, ''); }
        else if (it.t === 'h3') { out.push('### ' + it.text, ''); }
        else if (it.t === 'p') { out.push(it.text, ''); }
        else if (it.t === 'code') { out.push('```text', it.text, '```', ''); }
        else if (it.t === 'list') { it.lines.forEach(l => out.push('- ' + l)); out.push(''); }
        else if (it.t === 'table') { out.push(mdTable(it), ''); }
    });
    return out.join('\n');
}

/* ================= TXT 渲染 ================= */

function cjkWidth(str) {
    let w = 0;
    for (const ch of String(str)) w += ch.charCodeAt(0) > 255 ? 2 : 1;
    return w;
}
function txtPad(str, width) {
    const s = String(str);
    const pad = width - cjkWidth(s);
    return pad > 0 ? s + ' '.repeat(pad) : s;
}

function renderTxt(model) {
    const out = [];
    const ttl = '可视化拓扑构建/分析工具 —— 导出报告';
    out.push('='.repeat(46), ttl, '='.repeat(46), '');
    buildDocItems(model).forEach(it => {
        if (it.t === 'h1') { /* 已手动输出大标题 */ }
        else if (it.t === 'h2') { out.push('', '【' + it.text + '】', ''); }
        else if (it.t === 'h3') { out.push('◆ ' + it.text); }
        else if (it.t === 'p') { out.push(it.text); }
        else if (it.t === 'code') { out.push('  ' + it.text); }
        else if (it.t === 'list') { it.lines.forEach(l => out.push('  - ' + l)); }
        else if (it.t === 'table') {
            const widths = it.header.map((h, ci) =>
                Math.max(cjkWidth(h), ...it.rows.map(r => cjkWidth(r[ci] || ''))));
            const fmtRow = row => row.map((c, ci) => txtPad(c, widths[ci])).join('  |  ');
            out.push(fmtRow(it.header));
            out.push(widths.map(w => '-'.repeat(w)).join('--+--'));
            it.rows.forEach(r => out.push(fmtRow(r)));
            out.push('');
        }
    });
    return out.join('\n');
}

/* ================= DOCX 渲染（零依赖最小 .docx） ================= */

function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function docxRpr(bold, mono, size) {
    let r = '<w:rFonts w:ascii="' + (mono ? 'Consolas' : 'Calibri') + '" w:hAnsi="' + (mono ? 'Consolas' : 'Calibri') + '" w:eastAsia="微软雅黑"/>';
    if (bold) r += '<w:b/>';
    r += '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>';
    return r;
}

function docxPara(text, opt) {
    opt = opt || {};
    const size = opt.size || 21;
    const bold = !!opt.bold;
    const mono = !!opt.mono;
    const indent = opt.indent || 0;
    const rpr = docxRpr(bold, mono, size);
    const before = opt.before || 0;
    const after = (opt.after === undefined) ? 80 : opt.after;
    return '<w:p><w:pPr><w:spacing w:before="' + before + '" w:after="' + after + '" w:line="260" w:lineRule="auto"/>' +
        (indent ? '<w:ind w:left="' + indent + '"/>' : '') +
        '<w:rPr>' + rpr + '</w:rPr></w:pPr>' +
        '<w:r><w:rPr>' + rpr + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(text) + '</w:t></w:r></w:p>';
}

function docxTable(t) {
    const cols = t.header.length;
    const total = 9400;
    const baseW = Math.max(500, Math.floor(total / cols));
    const widths = t.header.map(() => baseW);
    const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
        .map(b => '<w:' + b + ' w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>').join('');
    const tblPr = '<w:tblPr><w:tblW w:w="' + total + '" w:type="dxa"/><w:tblBorders>' + borders + '</w:tblBorders>' +
        '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>';
    const grid = '<w:tblGrid>' + widths.map(w => '<w:gridCol w:w="' + w + '"/>').join('') + '</w:tblGrid>';
    const allRows = [t.header].concat(t.rows);
    const trs = allRows.map((row, ri) => {
        const cells = row.map((cell, ci) => {
            const bold = ri === 0;
            const rpr = docxRpr(bold, false, bold ? 20 : 20);
            const shd = ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EFEFEF"/>' : '';
            return '<w:tc><w:tcPr><w:tcW w:w="' + widths[ci] + '" w:type="dxa"/>' + shd + '<w:vAlign w:val="center"/></w:tcPr>' +
                '<w:p><w:pPr><w:spacing w:before="20" w:after="20" w:line="240" w:lineRule="auto"/><w:rPr>' + rpr + '</w:rPr></w:pPr>' +
                '<w:r><w:rPr>' + rpr + '</w:rPr><w:t xml:space="preserve">' + xmlEsc(cell === null || cell === undefined ? '' : cell) + '</w:t></w:r></w:p></w:tc>';
        }).join('');
        return '<w:tr>' + cells + '</w:tr>';
    }).join('');
    return '<w:tbl>' + tblPr + grid + trs + '</w:tbl>';
}

function docxBodyXml(items) {
    const parts = [];
    items.forEach(it => {
        if (it.t === 'h1') parts.push(docxPara(it.text, { bold: true, size: 32, before: 120, after: 160 }));
        else if (it.t === 'h2') parts.push(docxPara(it.text, { bold: true, size: 27, before: 240, after: 100 }));
        else if (it.t === 'h3') parts.push(docxPara(it.text, { bold: true, size: 24, before: 160, after: 80 }));
        else if (it.t === 'p') parts.push(docxPara(it.text, {}));
        else if (it.t === 'code') parts.push(docxPara(it.text, { mono: true, size: 20 }));
        else if (it.t === 'list') it.lines.forEach(l => parts.push(docxPara('•  ' + l, { indent: 240 })));
        else if (it.t === 'table') { parts.push(docxTable(it)); parts.push(docxPara('', { after: 40 })); }
    });
    return parts.join('');
}

function buildDocxBlob(model) {
    const body = docxBodyXml(buildDocItems(model));
    const documentXml =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        body +
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>' +
        '</w:body></w:document>';
    const contentTypes =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>';
    const rels =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
        '</Relationships>';

    const zip = makeZip([
        { name: '[Content_Types].xml', data: contentTypes },
        { name: '_rels/.rels', data: rels },
        { name: 'word/document.xml', data: documentXml }
    ]);
    return new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

/* ================= 最小 ZIP（STORE，无压缩） ================= */

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function makeZip(files) {
    const encoder = new TextEncoder();
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    const localParts = [];
    const centralParts = [];
    let offset = 0;
    let centralSize = 0;

    files.forEach(f => {
        const nameBytes = encoder.encode(f.name);
        const data = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
        const crc = crc32(data);
        const size = data.length;

        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true);
        lh.setUint16(4, 20, true);          // version needed
        lh.setUint16(6, 0x0800, true);      // UTF-8 flag
        lh.setUint16(8, 0, true);           // method: store
        lh.setUint16(10, dosTime, true);
        lh.setUint16(12, dosDate, true);
        lh.setUint32(14, crc, true);
        lh.setUint32(18, size, true);
        lh.setUint32(22, size, true);
        lh.setUint16(26, nameBytes.length, true);
        lh.setUint16(28, 0, true);
        localParts.push(new Uint8Array(lh.buffer), nameBytes, data);

        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true);
        ch.setUint16(4, 20, true);          // version made by
        ch.setUint16(6, 20, true);          // version needed
        ch.setUint16(8, 0x0800, true);
        ch.setUint16(10, 0, true);
        ch.setUint16(12, 0, true);
        ch.setUint16(14, dosTime, true);
        ch.setUint16(16, dosDate, true);
        ch.setUint32(18, crc, true);
        ch.setUint32(22, size, true);
        ch.setUint32(26, size, true);
        ch.setUint16(30, nameBytes.length, true);
        ch.setUint32(42, offset, true);
        centralParts.push(new Uint8Array(ch.buffer), nameBytes);
        centralSize += 46 + nameBytes.length;

        offset += 30 + nameBytes.length + size;
    });

    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true);
    eocd.setUint32(12, centralSize, true);
    eocd.setUint32(16, offset, true);

    const all = [localParts, centralParts, [new Uint8Array(eocd.buffer)]];
    let total = 0;
    all.forEach(group => group.forEach(b => { total += b.length; }));

    const out = new Uint8Array(total);
    let pos = 0;
    all.forEach(group => group.forEach(b => { out.set(b, pos); pos += b.length; }));
    return out;
}
