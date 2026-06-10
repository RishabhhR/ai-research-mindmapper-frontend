const API_BASE = "https://mindmapper-api-mu.vercel.app";
const CLERK_KEY = "pk_test_c2tpbGxlZC1vcmNhLTc4LmNsZXJrLmFjY291bnRzLmRldiQ";

let clerk = null;

const state = {
  current: null,
  history: [],
  selectedNode: null,
  mode: "query",
  nodeElements: [],
  rootElement: null,
  panX: 0,
  panY: 0,
  scale: 1,
};

const elements = {
  form: document.querySelector("#researchForm"),
  topic: document.querySelector("#topicInput"),
  file: document.querySelector("#fileInput"),
  depth: document.querySelector("#depthSelect"),
  output: document.querySelector("#outputSelect"),
  source: document.querySelector("#sourceSelect"),
  canvas: document.querySelector("#mindmapCanvas"),
  workspace: document.querySelector("#mindmapWorkspace"),
  insights: document.querySelector("#insightList"),
  sources: document.querySelector("#sourceList"),
  sourceCount: document.querySelector("#sourceCount"),
  tradeoffs: document.querySelector("#tradeoffList"),
  quality: document.querySelector("#qualityScore"),
  history: document.querySelector("#historyList"),
  toast: document.querySelector("#toast"),
  save: document.querySelector("#saveMap"),
  copy: document.querySelector("#copySummary"),
  zoomIn: document.querySelector("#zoomIn"),
  zoomOut: document.querySelector("#zoomOut"),
  zoomReset: document.querySelector("#zoomReset"),
  clearHistory: document.querySelector("#clearHistory"),
  steps: Array.from(document.querySelectorAll(".status-step")),
  navItems: Array.from(document.querySelectorAll(".nav-item")),
  modeTabs: Array.from(document.querySelectorAll(".mode-tab")),
  qaForm: document.querySelector("#qaForm"),
  question: document.querySelector("#questionInput"),
  answer: document.querySelector("#answerPanel"),
  sessionBadge: document.querySelector("#sessionBadge"),
};

function setProgress(activeIndex) {
  elements.steps.forEach((step, index) => {
    step.classList.toggle("active", index <= activeIndex);
  });
}

function setLoading(message) {
  setProgress(0);
  showToast(message);
  elements.form.classList.add("is-loading");
}

function clearLoading() {
  elements.form.classList.remove("is-loading");
  setProgress(3);
}

async function requestJson(path, options = {}) {
  const token = clerk ? await clerk.session?.getToken() : null;
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.message || `Request failed: ${response.status}`);
  }
  return data;
}

async function runResearch(event) {
  event.preventDefault();
  if (!await ensureAuth()) return;
  const topic = elements.topic.value.trim();
  if (state.mode !== "file" && !topic) {
    showToast("Add a topic or URL");
    return;
  }

  try {
    setLoading("Researching...");
    let result;
    if (state.mode === "query") {
      result = await requestJson("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: topic,
          depth: elements.depth.value,
          output: elements.output.value,
          source: elements.source.value,
        }),
      });
    } else if (state.mode === "url") {
      const source = await requestJson("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: topic, topic }),
      });
      ensureSourceHasText(source);
      result = await requestJson(`/api/sessions/${source.session_id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          depth: elements.depth.value,
          output: elements.output.value,
          source: elements.source.value,
        }),
      });
      result.warnings = [...(source.warnings || []), ...(result.warnings || [])];
    } else {
      const file = elements.file.files[0];
      if (!file) {
        showToast("Choose a TXT or PDF file");
        return;
      }
      const source = await fetch(`${API_BASE}/api/sources`, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "X-Filename": file.name,
        },
        body: await file.arrayBuffer(),
      }).then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.detail || "Upload failed");
        return data;
      });
      ensureSourceHasText(source);
      result = await requestJson(`/api/sessions/${source.session_id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: topic || file.name,
          depth: elements.depth.value,
          output: elements.output.value,
          source: elements.source.value,
        }),
      });
      result.warnings = [...(source.warnings || []), ...(result.warnings || [])];
    }
    loadResearch(normalizeResearch(result));
    saveCurrentResearch(false);
    if (result.warnings?.length) showToast(result.warnings[0]);
  } catch (error) {
    showToast(error.message);
  } finally {
    clearLoading();
  }
}

