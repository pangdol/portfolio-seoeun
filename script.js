// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = "https://nomprpckowsogvytofrn.supabase.co";
const SUPABASE_KEY = "sb_publishable_Z6oZ1GrVmzoIQhYj8Kb_dw_fDK3GdgL";

// Supabase에 보낼 기본 머리글
function headers(extra) {
  return Object.assign(
    { apikey: SUPABASE_KEY, "Content-Type": "application/json" },
    extra
  );
}

// 표에서 읽기 (예: "projects?select=*")
async function readTable(path) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + path, { headers: headers() });
  if (!res.ok) throw new Error("읽기 실패: " + res.status);
  return res.json();
}

// 표에 한 줄 넣기
async function insertRow(table, row, returnRow) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + table, {
    method: "POST",
    headers: headers({ Prefer: returnRow ? "return=representation" : "return=minimal" }),
    body: JSON.stringify(row),
  });
  return res;
}

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

// ===== 시간 따라 바뀌는 바탕색 =====
// 아침 5~10시, 낮 10~17시, 저녁 17~20시, 밤 20~5시.
// 주소 뒤에 ?time=night 처럼 붙이면 그 시간대로 미리 볼 수 있다.
function timeOfDay() {
  const asked = new URLSearchParams(location.search).get("time");
  if (["morning", "day", "evening", "night"].includes(asked)) return asked;
  const h = new Date().getHours();
  if (h >= 5 && h < 10) return "morning";
  if (h >= 10 && h < 17) return "day";
  if (h >= 17 && h < 20) return "evening";
  return "night";
}

document.documentElement.dataset.time = timeOfDay();

// ===== 스크롤하면 하나씩 떠오르기 =====
const MOTION_OK =
  "IntersectionObserver" in window &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

if (MOTION_OK) document.documentElement.classList.add("motion-ok");

const revealObserver = MOTION_OK
  ? new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        const node = entry.target;
        node.classList.add("is-visible");
        revealObserver.unobserve(node);
        // 다 떠오르면 표시를 떼어, 마우스를 올렸을 때의 움직임이 원래대로 빠르게
        node.addEventListener("transitionend", function done() {
          node.classList.remove("reveal", "is-visible");
          node.style.transitionDelay = "";
          node.removeEventListener("transitionend", done);
        });
      });
    }, { threshold: 0.12 })
  : null;

// 같이 넘긴 것들은 0.08초씩 차례로 떠오른다
function reveal(nodes) {
  if (!revealObserver) return;
  Array.prototype.forEach.call(nodes, function (node, i) {
    node.classList.add("reveal");
    node.style.transitionDelay = (i % 4) * 0.08 + "s";
    revealObserver.observe(node);
  });
}

// ===== 이 브라우저의 아이디와 좋아요 기록 =====
function getClientId() {
  let id = null;
  try {
    id = localStorage.getItem("resume_client_id");
  } catch (e) {}
  if (!id) {
    id = window.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
    try {
      localStorage.setItem("resume_client_id", id);
    } catch (e) {}
  }
  return id;
}

function getLikedIds() {
  try {
    return JSON.parse(localStorage.getItem("resume_liked") || "[]");
  } catch (e) {
    return [];
  }
}

function saveLikedId(projectId) {
  const list = getLikedIds();
  if (!list.includes(projectId)) list.push(projectId);
  try {
    localStorage.setItem("resume_liked", JSON.stringify(list));
  } catch (e) {}
}

const CLIENT_ID = getClientId();

