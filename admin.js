// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = "https://nomprpckowsogvytofrn.supabase.co";
const SUPABASE_KEY = "sb_publishable_Z6oZ1GrVmzoIQhYj8Kb_dw_fDK3GdgL";
const BUCKET = "resume";

// 올릴 수 있는 파일 종류 (보관함 규칙과 같게)
const IMAGE_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const FILE_TYPES = Object.assign({ "application/pdf": "pdf" }, IMAGE_TYPES);
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_DETAIL = 10; // 자세히 보기 사진은 10장까지

// 짧게 쓰려고 만든 도우미
function $(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(text, className, onClick) {
  const b = el("button", "btn small " + (className || ""), text);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

function showMsg(id, text, isError) {
  const m = $(id);
  m.textContent = text || "";
  m.classList.toggle("error", !!isError);
}

function show(viewId) {
  ["login-view", "denied-view", "admin-view"].forEach(function (id) {
    $(id).classList.toggle("hidden", id !== viewId);
  });
}

// ===== 로그인 정보 (이 브라우저에 저장) =====
let session = null;

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: data.user,
  };
  try {
    localStorage.setItem("resume_admin_session", JSON.stringify(session));
  } catch (e) {}
}

function clearSession() {
  session = null;
  try {
    localStorage.removeItem("resume_admin_session");
  } catch (e) {}
}

function loadSavedSession() {
  try {
    session = JSON.parse(localStorage.getItem("resume_admin_session") || "null");
  } catch (e) {
    session = null;
  }
}

// 이메일·비밀번호로 로그인
async function signIn(email, password) {
  const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email: email, password: password }),
  });
  if (!res.ok) throw new Error("login");
  saveSession(await res.json());
}

// 로그인 시간이 거의 끝났으면 새로 받기
async function ensureFreshToken() {
  if (!session) throw new Error("no session");
  const now = Math.floor(Date.now() / 1000);
  if (session.expires_at - 60 > now) return;

  const res = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=refresh_token", {
    method: "POST",
    headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });
  if (!res.ok) {
    clearSession();
    show("login-view");
    showMsg("login-msg", "로그인 시간이 끝났어요. 다시 로그인해 주세요.", true);
    throw new Error("expired");
  }
  saveSession(await res.json());
}

async function signOut() {
  if (session) {
    await fetch(SUPABASE_URL + "/auth/v1/logout", {
      method: "POST",
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + session.access_token },
    }).catch(function () {});
  }
  clearSession();
  show("login-view");
}

// ===== Supabase 요청 (로그인 토큰을 붙여서) =====
async function api(path, options) {
  await ensureFreshToken();
  options = options || {};
  const headers = Object.assign(
    {
      apikey: SUPABASE_KEY,
      Authorization: "Bearer " + session.access_token,
      "Content-Type": "application/json",
    },
    options.headers
  );
  return fetch(SUPABASE_URL + path, Object.assign({}, options, { headers: headers }));
}

// 표 읽기
async function readRows(path) {
  const res = await api("/rest/v1/" + path);
  if (!res.ok) throw new Error("읽기 실패 " + res.status);
  return res.json();
}