function ensureSourceHasText(source) {
  if (source.chunks_count > 0) return;
  const warning = source.warnings?.[0] || "No readable text was extracted from this source.";
  throw new Error(warning);
}

function normalizeResearch(data) {
  const nodes = Array.isArray(data.nodes) && data.nodes.length ? data.nodes : [];
  return {
    id: data.session_id || Date.now(),
    session_id: data.session_id,
    topic: data.topic || elements.topic.value,
    depth: data.depth || elements.depth.value,
    output: data.output || elements.output.value,
    quality: Math.min(96, 76 + nodes.length * 3 + (data.citations?.length || 0)),
    root: data.root || data.topic || "Research map",
    rootX: data.rootX || 40,
    rootY: data.rootY || 39,
    summary: data.summary || "No summary returned.",
    nodes: nodes.map((node, index) => {
      const count = Math.max(1, nodes.length);
      const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
      const x = 39 + 32 * Math.cos(angle);
      const y = 44 + 32 * Math.sin(angle);
      return [
        node.title || `Node ${index + 1}`,
        node.description || node.body || "",
        Math.round(x),
        Math.round(y),
        node.provenance || "ai_synthesized",
      ];
    }),
    insights: normalizeCards(data.insights),
    sources: normalizeSources([...(data.sources || []), ...(data.citations || [])]),
    tradeoffs: normalizeCards(data.tradeoffs),
    createdAt: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
}

function normalizeCards(cards = []) {
  return cards.map((card) => [
    card.title || "Insight",
    card.body || card.description || "",
    card.provenance || "ai_synthesized",
  ]);
}

function normalizeSources(sources = []) {
  return sources.map((source) => [
    source.title || "Source",
    source.type || "Reference",
    source.confidence || "Medium",
    source.body || source.snippet || source.url || "",
    source.provenance || "source_grounded",
    source.url || "",
  ]);
}

function renderMindmap(research) {
  elements.workspace.innerHTML = "";
  state.nodeElements = [];
  
  const root = createNode("root", research.root, research.summary, research.rootX || 40, research.rootY || 39, true, "ai_synthesized");
  elements.workspace.appendChild(root);
  state.rootElement = root;

  research.nodes.forEach(([title, description, x, y, provenance, parentId], index) => {
    const line = document.createElement("div");
    line.className = "mindmap-line";
    elements.workspace.appendChild(line);
    
    const node = createNode(index, title, description, x, y, false, provenance);
    elements.workspace.appendChild(node);
    
    state.nodeElements.push({ node, line, parentId: parentId ?? "root" });
  });
  
  setTimeout(() => {
    updateLines();
    autofitMap();
  }, 0);
}

function autofitMap() {
  if (!state.nodeElements.length && !state.rootElement) return;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const wWidth = elements.workspace.offsetWidth;
  const wHeight = elements.workspace.offsetHeight;
  
  const allNodes = [state.rootElement, ...state.nodeElements.map(n => n.node)].filter(Boolean);
  
  allNodes.forEach(node => {
    const leftPct = parseFloat(node.style.left) || 0;
    const topPct = parseFloat(node.style.top) || 0;
    
    const px = (leftPct / 100) * wWidth;
    const py = (topPct / 100) * wHeight;
    const nw = node.offsetWidth;
    const nh = node.offsetHeight;
    
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px + nw);
    maxY = Math.max(maxY, py + nh);
  });
  
  if (minX === Infinity) return;
  
  const padding = 40;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  
  const mapWidth = maxX - minX;
  const mapHeight = maxY - minY;
  
  const cWidth = elements.canvas.offsetWidth;
  const cHeight = elements.canvas.offsetHeight;
  
  const scaleX = cWidth / mapWidth;
  const scaleY = cHeight / mapHeight;
  let newScale = Math.min(scaleX, scaleY, 1); 
  
  const mapCenterX = minX + mapWidth / 2;
  const mapCenterY = minY + mapHeight / 2;
  
  state.scale = newScale;
  state.panX = (cWidth / 2) - (mapCenterX * newScale);
  state.panY = (cHeight / 2) - (mapCenterY * newScale);
  
  updateWorkspaceTransform();
}