// ===== 프로필 =====
async function loadProfile() {
  let p;
  try {
    const rows = await readTable("profile?id=eq.1&select=*");
    p = rows[0];
  } catch (e) {
    $("profile-headline").textContent = "프로필을 불러오지 못했어요.";
    return;
  }
  if (!p) return;

  // 사진 (없으면 회색 자리 그대로)
  if (p.photo_url) {
    const img = el("img");
    img.src = p.photo_url;
    img.alt = p.name + " 프로필 사진";
    img.onerror = function () { img.remove(); };
    $("profile-photo").appendChild(img);
  }

  $("profile-name").textContent = p.name;
  $("profile-title").textContent = p.title;
  $("profile-badge").textContent = p.career_badge;

  $("contact-name").textContent = p.name;
  $("contact-email").textContent = p.email;
  $("contact-phone").textContent = p.phone;
  $("contact-location").textContent = p.location;

  // 한 줄 소개: 이름 부분에만 파란 밑줄
  const headline = $("profile-headline");
  headline.textContent = "";
  const at = p.name ? p.headline.indexOf(p.name) : -1;
  if (at === -1) {
    headline.textContent = p.headline;
  } else {
    headline.append(p.headline.slice(0, at));
    headline.appendChild(el("span", "name-mark", p.name));
    headline.append(p.headline.slice(at + p.name.length));
  }

  $("profile-intro").textContent = p.intro;
  $("profile-education").textContent = p.education;
  $("profile-skills").textContent = p.skills;
  $("profile-experience").textContent = p.experience;
  $("profile-quote").textContent = p.quote;

  if (p.name) document.title = p.name + " | Portfolio";
}

// ===== 포트폴리오 카드 =====

// 카드 하나의 좋아요 수 (줄 수만 세어 옴)
async function countLikes(projectId) {
  const res = await fetch(
    SUPABASE_URL + "/rest/v1/likes?select=id&project_id=eq." + projectId,
    { method: "HEAD", headers: headers({ Prefer: "count=exact" }) }
  );
  if (!res.ok) return 0;
  // 예: "0-4/5" 에서 맨 뒤 5가 전체 수
  const range = res.headers.get("content-range") || "";
  const total = parseInt(range.split("/")[1], 10);
  return isNaN(total) ? 0 : total;
}

// 잎사귀 모양 좋아요 아이콘
const LEAF_PATH = "M5 19c0-8 5-14 15-15-1 10-7 15-15 15zM5 19l8-8";
const LEAF_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + LEAF_PATH + '"/></svg>';

// 누르면 작은 잎 몇 장이 톡 튀어 오른다
function popLeaves(button) {
  if (!MOTION_OK) return;
  for (let i = 0; i < 5; i++) {
    const leaf = el("span", "leaf-pop");
    leaf.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19c0-8 5-14 15-15-1 10-7 15-15 15z"/></svg>';
    leaf.style.setProperty("--x", (i - 2) * 12 + "px");
    leaf.style.setProperty("--r", (i - 2) * 35 + "deg");
    leaf.style.animationDelay = i * 0.04 + "s";
    button.appendChild(leaf);
    leaf.addEventListener("animationend", function () { leaf.remove(); });
  }
}

function makeCard(project, likeCount) {
  const card = el("article", "card");

  // 카드 본문 (누르면 자세히 보기 창이 열린다)
  const open = el("button", "card-open");
  open.type = "button";
  open.setAttribute("aria-haspopup", "dialog");
  open.addEventListener("click", function () {
    openProjectDialog(project);
  });

  const browser = el("div", "browser");
  const bar = el("div", "browser-bar");
  bar.append(el("span"), el("span"), el("span"));
  const screen = el("div", "browser-screen");
  if (project.thumbnail_url) {
    const img = el("img");
    img.src = project.thumbnail_url;
    img.alt = project.title;
    img.loading = "lazy";
    img.onerror = function () { img.remove(); };
    screen.appendChild(img);
  }
  browser.append(bar, screen);

  const body = el("div", "card-body");
  const meta = [project.number, project.category].filter(Boolean).join(" · ");
  body.appendChild(el("p", "card-meta", meta));
  body.appendChild(el("h4", "card-title", project.title));
  body.appendChild(el("p", "card-desc", project.description));
  const tags = el("div", "card-tags");
  (project.tags || []).forEach(function (t) {
    tags.appendChild(el("span", null, t));
  });
  body.appendChild(tags);

  open.append(browser, body);

  // 좋아요 버튼
  const like = el("button", "like");
  like.type = "button";
  like.innerHTML = LEAF_SVG;
  const num = el("span", null, String(likeCount));
  like.appendChild(num);
  like.setAttribute("aria-label", "좋아요");

  let count = likeCount;
  if (getLikedIds().includes(project.id)) like.classList.add("liked");

  like.addEventListener("click", async function () {
    if (like.classList.contains("liked") || like.disabled) return;
    like.disabled = true;
    const res = await insertRow("likes", { project_id: project.id, client_id: CLIENT_ID }, false)
      .catch(function () { return null; });
    if (res && res.ok) {
      count += 1;
      num.textContent = String(count);
      like.classList.add("liked");
      saveLikedId(project.id);
      popLeaves(like);
    } else if (res && res.status === 409) {
      // 이미 이 브라우저에서 눌렀던 카드
      like.classList.add("liked");
      saveLikedId(project.id);
    } else {
      alert("좋아요를 남기지 못했어요. 잠시 후 다시 눌러 주세요.");
    }
    like.disabled = false;
  });

  card.append(open, like);
  return card;
}