// 고치거나 지운 줄을 돌려받아, 정말 바뀌었는지 확인
async function changeRows(path, method, body) {
  const res = await api("/rest/v1/" + path, {
    method: method,
    headers: { Prefer: "return=representation" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error("저장 실패 " + res.status);
  return res.json();
}

// 카드 하나의 좋아요 수
async function countLikes(projectId) {
  const res = await api("/rest/v1/likes?select=id&project_id=eq." + projectId, {
    method: "HEAD",
    headers: { Prefer: "count=exact" },
  });
  if (!res.ok) return 0;
  const total = parseInt((res.headers.get("content-range") || "").split("/")[1], 10);
  return isNaN(total) ? 0 : total;
}

// ===== 파일 올리기 =====

// 올리기 전에 검사. 문제가 있으면 안내 문구, 없으면 ""
function checkFile(file, allowed) {
  if (!allowed[file.type]) {
    return allowed === IMAGE_TYPES
      ? "이미지 파일(PNG·JPG·WEBP·GIF)만 올릴 수 있어요."
      : "이미지(PNG·JPG·WEBP·GIF)나 PDF 파일만 올릴 수 있어요.";
  }
  if (file.size > MAX_SIZE) {
    return "파일이 10MB보다 커요. 더 작은 파일을 골라 주세요.";
  }
  return "";
}

// 영어·숫자로 새 파일 이름 짓기 (예: projects/20261027-153012-a8k2x9.pdf)
function newFileName(folder, file, allowed) {
  const d = new Date();
  const pad = function (n) { return String(n).padStart(2, "0"); };
  const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" +
    pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
  const rand = Math.random().toString(36).slice(2, 8);
  return folder + "/" + stamp + "-" + rand + "." + allowed[file.type];
}

// 보관함에 올리고 공개 주소를 돌려준다
async function uploadFile(folder, file, allowed) {
  const path = newFileName(folder, file, allowed);
  const res = await api("/storage/v1/object/" + BUCKET + "/" + path, {
    method: "POST",
    headers: { "Content-Type": file.type, "x-upsert": "false" },
    body: file,
  });
  if (!res.ok) throw new Error("올리기 실패 " + res.status);
  return SUPABASE_URL + "/storage/v1/object/public/" + BUCKET + "/" + path;
}

function setPreview(boxId, url) {
  const box = $(boxId);
  box.innerHTML = "";
  if (url) {
    const img = el("img");
    img.src = url;
    img.alt = "";
    img.onerror = function () { img.remove(); };
    box.appendChild(img);
  }
}

function errorText(e) {
  const m = String(e && e.message || "");
  if (m === "expired") return "";
  if (/40[13]/.test(m)) return "권한이 없어요. 관리자 계정으로 로그인했는지 확인해 주세요.";
  return "문제가 생겼어요. 잠시 후 다시 해 주세요.";
}

// ===== 프로필 =====
const PROFILE_FIELDS = [
  "name", "title", "career_badge", "email", "phone", "location",
  "headline", "intro", "education", "skills", "experience", "quote",
];
let profilePhotoUrl = null;
let profileResumeUrl = null;

// 표에 새 칸이 아직 없을 때(400) 보여 줄 안내
const SQL_HINT = "Supabase SQL Editor에서 resume.sql 전체(특히 9·10번)를 실행했는지 확인해 주세요.";
function saveErrorText(e) {
  return /400/.test(String(e && e.message)) ? SQL_HINT : errorText(e);
}

// 숫자로 보는 나: 입력칸 4줄 ↔ [{value, label}]
function fillStats(stats) {
  const list = Array.isArray(stats) ? stats : [];
  for (let i = 0; i < 4; i++) {
    $("st-value-" + i).value = (list[i] && list[i].value) || "";
    $("st-label-" + i).value = (list[i] && list[i].label) || "";
  }
}

function readStats() {
  const list = [];
  for (let i = 0; i < 4; i++) {
    const value = $("st-value-" + i).value.trim();
    const label = $("st-label-" + i).value.trim();
    if (value || label) list.push({ value: value, label: label });
  }
  return list;
}

function renderResumeName() {
  const box = $("resume-name");
  box.innerHTML = "";
  if (profileResumeUrl) {
    const a = el("a", null, profileResumeUrl.split("/").pop());
    a.href = profileResumeUrl;
    a.target = "_blank";
    a.rel = "noopener";
    box.append("지금 파일: ", a);
  } else {
    box.textContent = "없음";
  }
}

async function loadProfile() {
  try {
    const rows = await readRows("profile?id=eq.1&select=*");
    const p = rows[0] || {};
    PROFILE_FIELDS.forEach(function (f) {
      $("pf-" + f).value = p[f] || "";
    });
    profilePhotoUrl = p.photo_url || null;
    setPreview("photo-preview", profilePhotoUrl);
    fillStats(p.stats);
    profileResumeUrl = p.resume_url || null;
    renderResumeName();
  } catch (e) {
    showMsg("profile-msg", "프로필을 불러오지 못했어요. " + errorText(e), true);
  }
}

// id=1 줄이 있으면 고치고, 없으면 새로 만든다
async function saveProfileData(data) {
  const row = Object.assign({ id: 1, updated_at: new Date().toISOString() }, data);
  const res = await api("/rest/v1/profile?on_conflict=id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error("저장 실패 " + res.status);
}

async function saveProfile() {
  const btn = $("profile-save");
  const data = {};
  PROFILE_FIELDS.forEach(function (f) {
    data[f] = $("pf-" + f).value.trim();
  });
  data.stats = readStats();
  btn.disabled = true;
  showMsg("profile-msg", "저장하는 중…");
  try {
    await saveProfileData(data);
    showMsg("profile-msg", "저장했어요. 방문자 화면을 새로고침하면 보여요.");
  } catch (e) {
    showMsg("profile-msg", "저장하지 못했어요. " + saveErrorText(e), true);
  }
  btn.disabled = false;
}

async function onPhotoPicked() {
  const input = $("photo-file");
  const file = input.files[0];
  if (!file) return;
  const problem = checkFile(file, IMAGE_TYPES);
  if (problem) {
    showMsg("photo-msg", problem, true);
    input.value = "";
    return;
  }
  showMsg("photo-msg", "올리는 중…");
  try {
    const url = await uploadFile("profile", file, IMAGE_TYPES);
    await saveProfileData({ photo_url: url });
    profilePhotoUrl = url;
    setPreview("photo-preview", url);
    showMsg("photo-msg", "사진을 바꿨어요.");
  } catch (e) {
    showMsg("photo-msg", "사진을 올리지 못했어요. " + errorText(e), true);
  }
  input.value = "";
}

// 이력서 PDF: 고르면 바로 올리고 저장한다
async function onResumePicked() {
  const input = $("resume-file");
  const file = input.files[0];
  input.value = "";
  if (!file) return;
  const PDF_ONLY = { "application/pdf": "pdf" };
  if (!PDF_ONLY[file.type]) {
    showMsg("resume-msg", "PDF 파일만 올릴 수 있어요.", true);
    return;
  }
  if (file.size > MAX_SIZE) {
    showMsg("resume-msg", "파일이 10MB보다 커요. 더 작은 파일을 골라 주세요.", true);
    return;
  }
  showMsg("resume-msg", "올리는 중…");
  try {
    const url = await uploadFile("profile", file, PDF_ONLY);
    await saveProfileData({ resume_url: url });
    profileResumeUrl = url;
    renderResumeName();
    showMsg("resume-msg", "이력서를 올렸어요.");
  } catch (e) {
    showMsg("resume-msg", "올리지 못했어요. " + saveErrorText(e), true);
  }
}

async function removeResume() {
  if (!profileResumeUrl) return;
  if (!confirm("이력서 PDF를 뺄까요? (방문자 화면의 '이력서 PDF 받기' 버튼이 사라져요)")) return;
  try {
    await saveProfileData({ resume_url: null });
    profileResumeUrl = null;
    renderResumeName();
    showMsg("resume-msg", "이력서를 뺐어요.");
  } catch (e) {
    showMsg("resume-msg", "빼지 못했어요. " + saveErrorText(e), true);
  }
}

async function removePhoto() {
  if (!profilePhotoUrl) return;
  if (!confirm("프로필 사진을 뺄까요? (방문자 화면에는 회색 자리가 보여요)")) return;
  try {
    await saveProfileData({ photo_url: null });
    profilePhotoUrl = null;
    setPreview("photo-preview", null);
    showMsg("photo-msg", "사진을 뺐어요.");
  } catch (e) {
    showMsg("photo-msg", "사진을 빼지 못했어요. " + errorText(e), true);
  }
}

// ===== 포트폴리오 카드 =====
let projects = [];
let likeCounts = {};
// 케이스 스터디 칸 (자세히 보기 창에 나온다)
const CASE_FIELDS = ["period", "my_role", "contribution", "key_result", "problem", "solution", "outcome"];
let editing = null; // 고치는 중인 카드 (새 카드면 { id: null })

async function loadProjects() {
  try {
    projects = await readRows("projects?select=*&order=sort_order.asc,id.asc");
    const counts = await Promise.all(projects.map(function (p) {
      return countLikes(p.id).catch(function () { return 0; });
    }));
    likeCounts = {};
    projects.forEach(function (p, i) { likeCounts[p.id] = counts[i]; });
  } catch (e) {
    showMsg("project-list-msg", "카드를 불러오지 못했어요. " + errorText(e), true);
  }
  renderProjects();
  renderLikes();
}

function thumbBox(url) {
  const box = el("div", "thumb");
  if (url) {
    const img = el("img");
    img.src = url;
    img.alt = "";
    img.onerror = function () { img.remove(); };
    box.appendChild(img);
  }
  return box;
}

function renderProjects() {
  const list = $("project-list");
  list.innerHTML = "";
  if (projects.length === 0) {
    list.appendChild(el("li", "status", "아직 카드가 없어요. '+ 카드 추가'를 눌러 주세요."));
    return;
  }
  projects.forEach(function (p, i) {
    const li = el("li");
    const info = el("div", "info");
    info.appendChild(el("span", "meta", [p.number, p.category].filter(Boolean).join(" · ")));
    info.appendChild(el("strong", null, p.title));
    info.appendChild(el("span", "sub", (p.tags || []).join(", ")));

    const actions = el("div", "actions");
    actions.appendChild(el("span", "like-count", "🌿 " + (likeCounts[p.id] || 0)));
    const up = button("▲ 올리기", "", function () { moveProject(i, -1); });
    const down = button("▼ 내리기", "", function () { moveProject(i, 1); });
    up.disabled = i === 0;
    down.disabled = i === projects.length - 1;
    actions.append(
      up,
      down,
      button("수정", "", function () { openProjectForm(p); }),
      button("삭제", "danger", function () { deleteProject(p); })
    );

    li.append(thumbBox(p.thumbnail_url), info, actions);
    list.appendChild(li);
  });
}

// 순서 바꾸기: 바꾼 뒤 1, 2, 3 … 으로 다시 매긴다
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;
  const order = projects.slice();
  const moved = order.splice(index, 1)[0];
  order.splice(target, 0, moved);

  showMsg("project-list-msg", "순서를 바꾸는 중…");
  try {
    for (let i = 0; i < order.length; i++) {
      if (order[i].sort_order !== i + 1) {
        const rows = await changeRows("projects?id=eq." + order[i].id, "PATCH", { sort_order: i + 1 });
        if (rows.length === 0) throw new Error("403");
      }
    }
    showMsg("project-list-msg", "순서를 바꿨어요.");
  } catch (e) {
    showMsg("project-list-msg", "순서를 바꾸지 못했어요. " + errorText(e), true);
  }
  await loadProjects();
}

async function deleteProject(p) {
  if (!confirm("'" + p.title + "' 카드를 지울까요? 이 카드의 좋아요도 함께 지워져요.")) return;
  try {
    const rows = await changeRows("projects?id=eq." + p.id, "DELETE");
    if (rows.length === 0) throw new Error("403");
    showMsg("project-list-msg", "카드를 지웠어요.");
    if (editing && editing.id === p.id) closeProjectForm();
  } catch (e) {
    showMsg("project-list-msg", "지우지 못했어요. " + errorText(e), true);
  }
  await loadProjects();
}

function renderFileName() {
  const box = $("pj-file-name");
  box.innerHTML = "";
  if (editing.file_url) {
    const a = el("a", null, editing.file_url.split("/").pop());
    a.href = editing.file_url;
    a.target = "_blank";
    a.rel = "noopener";
    box.append("지금 파일: ", a);
  } else {
    box.textContent = "없음";
  }
}

function openProjectForm(p) {
  editing = p
    ? { id: p.id, thumbnail_url: p.thumbnail_url, file_url: p.file_url, detail_images: (p.detail_images || []).slice() }
    : { id: null, thumbnail_url: null, file_url: null, detail_images: [] };
  $("project-form-title").textContent = p ? "카드 수정" : "카드 추가";
  $("pj-number").value = p ? p.number : "";
  $("pj-category").value = p ? p.category : "";
  $("pj-title").value = p ? p.title : "";
  $("pj-description").value = p ? p.description : "";
  $("pj-tags").value = p ? (p.tags || []).join(", ") : "";
  CASE_FIELDS.forEach(function (f) {
    $("pj-" + f).value = (p && p[f]) || "";
  });
  $("pj-thumb-file").value = "";
  $("pj-file-file").value = "";
  $("pj-detail-file").value = "";
  setPreview("pj-thumb-preview", editing.thumbnail_url);
  renderFileName();
  renderDetailImages();
  showMsg("pj-upload-msg", "");
  showMsg("project-msg", "");
  $("project-form").classList.remove("hidden");
  $("project-form").scrollIntoView({ behavior: "smooth", block: "start" });
  $("pj-title").focus({ preventScroll: true });
}

function closeProjectForm() {
  editing = null;
  $("project-form").classList.add("hidden");
}

// 썸네일·첨부 파일을 고르면 바로 올리고, 주소는 '카드 저장'을 누를 때 카드에 들어간다
async function onProjectFilePicked(inputId, allowed, key) {
  const input = $(inputId);
  const file = input.files[0];
  if (!file || !editing) return;
  const problem = checkFile(file, allowed);
  if (problem) {
    showMsg("pj-upload-msg", problem, true);
    input.value = "";
    return;
  }
  showMsg("pj-upload-msg", "올리는 중…");
  try {
    const url = await uploadFile("projects", file, allowed);
    editing[key] = url;
    if (key === "thumbnail_url") setPreview("pj-thumb-preview", url);
    else renderFileName();
    showMsg("pj-upload-msg", "올렸어요. '카드 저장'을 눌러야 카드에 반영돼요.");
  } catch (e) {
    showMsg("pj-upload-msg", "올리지 못했어요. " + errorText(e), true);
  }
  input.value = "";
}

// ----- 자세히 보기 사진 (여러 장) -----
function renderDetailImages() {
  const list = $("pj-detail-list");
  list.innerHTML = "";
  const images = editing.detail_images;
  images.forEach(function (url, i) {
    const li = el("li");
    const box = el("div", "preview");
    box.id = "pj-detail-" + i;
    li.appendChild(box);
    li.appendChild(el("span", "num", String(i + 1)));

    const btns = el("div", "buttons");
    const left = button("◀", "", function () { moveDetailImage(i, -1); });
    const right = button("▶", "", function () { moveDetailImage(i, 1); });
    left.disabled = i === 0;
    right.disabled = i === images.length - 1;
    left.setAttribute("aria-label", (i + 1) + "번 사진 앞으로");
    right.setAttribute("aria-label", (i + 1) + "번 사진 뒤로");
    const remove = button("빼기", "danger", function () { removeDetailImage(i); });
    btns.append(left, right, remove);
    li.appendChild(btns);
    list.appendChild(li);
    setPreview(box.id, url);
  });
}

function moveDetailImage(i, step) {
  const images = editing.detail_images;
  const j = i + step;
  if (j < 0 || j >= images.length) return;
  const tmp = images[i];
  images[i] = images[j];
  images[j] = tmp;
  renderDetailImages();
}

function removeDetailImage(i) {
  if (!confirm((i + 1) + "번 사진을 뺄까요? ('카드 저장'을 눌러야 반영돼요)")) return;
  editing.detail_images.splice(i, 1);
  renderDetailImages();
}

async function onDetailImagesPicked() {
  const input = $("pj-detail-file");
  const files = Array.prototype.slice.call(input.files);
  input.value = "";
  if (!files.length || !editing) return;

  const room = MAX_DETAIL - editing.detail_images.length;
  if (room <= 0) {
    showMsg("pj-upload-msg", "자세히 보기 사진은 " + MAX_DETAIL + "장까지 넣을 수 있어요.", true);
    return;
  }

  const problems = [];
  const ok = [];
  files.forEach(function (f) {
    const problem = checkFile(f, IMAGE_TYPES);
    if (problem) problems.push(f.name + ": " + problem);
    else ok.push(f);
  });
  if (ok.length > room) {
    problems.push(MAX_DETAIL + "장까지라서 " + (ok.length - room) + "장은 빼고 올렸어요.");
    ok.length = room;
  }

  let done = 0;
  for (const f of ok) {
    showMsg("pj-upload-msg", "올리는 중… (" + (done + 1) + " / " + ok.length + ")");
    try {
      const url = await uploadFile("projects", f, IMAGE_TYPES);
      editing.detail_images.push(url);
      done++;
      renderDetailImages();
    } catch (e) {
      problems.push(f.name + ": 올리지 못했어요. " + errorText(e));
    }
  }

  const head = done ? done + "장을 올렸어요. '카드 저장'을 눌러야 카드에 반영돼요." : "";
  showMsg("pj-upload-msg", [head].concat(problems).filter(Boolean).join(" / "), problems.length > 0);
}

async function saveProject() {
  const title = $("pj-title").value.trim();
  if (!title) {
    showMsg("project-msg", "제목을 적어 주세요.", true);
    $("pj-title").focus();
    return;
  }
  const data = {
    number: $("pj-number").value.trim(),
    category: $("pj-category").value.trim(),
    title: title,
    description: $("pj-description").value.trim(),
    tags: $("pj-tags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean),
    thumbnail_url: editing.thumbnail_url,
    file_url: editing.file_url,
    detail_images: editing.detail_images,
  };
  CASE_FIELDS.forEach(function (f) {
    data[f] = $("pj-" + f).value.trim();
  });

  const btn = $("project-save");
  btn.disabled = true;
  showMsg("project-msg", "저장하는 중…");
  try {
    let rows;
    if (editing.id) {
      rows = await changeRows("projects?id=eq." + editing.id, "PATCH", data);
    } else {
      const last = projects.reduce(function (m, p) { return Math.max(m, p.sort_order); }, 0);
      data.sort_order = last + 1;
      rows = await changeRows("projects", "POST", data);
    }
    if (rows.length === 0) throw new Error("403");
    closeProjectForm();
    showMsg("project-list-msg", "카드를 저장했어요.");
    await loadProjects();
  } catch (e) {
    showMsg("project-msg", "저장하지 못했어요. " + saveErrorText(e), true);
  }
  btn.disabled = false;
}

// ===== 좋아요 =====
function renderLikes() {
  const list = $("like-list");
  list.innerHTML = "";
  if (projects.length === 0) {
    list.appendChild(el("li", "status", "카드가 없어요."));
    return;
  }
  projects.forEach(function (p) {
    const li = el("li");
    const info = el("div", "info");
    info.appendChild(el("span", "meta", [p.number, p.category].filter(Boolean).join(" · ")));
    info.appendChild(el("strong", null, p.title));

    const actions = el("div", "actions");
    const reset = button("좋아요 초기화", "danger", function () { resetLikes(p); });
    reset.disabled = !likeCounts[p.id];
    actions.append(el("span", "like-count", "🌿 " + (likeCounts[p.id] || 0)), reset);

    li.append(info, actions);
    list.appendChild(li);
  });
}

async function resetLikes(p) {
  if (!confirm("'" + p.title + "' 카드의 좋아요 " + likeCounts[p.id] + "개를 모두 지울까요?")) return;
  try {
    await changeRows("likes?project_id=eq." + p.id, "DELETE");
    showMsg("like-msg", "'" + p.title + "' 좋아요를 초기화했어요.");
  } catch (e) {
    showMsg("like-msg", "초기화하지 못했어요. " + errorText(e), true);
  }
  await loadProjects();
}

// ===== 방명록 =====
function formatDate(iso) {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

async function loadGuestbook() {
  const list = $("guest-admin-list");
  let rows;
  try {
    rows = await readRows("resume_guestbook?select=*&order=created_at.desc");
  } catch (e) {
    list.innerHTML = "";
    showMsg("guest-msg", "방명록을 불러오지 못했어요. " + errorText(e), true);
    return;
  }
  list.innerHTML = "";
  if (rows.length === 0) {
    list.appendChild(el("li", "status", "방명록 글이 없어요."));
    return;
  }
  rows.forEach(function (r) {
    const li = el("li");
    const info = el("div", "info");
    info.appendChild(el("strong", null, r.nickname));
    info.appendChild(el("span", "sub", formatDate(r.created_at)));
    info.appendChild(el("p", "guest-msg", r.message));
    const actions = el("div", "actions");
    actions.appendChild(button("삭제", "danger", function () { deleteGuest(r); }));
    li.append(info, actions);
    list.appendChild(li);
  });
}

async function deleteGuest(r) {
  if (!confirm("'" + r.nickname + "'님의 글을 지울까요?")) return;
  try {
    const rows = await changeRows("resume_guestbook?id=eq." + r.id, "DELETE");
    if (rows.length === 0) throw new Error("403");
    showMsg("guest-msg", "글을 지웠어요.");
  } catch (e) {
    showMsg("guest-msg", "지우지 못했어요. " + errorText(e), true);
  }
  await loadGuestbook();
}

// ===== 시작: 로그인했는지, 관리자인지 확인 =====
async function isAdmin() {
  const rows = await readRows("admins?select=user_id&user_id=eq." + session.user.id);
  return rows.length > 0;
}

async function enter() {
  try {
    if (!(await isAdmin())) {
      show("denied-view");
      return;
    }
  } catch (e) {
    if (e.message !== "expired") {
      clearSession();
      show("login-view");
      showMsg("login-msg", "확인하지 못했어요. 다시 로그인해 주세요.", true);
    }
    return;
  }
  $("who").textContent = session.user.email;
  show("admin-view");
  loadProfile();
  loadProjects();
  loadGuestbook();
}

async function onLogin() {
  const email = $("login-email").value.trim();
  const password = $("login-password").value;
  if (!email || !password) {
    showMsg("login-msg", "이메일과 비밀번호를 적어 주세요.", true);
    return;
  }
  const btn = $("login-button");
  btn.disabled = true;
  showMsg("login-msg", "로그인하는 중…");
  try {
    await signIn(email, password);
    $("login-password").value = "";
    showMsg("login-msg", "");
    await enter();
  } catch (e) {
    showMsg("login-msg", "이메일이나 비밀번호가 맞지 않아요.", true);
  }
  btn.disabled = false;
}

$("login-button").addEventListener("click", onLogin);
$("login-password").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.isComposing) onLogin();
});
$("logout-button").addEventListener("click", signOut);
$("denied-logout").addEventListener("click", signOut);

$("profile-save").addEventListener("click", saveProfile);
$("photo-file").addEventListener("change", onPhotoPicked);
$("photo-remove").addEventListener("click", removePhoto);
$("resume-file").addEventListener("change", onResumePicked);
$("resume-remove").addEventListener("click", removeResume);

$("project-new").addEventListener("click", function () { openProjectForm(null); });
$("project-cancel").addEventListener("click", closeProjectForm);
$("project-save").addEventListener("click", saveProject);
$("pj-thumb-file").addEventListener("change", function () {
  onProjectFilePicked("pj-thumb-file", IMAGE_TYPES, "thumbnail_url");
});
$("pj-file-file").addEventListener("change", function () {
  onProjectFilePicked("pj-file-file", FILE_TYPES, "file_url");
});
$("pj-detail-file").addEventListener("change", onDetailImagesPicked);
$("pj-thumb-remove").addEventListener("click", function () {
  if (!editing || !editing.thumbnail_url) return;
  if (!confirm("썸네일을 뺄까요? ('카드 저장'을 눌러야 반영돼요)")) return;
  editing.thumbnail_url = null;
  setPreview("pj-thumb-preview", null);
});
$("pj-file-remove").addEventListener("click", function () {
  if (!editing || !editing.file_url) return;
  if (!confirm("첨부 파일을 뺄까요? ('카드 저장'을 눌러야 반영돼요)")) return;
  editing.file_url = null;
  renderFileName();
});

loadSavedSession();
if (session && session.access_token) {
  enter();
} else {
  show("login-view");
}