function updateLines() {
  const workspaceRect = elements.workspace.getBoundingClientRect();
  const wWidth = elements.workspace.offsetWidth;
  const wHeight = elements.workspace.offsetHeight;
  
  state.nodeElements.forEach(({ node, line, parentId }) => {
    let parentElement;
    if (parentId === "root") {
      parentElement = state.rootElement;
    } else {
      const parentState = state.nodeElements.find(n => n.node.dataset.id == parentId);
      parentElement = parentState ? parentState.node : state.rootElement;
    }
    
    if (!parentElement) return;

    const parentRect = parentElement.getBoundingClientRect();
    const parentPx = (parentRect.left - workspaceRect.left + parentRect.width / 2) / state.scale;
    const parentPy = (parentRect.top - workspaceRect.top + parentRect.height / 2) / state.scale;

    const rect = node.getBoundingClientRect();
    const nx = (rect.left - workspaceRect.left + rect.width / 2) / state.scale;
    const ny = (rect.top - workspaceRect.top + rect.height / 2) / state.scale;
    
    const dx = nx - parentPx;
    const dy = ny - parentPy;
    const lengthPx = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    
    line.style.left = `${(parentPx / wWidth) * 100}%`;
    line.style.top = `${(parentPy / wHeight) * 100}%`;
    line.style.width = `${lengthPx}px`;
    line.style.transform = `rotate(${angle}deg)`;
  });
}

function createNode(id, title, description, x, y, isRoot, provenance) {
  const node = document.createElement("div");
  node.className = `map-node${isRoot ? " root" : ""}`;
  node.dataset.id = id;
  node.style.left = `${x}%`;
  node.style.top = `${y}%`;
  
  let expandBtn = "";
  if (!isRoot) {
    expandBtn = `<button class="expand-btn" data-id="${id}" title="Break into sub-maps">+</button>`;
  }

  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span>${badge(provenance)}${expandBtn}`;
  
  node.addEventListener("click", (e) => {
    if (node.dataset.wasDragged === "true") {
      node.dataset.wasDragged = "false";
      return;
    }
    if (e.target.closest('.expand-btn')) {
      expandNode(id, title);
      return;
    }
    selectNode(id, node, title);
  });
  return node;
}

async function expandNode(id, title) {
  const parentNode = state.current.nodes[id];
  if (!parentNode) return;
  
  const nodeEl = document.querySelector(`.map-node[data-id="${id}"]`);
  if (nodeEl) nodeEl.classList.add("is-loading");
  
  showToast(`Expanding ${title}...`);
  
  try {
    let result;
    if (state.current.session_id) {
      result = await requestJson(`/api/sessions/${state.current.session_id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: title,
          depth: "Basic",
          output: "Mindmap",
        }),
      });
    } else {
      result = await requestJson("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: title,
          depth: "Basic",
          output: "Mindmap",
        }),
      });
    }
    
    const newNodes = result.nodes || [];
    if (newNodes.length === 0) {
      showToast("No further details found.");
      return;
    }
    
    const parentX = parentNode[2];
    const parentY = parentNode[3];
    const count = newNodes.length;
    
    newNodes.forEach((node, index) => {
      const angle = (index / count) * Math.PI * 2;
      const x = parentX + 22 * Math.cos(angle);
      const y = parentY + 22 * Math.sin(angle);
      
      state.current.nodes.push([
        node.title || `Sub-node ${index + 1}`,
        node.description || node.body || "",
        Math.round(x),
        Math.round(y),
        node.provenance || "ai_synthesized",
        id
      ]);
    });
    
    if (result.insights) state.current.insights.push(...normalizeCards(result.insights));
    if (result.sources) state.current.sources.push(...normalizeSources(result.sources));
    
    renderMindmap(state.current);
    renderInsights(state.current);
    renderSources(state.current);
    saveCurrentResearch(false);
    showToast(`Expanded ${title}`);
    
  } catch (error) {
    showToast(`Error expanding: ${error.message}`);
  } finally {
    if (nodeEl) nodeEl.classList.remove("is-loading");
  }
}