async function loadProjects() {
  const box = $("cards");
  let projects;
  try {
    projects = await readTable("projects?select=*&order=sort_order.asc,id.asc");
  } catch (e) {
    box.innerHTML = "";
    box.appendChild(el("p", "status", "포트폴리오를 불러오지 못했어요."));
    return;
  }

  const counts = await Promise.all(
    projects.map(function (p) { return countLikes(p.id).catch(function () { return 0; }); })
  );

  box.innerHTML = "";
  if (projects.length === 0) {
    box.appendChild(el("p", "status", "아직 등록된 포트폴리오가 없어요."));
    return;
  }
  projects.forEach(function (p, i) {
    box.appendChild(makeCard(p, counts[i]));
  });
  reveal(box.querySelectorAll(".card"));
}

// ===== 프로젝트 자세히 보기 창 =====
const dialog = $("project-dialog");
let dialogFileUrl = null;

function isImageUrl(url) {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url || "");
}

let dialogPhotos = [];
let dialogIndex = 0;
let dialogTitle = "";

// 지금 순서의 사진 한 장을 보여 준다
function showDialogPhoto() {
  const photo = $("dlg-photo");
  photo.innerHTML = "";
  const url = dialogPhotos[dialogIndex];
  photo.classList.toggle("empty", !url);
  if (url) {
    const img = el("img");
    img.src = url;
    img.alt = dialogTitle + (dialogPhotos.length > 1 ? " 사진 " + (dialogIndex + 1) : "");
    img.onerror = function () { img.remove(); photo.classList.add("empty"); };
    photo.appendChild(img);
  }
  const many = dialogPhotos.length > 1;
  $("dlg-prev").hidden = !many;
  $("dlg-next").hidden = !many;
  $("dlg-count").hidden = !many;
  $("dlg-count").textContent = many ? (dialogIndex + 1) + " / " + dialogPhotos.length : "";
}

// 앞(-1)·뒤(+1)로 넘기기. 끝에서 넘기면 처음으로 돌아간다
function stepDialogPhoto(step) {
  if (dialogPhotos.length < 2) return;
  dialogIndex = (dialogIndex + step + dialogPhotos.length) % dialogPhotos.length;
  showDialogPhoto();
}

function openProjectDialog(project) {
  // 사진: 관리자가 고른 자세히 보기 사진들.
  // 없으면 썸네일, 그것도 없으면 첨부 파일이 이미지일 때 그 이미지
  const chosen = (project.detail_images || []).filter(Boolean);
  const fallback = project.thumbnail_url || (isImageUrl(project.file_url) ? project.file_url : null);
  dialogPhotos = chosen.length ? chosen : (fallback ? [fallback] : []);
  dialogIndex = 0;
  dialogTitle = project.title;
  showDialogPhoto();
  const photoUrl = dialogPhotos[0];

  $("dlg-meta").textContent = [project.number, project.category].filter(Boolean).join(" · ");
  $("dlg-title").textContent = project.title;
  $("dlg-desc").textContent = project.description;

  const tags = $("dlg-tags");
  tags.innerHTML = "";
  (project.tags || []).forEach(function (t) {
    tags.appendChild(el("span", null, t));
  });

  // 첨부 파일이 있으면 "첨부 파일 열기" 버튼 (PDF면 "PDF 열기")
  dialogFileUrl = project.file_url || null;
  const fileBtn = $("dlg-file");
  fileBtn.hidden = !dialogFileUrl;
  fileBtn.textContent = /\.pdf(\?|$)/i.test(dialogFileUrl || "") ? "PDF 열기" : "첨부 파일 크게 보기";

  if (typeof dialog.showModal === "function") {
    dialog.showModal();
    document.documentElement.classList.add("dialog-open");
  } else if (dialogFileUrl || photoUrl) {
    // 아주 오래된 브라우저: 예전처럼 새 탭으로
    window.open(dialogFileUrl || photoUrl, "_blank", "noopener");
  }
}

