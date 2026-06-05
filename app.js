// ===== Global State =====
let articles = [];
let categories = [];
let settings = {};
let isAdmin = false;
let currentArticleId = null;
let editingArticleId = null;

// ===== Init =====
document.addEventListener("DOMContentLoaded", () => {
  loadSettings();
  loadCategories();
  loadArticles();
  bindEvents();
});

function bindEvents() {
  // 移动端默认收起侧边栏
  if (window.innerWidth <= 768) {
    document.getElementById("sidebar").classList.add("closed");
  }

  const si = document.getElementById("searchInput");
  si.addEventListener("input", onSearchInput);
  si.addEventListener("focus", onSearchInput);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-box")) {
      document.getElementById("searchResults").classList.add("hidden");
    }
  });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "k") { e.preventDefault(); si.focus(); }
    // Ctrl+S 保存草稿
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); saveArticle(true); }
  });

  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("closed");
  });

  document.getElementById("btnLogin").addEventListener("click", () => openModal("loginModal"));
  document.getElementById("btnLogout").addEventListener("click", doLogout);
  document.getElementById("btnNewArticle").addEventListener("click", () => openEditor());
  document.getElementById("btnManageCat").addEventListener("click", openCatModal);
  document.getElementById("btnSettings").addEventListener("click", openSettingsModal);

  document.getElementById("btnEditArticle").addEventListener("click", () => {
    const art = articles.find(a => a.id === currentArticleId);
    if (art) openEditor(art);
  });
  document.getElementById("btnDeleteArticle").addEventListener("click", () => {
    confirmDelete("确定要删除这篇文章吗？删除后不可恢复。", () => deleteArticle(currentArticleId));
  });

  // 编辑器工具栏按钮
  document.querySelectorAll(".toolbar-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cmd = btn.getAttribute("data-cmd");
      execToolbarCmd(cmd);
    });
  });

  // Ctrl+B / Ctrl+I 快捷键
  const artContent = document.getElementById("artContent");
  if (artContent) {
    artContent.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "b") { e.preventDefault(); execToolbarCmd("bold"); }
      if ((e.ctrlKey || e.metaKey) && e.key === "i") { e.preventDefault(); execToolbarCmd("italic"); }
    });
  }
}

// ===== API =====
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(path, opts);
  return res.json();
}

// ===== Load Data =====
async function loadSettings() {
  settings = await api("GET", "/api/settings");
  const name = settings.siteName || "实验室知识库";
  document.getElementById("siteTitle").textContent = name;
  document.getElementById("welcomeTitle").textContent = "欢迎访问 " + name;
}

async function loadCategories() {
  categories = await api("GET", "/api/categories");
  renderTree();
  populateCatSelect();
}

async function loadArticles() {
  articles = await api("GET", "/api/articles");
  renderTree();
  renderRecent();
}

// ===== Tree View =====
function renderTree() {
  const tree = document.getElementById("treeView");
  if (categories.length === 0 && articles.length === 0) {
    tree.innerHTML = '<div class="tree-empty">暂无内容<br/>管理员请点击顶部「＋新建」添加</div>';
    return;
  }
  let html = "";
  categories.forEach(cat => {
    const children = articles.filter(a => a.categoryId === cat.id);
    html += '<div class="tree-item">';
    html += '<div class="tree-cat" onclick="toggleCat(\'' + cat.id + '\')">';
    html += '<span class="tree-arrow" id="arrow-' + cat.id + '">&#9654;</span>';
    html += '<span>' + escHtml(cat.name) + '</span>';
    html += '<span style="margin-left:auto;font-size:11px;color:#999">' + children.length + '</span>';
    html += '</div>';
    html += '<div class="tree-children" id="children-' + cat.id + '">';
    if (children.length === 0) {
      html += '<div class="tree-art" style="color:#bbb;font-size:12px;padding:5px 10px 5px 24px;">暂无文章</div>';
    } else {
      children.forEach(art => {
        const icon = art.type === "code" ? "⟨⟩" : art.type === "link" ? "🔗" : art.type === "file" ? "📎" : "📄";
        const active = art.id === currentArticleId ? " active" : "";
        html += '<div class="tree-art' + active + '" onclick="openArticle(\'' + art.id + '\')">';
        html += '<span class="tree-art-icon">' + icon + '</span>';
        html += '<span>' + escHtml(art.title) + '</span>';
        html += '</div>';
      });
    }
    html += '</div></div>';
  });
  tree.innerHTML = html;
}