function selectNode(id, node, title) {
  state.selectedNode = id;
  document.querySelectorAll(".map-node").forEach((item) => item.classList.remove("selected"));
  node.classList.add("selected");
  showToast(`${title} selected`);
}

function renderInsights(research) {
  elements.quality.textContent = research.quality;
  elements.insights.innerHTML = research.insights.length
    ? research.insights.map(([title, body, provenance]) => `<article class="insight-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>${badge(provenance)}</article>`).join("")
    : '<article class="insight-card"><h3>No insights yet</h3><p>Run a research query or ingest a source.</p></article>';
}

function renderSources(research) {
  elements.sourceCount.textContent = `${research.sources.length} sources`;
  elements.sources.innerHTML = research.sources.length
    ? research.sources.map(([title, type, confidence, body, provenance, url]) => `
        <article class="source-card">
          <div class="source-meta">
            <span>${escapeHtml(type)}</span>
            <span>${escapeHtml(confidence)} confidence</span>
          </div>
          <div>
            <h3>${url ? `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>` : escapeHtml(title)}</h3>
            <p>${escapeHtml(body)}</p>
          </div>
          ${badge(provenance)}
        </article>
      `).join("")
    : '<article class="source-card"><h3>No sources yet</h3><p>Submit a URL, file, or search query.</p></article>';
}

function renderTradeoffs(research) {
  elements.tradeoffs.innerHTML = research.tradeoffs.length
    ? research.tradeoffs.map(([title, body, provenance]) => `<article class="tradeoff-card"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(body)}</p>${badge(provenance)}</article>`).join("")
    : '<article class="tradeoff-card"><h3>No trade-offs yet</h3><p>Trade-offs will appear after synthesis.</p></article>';
}

function formatTopic(topic) {
  if (!topic) return "Untitled";
  if (topic.startsWith("http")) {
    try {
      const url = new URL(topic);
      let path = url.pathname !== "/" ? url.pathname : url.hostname;
      if (path.length > 30) path = path.substring(0, 30) + "...";
      return path;
    } catch {
      return topic.length > 30 ? topic.substring(0, 30) + "..." : topic;
    }
  }
  return topic.length > 40 ? topic.substring(0, 40) + "..." : topic;
}

async function migrateLocalStorage() {
  const localHistory = JSON.parse(localStorage.getItem("researchHistory") || "[]");
  if (!localHistory.length) return;

  showToast("Syncing local maps to cloud...");
  for (const item of localHistory) {
    try {
      // Create session on Turso
      const session = await requestJson("/api/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: item.topic,
          depth: item.depth || "Detailed",
          output: item.output || "Mindmap",
          source: "local_migration"
        }),
      });
      // The backend /api/research already saves it, but we might want to preserve the old content?
      // For now, simple re-generation or just noting it's synced is better than complex partial sync.
      console.log(`Migrated topic: ${item.topic}`);
    } catch (err) {
      console.error("Migration failed for topic:", item.topic, err);
    }
  }
  localStorage.removeItem("researchHistory");
  showToast("Migration complete");
  await loadHistory();
}

async function loadHistory() {
  try {
    const data = await requestJson("/api/sessions");
    state.history = data.sessions || [];
    renderHistory();
  } catch (err) {
    console.error("Failed to load history:", err);
  }
}