function closeProjectDialog() {
  if (dialog.open) dialog.close();
}

dialog.addEventListener("close", function () {
  document.documentElement.classList.remove("dialog-open");
});

// 창 바깥(어두운 부분)을 누르면 닫힌다
dialog.addEventListener("click", function (e) {
  if (e.target === dialog) closeProjectDialog();
});

$("dlg-close").addEventListener("click", closeProjectDialog);
$("dlg-prev").addEventListener("click", function () { stepDialogPhoto(-1); });
$("dlg-next").addEventListener("click", function () { stepDialogPhoto(1); });

// 키보드 ← → 로 넘기기
dialog.addEventListener("keydown", function (e) {
  if (e.key === "ArrowLeft") stepDialogPhoto(-1);
  if (e.key === "ArrowRight") stepDialogPhoto(1);
});

// 휴대폰: 사진을 옆으로 밀어서 넘기기
let touchStartX = null;
$("dlg-photo").addEventListener("touchstart", function (e) {
  touchStartX = e.touches[0].clientX;
}, { passive: true });
$("dlg-photo").addEventListener("touchend", function (e) {
  if (touchStartX === null) return;
  const dx = e.changedTouches[0].clientX - touchStartX;
  touchStartX = null;
  if (Math.abs(dx) > 40) stepDialogPhoto(dx < 0 ? 1 : -1);
});
$("dlg-done").addEventListener("click", closeProjectDialog);
$("dlg-file").addEventListener("click", function () {
  if (dialogFileUrl) window.open(dialogFileUrl, "_blank", "noopener");
});

// ===== 방명록 =====
function formatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function makeGuestItem(entry) {
  const li = el("li");
  const head = el("div", "guest-head");
  head.append(el("span", "guest-nick", entry.nickname), el("span", "guest-date", formatDate(entry.created_at)));
  li.append(head, el("p", "guest-msg", entry.message));
  return li;
}

async function loadGuestbook() {
  const list = $("guest-list");
  let rows;
  try {
    rows = await readTable("resume_guestbook?select=*&order=created_at.desc&limit=100");
  } catch (e) {
    list.innerHTML = "";
    list.appendChild(el("li", "status", "방명록을 불러오지 못했어요."));
    return;
  }
  list.innerHTML = "";
  if (rows.length === 0) {
    list.appendChild(el("li", "status", "첫 번째 방명록을 남겨 주세요."));
    return;
  }
  rows.forEach(function (r) {
    list.appendChild(makeGuestItem(r));
  });
}

async function submitGuestbook() {
  const nickInput = $("guest-nickname");
  const msgInput = $("guest-message");
  const status = $("guest-status");
  const button = $("guest-submit");

  const nickname = nickInput.value.trim();
  const message = msgInput.value.trim();
  status.textContent = "";

  if (!nickname) { status.textContent = "별명을 적어 주세요."; nickInput.focus(); return; }
  if (!message) { status.textContent = "한마디를 적어 주세요."; msgInput.focus(); return; }

  button.disabled = true;
  const res = await insertRow("resume_guestbook", { nickname: nickname, message: message }, true)
    .catch(function () { return null; });
  button.disabled = false;

  if (!res || !res.ok) {
    status.textContent = "남기지 못했어요. 잠시 후 다시 해 주세요.";
    return;
  }

  const rows = await res.json();
  const list = $("guest-list");
  const empty = list.querySelector(".status");
  if (empty) empty.remove();
  list.prepend(makeGuestItem(rows[0]));

  msgInput.value = "";
}

$("guest-submit").addEventListener("click", submitGuestbook);
$("guest-message").addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.isComposing) submitGuestbook();
});

// ===== 시작 =====
reveal(document.querySelectorAll(".info-box"));
reveal(document.querySelectorAll(".highlights, .quote, .guestbook"));
loadProfile();
loadProjects();
loadGuestbook();