function toggleCat(catId) {
  const el = document.getElementById("children-" + catId);
  const arrow = document.getElementById("arrow-" + catId);
  if (el.style.display === "block") {
    el.style.display = "none";
    arrow.classList.remove("open");
  } else {
    el.style.display = "block";
    arrow.classList.add("open");
  }
}

// ===== Recent =====
function renderRecent() {
  const list = document.getElementById("recentList");
  const sorted = [...articles].sort((a, b) => (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || ""));
  const recent = sorted.slice(0, 6);
  if (recent.length === 0) { list.innerHTML = ""; return; }
  let html = '<h3 style="font-size:15px;margin-bottom:12px;color:#666">最近更新</h3>';
  recent.forEach(a => {
    const d = (a.updatedAt || a.createdAt || "").slice(0, 10);
    const cat = categories.find(c => c.id === a.categoryId);
    html += '<div class="recent-item" onclick="openArticle(\'' + a.id + '\')">';
    html += '<div class="ri-title">' + escHtml(a.title) + '</div>';
    html += '<div class="ri-meta">' + d + ' · ' + (cat ? cat.name : '未分类') + '</div>';
    html += '</div>';
  });
  list.innerHTML = html;
}

// ===== Open Article =====
function openArticle(id) {
  const art = articles.find(a => a.id === id);
  if (!art) return;
  currentArticleId = id;
  hideAllViews();
  document.getElementById("articleView").classList.remove("hidden");
  document.getElementById("articleTitle").textContent = art.title;

  const cat = categories.find(c => c.id === art.categoryId);
  let bread = "";
  if (cat) {
    bread += '<span onclick="goHome()">首页</span><span class="sep">/</span>';
    bread += '<span>' + escHtml(cat.name) + '</span><span class="sep">/</span>';
  }
  bread += '<span>' + escHtml(art.title) + '</span>';
  document.getElementById("articleBreadcrumb").innerHTML = bread;

  document.getElementById("articleActions").classList.toggle("hidden", !isAdmin);

  const d = (art.updatedAt || art.createdAt || "").slice(0, 10);
  document.getElementById("articleMeta").textContent = "更新于 " + d + " · " + (cat ? cat.name : "未分类");

  const body = document.getElementById("articleBody");
  if (art.type === "article") {
    body.innerHTML = renderMarkdown(art.content || "");
  } else if (art.type === "code") {
    const code = (art.content || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    body.innerHTML = "<pre><code>" + code + '<button class="code-copy-btn" onclick="copyCode(this)">复制</button></code></pre>';
  } else if (art.type === "link") {
    body.innerHTML = '<a href="' + escHtml(art.linkUrl || "") + '" target="_blank" class="link-block">' +
      '<span style="font-size:20px">🔗</span><span>' + escHtml(art.linkUrl || "链接") + "</span></a>";
  } else if (art.type === "file") {
    const fname = art.fileName || "文件";
    body.innerHTML = '<div class="file-block" onclick="downloadFile(\'' + art.id + '\')">' +
      '<span class="file-icon">📎</span><div class="file-info"><div class="file-name">' + escHtml(fname) + "</div>" +
      '<div class="file-size">点击下载</div></div></div>';
  }
  renderTree();
}

function goHome() {
  currentArticleId = null;
  hideAllViews();
  document.getElementById("welcomeView").classList.remove("hidden");
  renderTree();
}

function hideAllViews() {
  document.getElementById("welcomeView").classList.add("hidden");
  document.getElementById("articleView").classList.add("hidden");
  document.getElementById("editorView").classList.add("hidden");
}

// ===== Editor =====
function openEditor(article) {
  editingArticleId = article ? article.id : null;
  hideAllViews();
  document.getElementById("editorView").classList.remove("hidden");

  // 更新按钮文字
  document.getElementById("btnPublish").textContent = article ? "保存修改" : "发布文章";

  // 填充数据
  document.getElementById("artTitle").value = article ? article.title : "";
  document.getElementById("artSummary").value = article ? (article.summary || "") : "";
  document.getElementById("artContent").value = (article && article.type === "article") ? (article.content || "") : "";

  // 分类选择
  const sel = document.getElementById("artCategory");
  if (sel && article) sel.value = article.categoryId || "";

  // 切换到写文章 tab
  switchEditorTab("write");

  // 更新状态
  document.getElementById("editorStatus").textContent = article ? "编辑模式" : "草稿";
}

function closeEditor() {
  editingArticleId = null;
  hideAllViews();
  if (currentArticleId) {
    document.getElementById("articleView").classList.remove("hidden");
  } else {
    document.getElementById("welcomeView").classList.remove("hidden");
  }
}

function switchEditorTab(tab) {
  const tabWrite = document.getElementById("tabWrite");
  const tabPreview = document.getElementById("tabPreview");
  const writeArea = document.getElementById("editorWrite");
  const previewArea = document.getElementById("editorPreview");

  if (tab === "write") {
    tabWrite.classList.add("active");
    tabPreview.classList.remove("active");
    writeArea.classList.remove("hidden");
    previewArea.classList.add("hidden");
  } else {
    tabWrite.classList.remove("active");
    tabPreview.classList.add("active");
    writeArea.classList.add("hidden");
    previewArea.classList.remove("hidden");
    // 渲染预览
    const content = document.getElementById("artContent").value;
    previewArea.innerHTML = renderMarkdown(content);
  }
}

function previewArticle() {
  switchEditorTab("preview");
}

// ===== Toolbar Commands =====
function execToolbarCmd(cmd) {
  const ta = document.getElementById("artContent");
  if (!ta) return;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = ta.value.substring(start, end);
  let before = "";
  let after = "";
  let newCursorPos = start;

  switch (cmd) {
    case "bold":
      before = "**"; after = "**";
      if (!selected) { after = "**加粗文字**"; newCursorPos = start + 2; }
      break;
    case "italic":
      before = "*"; after = "*";
      if (!selected) { after = "*斜体文字*"; newCursorPos = start + 1; }
      break;
    case "strike":
      before = "~~"; after = "~~";
      if (!selected) { after = "~~删除线~~"; newCursorPos = start + 2; }
      break;
    case "h1":
      before = "# "; after = "\n";
      break;
    case "h2":
      before = "## "; after = "\n";
      break;
    case "h3":
      before = "### "; after = "\n";
      break;
    case "ul":
      before = "- "; after = "\n";
      break;
    case "ol":
      before = "1. "; after = "\n";
      break;
    case "quote":
      before = "> "; after = "\n";
      break;
    case "code":
      before = "`"; after = "`";
      if (!selected) { after = "`代码`"; newCursorPos = start + 1; }
      break;
    case "codeblock":
      before = "\n```\n"; after = "\n```\n";
      if (!selected) { after = "\n```\n代码内容\n```\n"; newCursorPos = start + 4; }
      break;
    case "link":
      if (selected) {
        before = "["; after = "]()";
      } else {
        const linkText = prompt("链接文字：", "链接文字");
        const linkUrl = prompt("链接地址：", "https://");
        if (linkText && linkUrl) {
          ta.setRangeText("[" + linkText + "](" + linkUrl + ")", start, end, "end");
        }
        return;
      }
      break;
    case "image":
      const imgUrl = prompt("图片地址：", "https://");
      if (imgUrl) {
        ta.setRangeText("![](" + imgUrl + ")", start, end, "end");
      }
      return;
    case "table":
      const tableMd = "\n| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n";
      ta.setRangeText(tableMd, start, end, "end");
      return;
    case "hr":
      before = "\n---\n";
      break;
  }

  if (selected) {
    ta.setRangeText(before + selected + after, start, end, "end");
    newCursorPos = start + before.length + selected.length + after.length;
  } else {
    ta.setRangeText(before + after, start, end, "end");
    ta.focus();
    ta.setSelectionRange(newCursorPos, newCursorPos);
    return;
  }

  ta.focus();
  ta.setSelectionRange(newCursorPos, newCursorPos);
}

// ===== Save Article =====
async function saveArticle(isDraft) {
  const title = document.getElementById("artTitle").value.trim();
  const categoryId = document.getElementById("artCategory").value;
  const summary = document.getElementById("artSummary").value.trim();
  const content = document.getElementById("artContent").value;

  if (!title) { alert("请输入文章标题"); return; }
  if (!categoryId) { alert("请选择文章分类"); return; }

  const body = {
    title,
    categoryId,
    type: "article",
    summary,
    content
  };

  document.getElementById("btnPublish").disabled = true;
  document.getElementById("editorStatus").textContent = "保存中...";

  try {
    if (editingArticleId) {
      await api("PUT", "/api/articles/" + editingArticleId, body);
      document.getElementById("editorStatus").textContent = "已保存";
    } else {
      const res = await api("POST", "/api/articles", body);
      if (res.success) {
        editingArticleId = res.article.id;
        document.getElementById("btnPublish").textContent = "保存修改";
        document.getElementById("editorStatus").textContent = "已发布";
      }
    }
  } catch (e) {
    document.getElementById("editorStatus").textContent = "保存失败";
    alert("保存失败：" + e.message);
  }

  document.getElementById("btnPublish").disabled = false;
  await loadArticles();

  // 如果不是草稿，3秒后返回
  if (!isDraft) {
    setTimeout(() => {
      if (editingArticleId) {
        openArticle(editingArticleId);
      } else {
        closeEditor();
      }
    }, 1000);
  }
}

// ===== Delete Article =====
async function deleteArticle(id) {
  await api("DELETE", "/api/articles/" + id);
  if (currentArticleId === id) goHome();
  await loadArticles();
}

// ===== Markdown Renderer =====
function renderMarkdown(text) {
  if (!text) return "";
  let html = text;
  // Code blocks
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return "<pre><code>" + escaped + '<button class="code-copy-btn" onclick="copyCode(this)">复制</button></code></pre>';
  });
  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');
  // Lists
  html = html.replace(/^- (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>");
  // Paragraphs (lines not starting with HTML tags)
  html = html.replace(/^(?![<\[\-\#>]|\|).+$/gm, "<p>$&</p>");
  // Blockquote
  html = html.replace(/^> (.+)$/gm, "<blockquote>$1</blockquote>");
  // HR
  html = html.replace(/^---$/gm, "<hr>");
  return html;
}

function copyCode(btn) {
  const code = btn.parentElement.textContent.replace("复制", "").trim();
  navigator.clipboard.writeText(code).then(() => {
    btn.textContent = "已复制";
    setTimeout(() => btn.textContent = "复制", 1500);
  });
}

function downloadFile(artId) {
  const art = articles.find(a => a.id === artId);
  if (!art || !art.fileData) return;
  const a = document.createElement("a");
  a.href = art.fileData;
  a.download = art.fileName || "download";
  a.click();
}

// ===== Search =====
function onSearchInput() {
  const q = document.getElementById("searchInput").value.trim().toLowerCase();
  const box = document.getElementById("searchResults");
  if (!q) { box.classList.add("hidden"); return; }
  const results = articles.filter(a =>
    a.title.toLowerCase().includes(q) || (a.summary || "").toLowerCase().includes(q)
  );
  if (results.length === 0) {
    box.innerHTML = '<div class="search-empty">没有找到相关内容</div>';
    box.classList.remove("hidden");
    return;
  }
  box.innerHTML = results.map(a => {
    const cat = categories.find(c => c.id === a.categoryId);
    const title = highlightMatch(a.title, q);
    const catName = cat ? cat.name : "未分类";
    const summary = a.summary ? " · " + a.summary.slice(0, 40) : "";
    return '<div class="search-item" onclick="openArticle(\'' + a.id + '\');closeSearch()">' +
      '<div class="si-title">' + title + '</div>' +
      '<div class="si-cat">' + catName + summary + "</div></div>";
  }).join("");
  box.classList.remove("hidden");
}

function closeSearch() {
  document.getElementById("searchResults").classList.add("hidden");
}

function highlightMatch(text, q) {
  if (!q) return escHtml(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return escHtml(text);
  return escHtml(text.slice(0, idx)) + "<strong>" + escHtml(text.slice(idx, idx + q.length)) + "</strong>" + escHtml(text.slice(idx + q.length));
}

// ===== Login =====
async function doLogin() {
  const user = document.getElementById("loginUser").value;
  const pass = document.getElementById("loginPass").value;
  const res = await api("POST", "/api/login", { username: user, password: pass });
  if (res.success) {
    isAdmin = true;
    localStorage.setItem("labwiki_admin", "1");
    updateAdminUI();
    closeModal("loginModal");
    document.getElementById("loginUser").value = "";
    document.getElementById("loginPass").value = "";
  } else {
    document.getElementById("loginError").textContent = res.error || "登录失败";
    document.getElementById("loginError").classList.remove("hidden");
  }
}

function doLogout() {
  isAdmin = false;
  localStorage.removeItem("labwiki_admin");
  updateAdminUI();
}

function updateAdminUI() {
  document.getElementById("btnLogin").classList.toggle("hidden", isAdmin);
  document.getElementById("btnLogout").classList.toggle("hidden", !isAdmin);
  document.getElementById("btnNewArticle").classList.toggle("hidden", !isAdmin);
  document.getElementById("btnManageCat").classList.toggle("hidden", !isAdmin);
  document.getElementById("btnSettings").classList.toggle("hidden", !isAdmin);
  document.getElementById("articleActions").classList.toggle("hidden", !isAdmin || !currentArticleId);
}

// ===== Category Management =====
async function openCatModal() {
  await loadCategories();
  renderCatList();
  openModal("catModal");
}

function renderCatList() {
  const list = document.getElementById("catList");
  list.innerHTML = categories.map(cat => {
    const count = articles.filter(a => a.categoryId === cat.id).length;
    return '<div class="cat-item">' +
      '<span class="ci-name">' + escHtml(cat.name) + ' <span style="color:#999;font-size:12px">(' + count + '篇)</span></span>' +
      '<span class="ci-actions">' +
      '<button onclick="renameCat(\'' + cat.id + '\')">重命名</button>' +
      '<button class="del-btn" onclick="confirmDeleteCat(\'' + cat.id + "','" + escHtml(cat.name) + "')\">删除</button>" +
      "</span></div>";
  }).join("");
}

function confirmDeleteCat(id, name) {
  confirmDelete("确定删除分类「" + name + "」？该分类下的文章将同时被删除。", () => deleteCat(id));
}

async function addCategory() {
  const name = document.getElementById("newCatName").value.trim();
  if (!name) return;
  await api("POST", "/api/categories", { name });
  document.getElementById("newCatName").value = "";
  await loadCategories();
  renderCatList();
}

async function renameCat(id) {
  const cat = categories.find(c => c.id === id);
  if (!cat) return;
  const newName = prompt("输入新名称：", cat.name);
  if (!newName || !newName.trim()) return;
  await api("PUT", "/api/categories/" + id, { name: newName.trim() });
  await loadCategories();
  renderCatList();
}

async function deleteCat(id) {
  await api("DELETE", "/api/categories/" + id);
  await loadCategories();
  await loadArticles();
  renderCatList();
}

function populateCatSelect() {
  const sel = document.getElementById("artCategory");
  if (!sel) return;
  sel.innerHTML = '<option value="">-- 请选择分类 --</option>' +
    categories.map(c => '<option value="' + c.id + '">' + escHtml(c.name) + "</option>").join("");
}

// ===== Settings =====
async function openSettingsModal() {
  await loadSettings();
  document.getElementById("setSiteName").value = settings.siteName || "";
  document.getElementById("setAdminUser").value = settings.adminUser || "admin302";
  document.getElementById("setAdminPass").value = "";
  openModal("settingsModal");
}

async function saveSettings() {
  const body = {
    siteName: document.getElementById("setSiteName").value.trim(),
    adminUser: document.getElementById("setAdminUser").value.trim(),
  };
  const pass = document.getElementById("setAdminPass").value;
  if (pass) body.adminPass = pass;
  await api("PUT", "/api/settings", body);
  closeModal("settingsModal");
  await loadSettings();
}

// ===== Modal Helpers =====
function openModal(id) { document.getElementById(id).classList.remove("hidden"); }
function closeModal(id) { document.getElementById(id).classList.add("hidden"); }

let confirmCallback = null;
function confirmDelete(msg, cb) {
  document.getElementById("confirmMsg").textContent = msg;
  confirmCallback = cb;
  openModal("confirmModal");
  document.getElementById("confirmOk").onclick = () => {
    closeModal("confirmModal");
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
  };
}

// ===== Utils =====
function escHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Enter to login
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !document.getElementById("loginModal").classList.contains("hidden")) {
    if (document.activeElement.tagName === "INPUT") doLogin();
  }
});

// Check login state
if (localStorage.getItem("labwiki_admin") === "1") {
  isAdmin = true;
  updateAdminUI();
}