function renderHistory() {
  if (!state.history.length) {
    elements.history.innerHTML = '<div class="history-card"><strong>No saved maps</strong><span>Save a synthesis to keep it here.</span></div>';
    return;
  }

  elements.history.innerHTML = state.history
    .map((item) => `
      <button class="history-card" type="button" data-id="${escapeAttr(item.id)}" title="${escapeAttr(item.topic)}">
        <strong>${escapeHtml(formatTopic(item.topic))}</strong>
        <span>${escapeHtml(item.created_at || item.createdAt)} · ${escapeHtml(item.depth)}</span>
      </button>
    `)
    .join("");

  elements.history.querySelectorAll(".history-card[data-id]").forEach((card) => {
    card.addEventListener("click", async () => {
      const id = card.dataset.id;
      try {
        setLoading("Loading map...");
        const data = await requestJson(`/api/sessions/${id}`);
        const sessionRaw = {
          ...data.session,
          session_id: data.session.id,
          nodes: data.session.mindmap || [],
          sources: data.sources || [],
        };
        loadResearch(normalizeResearch(sessionRaw), false);
        clearLoading();
        showToast("Map loaded from database");
      } catch (err) {
        clearLoading();
        console.error("Failed to load session:", err);
        showToast("Error loading session data");
      }
    });
  });
}

function loadResearch(research, animate = true) {
  state.current = research;
  elements.topic.value = research.topic;
  elements.depth.value = research.depth;
  elements.output.value = research.output;
  elements.sessionBadge.textContent = research.id ? "Sync'd" : "Local";
  if (animate) setProgress(3);
  renderOutput(research);
  renderInsights(research);
  renderSources(research);
  renderTradeoffs(research);
}

function renderOutput(research) {
  const mode = (research.output || "Mindmap").trim();
  const canvas = elements.canvas;
  const altContainer = document.getElementById("alt-output-container") || createAltContainer();

  if (mode === "Mindmap") {
    canvas.style.display = "";
    altContainer.style.display = "none";
    renderMindmap(research);
  } else {
    canvas.style.display = "none";
    altContainer.style.display = "";
    if (mode === "Report")      renderReport(research, altContainer);
    else if (mode === "Comparison") renderComparison(research, altContainer);
    else if (mode === "Bullets")    renderBullets(research, altContainer);
    else renderReport(research, altContainer); // fallback
  }
}

function createAltContainer() {
  const div = document.createElement("div");
  div.id = "alt-output-container";
  elements.canvas.parentElement.appendChild(div);
  return div;
}

function renderReport(research, container) {
  const nodes = research.nodes || [];
  container.innerHTML = `
    <div class="alt-output report-output">
      <div class="alt-output-summary">${escapeHtml(research.summary)}</div>
      <div class="alt-output-sections">
        ${nodes.map(([title, body, , , provenance], i) => `
          <div class="report-section">
            <div class="report-section-num">${i + 1}</div>
            <div class="report-section-body">
              <div class="report-section-title">${escapeHtml(title)}</div>
              <div class="report-section-text">${escapeHtml(body)}</div>
              <span class="node-badge ${provenance}">${labelFor(provenance)}</span>
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderComparison(research, container) {
  const nodes = research.nodes || [];
  container.innerHTML = `
    <div class="alt-output comparison-output">
      <div class="alt-output-summary">${escapeHtml(research.summary)}</div>
      <div class="comparison-grid">
        ${nodes.map(([title, body, , , provenance]) => `
          <div class="comparison-card">
            <div class="comparison-card-title">${escapeHtml(title)}</div>
            <div class="comparison-card-body">${escapeHtml(body)}</div>
            <span class="node-badge ${provenance}">${labelFor(provenance)}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderBullets(research, container) {
  const nodes = research.nodes || [];
  const summaryBullets = research.summary
    .split(/\n|(?<=\.\s)/).map(s => s.replace(/^[•\-*]\s*/, "").trim()).filter(Boolean);
  container.innerHTML = `
    <div class="alt-output bullets-output">
      <ul class="bullets-summary">
        ${summaryBullets.map(line => `<li>${escapeHtml(line)}</li>`).join("")}
      </ul>
      <div class="bullets-nodes">
        ${nodes.map(([title, body, , , provenance]) => `
          <div class="bullet-item">
            <span class="bullet-dot"></span>
            <div class="bullet-content">
              <span class="bullet-title">${escapeHtml(title)}</span>
              <span class="bullet-body">${escapeHtml(body)}</span>
              <span class="node-badge ${provenance}">${labelFor(provenance)}</span>
            </div>
          </div>`).join("")}
      </div>
    </div>`;
}

function escapeHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}


function saveCurrentResearch(show = true) {
  if (!state.current) return;
  state.history = [state.current, ...state.history.filter((item) => item.id !== state.current.id)].slice(0, 15);
  renderHistory();
  if (show) showToast("Research map saved");
}

async function copySummary() {
  if (!state.current) return;
  const lines = [
    `Topic: ${state.current.topic}`,
    `Depth: ${state.current.depth}`,
    `Output: ${state.current.output}`,
    "",
    state.current.summary,
    "",
    "Key insights:",
    ...state.current.insights.map(([title, body, provenance]) => `- ${title}: ${body} [${labelFor(provenance)}]`),
  ];

  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    showToast("Summary copied");
  } catch {
    showToast("Copy unavailable in this browser");
  }
}

async function askQuestion(event) {
  event.preventDefault();
  if (!await ensureAuth()) return;
  if (!state.current?.session_id) {
    showToast("Run backend research first");
    return;
  }
  const question = elements.question.value.trim();
  if (!question) return;
  elements.answer.innerHTML = '<div class="answer-card"><p>Searching evidence first...</p></div>';
  try {
    const data = await requestJson(`/api/sessions/${state.current.session_id}/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question }),
    });
    elements.answer.innerHTML = `
      <article class="answer-card">
        ${badge(data.provenance)}
        <h3>${escapeHtml(question)}</h3>
        <p>${escapeHtml(data.answer || "No answer returned.")}</p>
        ${(data.citations || []).map((citation) => `<div class="mini-citation">${escapeHtml(citation.title || "Citation")}: ${escapeHtml(citation.snippet || citation.url || "")}</div>`).join("")}
      </article>
    `;
    elements.question.value = "";
  } catch (error) {
    elements.answer.innerHTML = `<div class="answer-card"><p>${escapeHtml(error.message)}</p></div>`;
  }
}

function badge(provenance) {
  return `<span class="provenance-badge ${escapeAttr(provenance || "ai_synthesized")}">${labelFor(provenance)}</span>`;
}

function labelFor(provenance) {
  return {
    source_grounded: "Provided evidence",
    ai_synthesized: "AI synthesis",
    web_enriched: "Web enriched",
  }[provenance] || "AI synthesis";
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function setMode(mode) {
  state.mode = mode;
  elements.modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));
  elements.file.classList.toggle("visible", mode === "file");
  elements.topic.placeholder = mode === "url" ? "Paste a webpage or YouTube URL..." : "What do you want to research?";
}

let draggedNode = null;
let isPanning = false;
let dragStartX = 0;
let dragStartY = 0;
let dragInitialLeft = 0;
let dragInitialTop = 0;
let dragInitialPanX = 0;
let dragInitialPanY = 0;
let hasMoved = false;

function updateWorkspaceTransform() {
  elements.workspace.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.scale})`;
  elements.canvas.style.backgroundPosition = `${state.panX}px ${state.panY}px`;
  elements.canvas.style.backgroundSize = `${32 * state.scale}px ${32 * state.scale}px`;
}

elements.canvas.addEventListener("mousedown", (e) => {
  const node = e.target.closest(".map-node");
  
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  hasMoved = false;

  if (node) {
    draggedNode = node;
    dragInitialLeft = parseFloat(node.style.left) || 0;
    dragInitialTop = parseFloat(node.style.top) || 0;
    
    draggedNode.classList.add("dragging");
    node.style.cursor = "grabbing";
  } else {
    isPanning = true;
    dragInitialPanX = state.panX;
    dragInitialPanY = state.panY;
  }
  
  if (e.target.closest('.expand-btn')) {
    // allow click for expand
  } else {
    e.preventDefault(); // Prevent text selection
  }
});

document.addEventListener("mousemove", (e) => {
  if (draggedNode) {
    const wWidth = elements.workspace.offsetWidth;
    const wHeight = elements.workspace.offsetHeight;
    
    const dx = ((e.clientX - dragStartX) / wWidth / state.scale) * 100;
    const dy = ((e.clientY - dragStartY) / wHeight / state.scale) * 100;
    
    if (Math.abs(e.clientX - dragStartX) > 3 || Math.abs(e.clientY - dragStartY) > 3) {
      hasMoved = true;
      draggedNode.dataset.wasDragged = "true";
    }
    
    draggedNode.style.left = `${dragInitialLeft + dx}%`;
    draggedNode.style.top = `${dragInitialTop + dy}%`;
    
    updateLines();
  } else if (isPanning) {
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasMoved = true;
    }
    
    state.panX = dragInitialPanX + dx;
    state.panY = dragInitialPanY + dy;
    updateWorkspaceTransform();
  }
});

document.addEventListener("mouseup", () => {
  if (draggedNode) {
    draggedNode.classList.remove("dragging");
    draggedNode.style.cursor = "";
    
    if (hasMoved) {
      const isRoot = draggedNode.classList.contains("root");
      const id = draggedNode.dataset.id;
      if (isRoot && state.current) {
        state.current.rootX = parseFloat(draggedNode.style.left);
        state.current.rootY = parseFloat(draggedNode.style.top);
      } else if (state.current && id !== "root" && state.current.nodes[id]) {
        state.current.nodes[id][2] = parseFloat(draggedNode.style.left);
        state.current.nodes[id][3] = parseFloat(draggedNode.style.top);
      }
      saveCurrentResearch(false);
    }
    draggedNode = null;
  }
  
  if (isPanning) {
    isPanning = false;
  }
});

elements.canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const zoomSensitivity = 0.001;
  const delta = -e.deltaY * zoomSensitivity;
  const oldScale = state.scale;
  let newScale = state.scale * Math.exp(delta);
  
  newScale = Math.max(0.2, Math.min(newScale, 3));
  
  // Pan to keep the pointer at the same spot in the workspace
  const canvasRect = elements.canvas.getBoundingClientRect();
  const mouseX = e.clientX - canvasRect.left;
  const mouseY = e.clientY - canvasRect.top;
  
  state.panX = mouseX - (mouseX - state.panX) * (newScale / oldScale);
  state.panY = mouseY - (mouseY - state.panY) * (newScale / oldScale);
  state.scale = newScale;
  
  updateWorkspaceTransform();
});

elements.zoomIn?.addEventListener("click", () => {
  state.scale = Math.min(state.scale * 1.2, 3);
  updateWorkspaceTransform();
});

elements.zoomOut?.addEventListener("click", () => {
  state.scale = Math.max(state.scale / 1.2, 0.2);
  updateWorkspaceTransform();
});

elements.zoomReset?.addEventListener("click", () => {
  state.scale = 1;
  state.panX = 0;
  state.panY = 0;
  updateWorkspaceTransform();
});

// resize observer to update lines on window resize
window.addEventListener("resize", () => {
  if (state.rootElement) updateLines();
});

elements.form.addEventListener("submit", runResearch);
elements.qaForm.addEventListener("submit", askQuestion);
elements.save.addEventListener("click", () => saveCurrentResearch(true));
elements.copy.addEventListener("click", copySummary);
elements.clearHistory.addEventListener("click", () => {
  // Clearing history in the UI only for now, or could call a DELETE endpoint if implemented
  state.history = [];
  renderHistory();
  showToast("History view cleared (database remains on Turso)");
});

elements.modeTabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));

elements.steps.forEach((step) => {
  step.addEventListener("click", () => {
    const target = step.dataset.step;
    const map = {
      scope: ".command-band",
      sources: ".source-panel",
      synthesis: ".insight-panel",
      map: ".map-panel",
    };
    if (map[target]) {
      document.querySelector(map[target]).scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
});

elements.navItems.forEach((item) => {
  item.addEventListener("click", () => {
    elements.navItems.forEach((nav) => nav.classList.remove("active"));
    item.classList.add("active");
    const target = item.dataset.view;
    const map = {
      research: ".command-band",
      sources: ".source-panel",
      insights: ".insight-panel",
      history: ".history-panel",
    };
    document.querySelector(map[target]).scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
async function initClerkInstance() {
  // v4 (loaded via <script> tag): window.Clerk is a constructor
  const c = new window.Clerk(CLERK_KEY);
  await c.load();
  return c;
}

async function ensureAuth() {
  if (clerk && clerk.user) return true;
  if (clerk) { clerk.openSignIn(); return false; }
  showToast("Sign-in unavailable — reload the page and try again.");
  return false;
}

async function initAuth() {
  const userBtnEl = document.getElementById("user-button-container");

  function mountUserBtn() {
    if (!userBtnEl._mounted) {
      userBtnEl.innerHTML = "";
      clerk.mountUserButton(userBtnEl);
      userBtnEl._mounted = true;
    }
  }

  function renderSignInBtn() {
    userBtnEl._mounted = false;
    userBtnEl.innerHTML = `<button class="ghost-button" style="width:100%;font-size:.8rem" id="sidebarSignIn">Sign in</button>`;
    document.getElementById("sidebarSignIn").onclick = () => clerk?.openSignIn();
  }

  if (!window.Clerk) {
    console.warn("Clerk SDK not available — auth disabled");
    await migrateLocalStorage();
    await loadHistory();
    return;
  }

  try {
    clerk = await initClerkInstance();

    if (clerk.user) {
      mountUserBtn();
      await migrateLocalStorage();
      await loadHistory();
    } else {
      renderSignInBtn();
    }

    clerk.addListener(async ({ user }) => {
      if (user) {
        mountUserBtn();
        await loadHistory();
      } else {
        renderSignInBtn();
      }
    });
  } catch (err) {
    console.error("Clerk init error:", err);
    await migrateLocalStorage();
    await loadHistory();
  }
}

setMode("query");
loadResearch({
  id: "welcome",
  topic: "How can AI agents improve product research workflows?",
  depth: "Detailed",
  output: "Mindmap",
  quality: 86,
  root: "AI Research Mindmapper",
  summary: "Submit a search query, URL, YouTube link, or TXT/PDF file to generate a cited research map.",
  nodes: [
    ["Search", "Use Groq Compound web search for broad research.", 8, 11, "web_enriched"],
    ["Evidence", "Upload or ingest sources before synthesis.", 70, 12, "source_grounded"],
    ["Synthesis", "Convert findings into insights and trade-offs.", 8, 58, "ai_synthesized"],
    ["Q&A", "Ask follow-ups against stored evidence first.", 70, 58, "source_grounded"],
    ["Traceability", "Keep source-backed and AI-generated content labeled.", 39, 78, "ai_synthesized"],
  ],
  insights: [
    ["Backend ready", "The UI now calls FastAPI endpoints instead of local mock profiles.", "ai_synthesized"],
    ["Evidence-first answers", "Follow-up questions search stored chunks before web expansion.", "source_grounded"],
  ],
  sources: [],
  tradeoffs: [
    ["Free-tier usage", "Groq is used only when generation or web search is needed.", "ai_synthesized"],
  ],
  createdAt: new Date().toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
}, false);

initAuth();
