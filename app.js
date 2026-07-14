const canvas = document.querySelector("#boothCanvas");
const ctx = canvas.getContext("2d");
const video = document.querySelector("#cameraVideo");
const countdown = document.querySelector("#countdown");
const statusText = document.querySelector("#statusText");
const shotCounter = document.querySelector("#shotCounter");
const qrBox = document.querySelector("#qrBox");
const shareLink = document.querySelector("#shareLink");

const cameraButton = document.querySelector("#cameraButton");
const shootButton = document.querySelector("#shootButton");
const retakeButton = document.querySelector("#retakeButton");
const downloadButton = document.querySelector("#downloadButton");
const finishButton = document.querySelector("#finishButton");
const frameInput = document.querySelector("#frameInput");
const photoInput = document.querySelector("#photoInput");
const editTemplateButton = document.querySelector("#editTemplateButton");
const confirmTemplateButton = document.querySelector("#confirmTemplateButton");
const saveTemplateButton = document.querySelector("#saveTemplateButton");
const templateNameInput = document.querySelector("#templateName");
const templateList = document.querySelector("#templateList");

function optionalControl(id, value) {
  return document.querySelector(`#${id}`) || { value, addEventListener: () => {} };
}

const controls = {
  windowInset: optionalControl("windowInset", 10),
  windowTop: optionalControl("windowTop", 7),
  windowHeight: optionalControl("windowHeight", 18),
  windowGap: optionalControl("windowGap", 2),
  cornerRadius: optionalControl("cornerRadius", 4),
  photoZoom: optionalControl("photoZoom", 100),
  frameOpacity: optionalControl("frameOpacity", 100),
};

const state = {
  frameImage: null,
  albumImage: null,
  shots: [],
  currentSlot: 0,
  frameMode: "window",
  layout: "strip",
  stream: null,
  cameraReady: false,
  shooting: false,
  frameRatio: 3 / 4,
  frameDataUrl: "",
  customSlots: null,
  editingTemplate: false,
  selectedSlot: 0,
  drag: null,
  templates: [],
  finalDataUrl: "",
  audioContext: null,
};

const TEMPLATE_STORAGE_KEY = "adas-photobooth-templates";
const LEGACY_TEMPLATE_STORAGE_KEY = "cdnxt-photobooth-templates";

function setStatus(text) {
  statusText.textContent = text;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function playCountdownBeep(number) {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!state.audioContext) state.audioContext = new AudioContext();
    if (state.audioContext.state === "suspended") state.audioContext.resume();

    const osc = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    const now = state.audioContext.currentTime;
    osc.type = "sine";
    osc.frequency.value = number === 1 ? 880 : 640;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.2, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
    osc.connect(gain).connect(state.audioContext.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (error) {
    // Sound is a nice-to-have; keep shooting smooth if audio is blocked.
  }
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("load failed"));
    };
    img.src = url;
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

function imageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed"));
    img.src = dataUrl;
  });
}

function makeImageFromCanvas(sourceCanvas) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.src = sourceCanvas.toDataURL("image/png");
  });
}

function coverRect(sourceW, sourceH, targetW, targetH, zoom = 1) {
  const scale = Math.max(targetW / sourceW, targetH / sourceH) * zoom;
  const width = sourceW * scale;
  const height = sourceH * scale;
  return {
    x: (targetW - width) / 2,
    y: (targetH - height) / 2,
    width,
    height,
  };
}

function setCheckedRadio(name, value) {
  const input = document.querySelector(`input[name="${name}"][value="${value}"]`);
  if (input) input.checked = true;
}

function updateActionButtons() {
  const hasSource = Boolean(activeLiveSource());
  const calibrationOpen = state.editingTemplate;
  shootButton.disabled = state.shooting || !hasSource || calibrationOpen || state.shots.length >= 4;
  shootButton.innerHTML =
    state.shots.length >= 4
      ? '<span class="icon">✓</span> 已拍满 4 格'
      : `<span class="icon">⏱</span> 拍第 ${state.shots.length + 1} 格`;
  retakeButton.disabled = state.shooting || state.shots.length === 0 || !hasSource || calibrationOpen;
  downloadButton.disabled = !state.finalDataUrl && state.shots.length < 4;
  finishButton.disabled = !state.finalDataUrl || state.shooting;
  editTemplateButton.disabled = !state.frameImage || state.shooting;
  confirmTemplateButton.disabled = !state.frameImage || !state.editingTemplate || state.shooting;
  saveTemplateButton.disabled = !state.frameImage || !state.customSlots || state.shooting;
}

function roundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function defaultTemplateSlots(width, height) {
  const side = Number(controls.windowInset.value) / 100;
  const top = Number(controls.windowTop.value) / 100;
  const heightRatio = Number(controls.windowHeight.value) / 100;
  const gapRatio = Number(controls.windowGap.value) / 100;
  const slots = [];

  if (state.layout === "strip") {
    const slotX = width * side;
    const slotW = width * (1 - side * 2);
    const slotH = height * heightRatio;
    const gap = height * gapRatio;
    const startY = height * top;

    for (let index = 0; index < 4; index += 1) {
      slots.push({
        x: slotX,
        y: startY + index * (slotH + gap),
        width: slotW,
        height: slotH,
      });
    }
  } else {
    const gap = Math.min(width, height) * Math.max(gapRatio, 0.025);
    const outerX = width * side;
    const outerY = height * top;
    const cellW = (width - outerX * 2 - gap) / 2;
    const cellH = (height - outerY * 2 - gap) / 2;

    for (let index = 0; index < 4; index += 1) {
      const col = index % 2;
      const row = Math.floor(index / 2);
      slots.push({
        x: outerX + col * (cellW + gap),
        y: outerY + row * (cellH + gap),
        width: cellW,
        height: cellH,
      });
    }
  }

  return slots;
}

function normalizeSlots(slots, width, height) {
  return slots.map((slot) => ({
    x: slot.x / width,
    y: slot.y / height,
    width: slot.width / width,
    height: slot.height / height,
  }));
}

function denormalizeSlots(slots, width, height) {
  return slots.map((slot) => ({
    x: slot.x * width,
    y: slot.y * height,
    width: slot.width * width,
    height: slot.height * height,
  }));
}

function getCanvasPlan() {
  if (state.frameImage) {
    const frameRatio = state.frameImage.naturalWidth / state.frameImage.naturalHeight;
    const longSide = 2200;
    const width = frameRatio >= 1 ? longSide : Math.round(longSide * frameRatio);
    const height = frameRatio >= 1 ? Math.round(longSide / frameRatio) : longSide;
    const slots = state.customSlots
      ? denormalizeSlots(state.customSlots, width, height)
      : defaultTemplateSlots(width, height);

    return { width, height, slots, outer: width * (Number(controls.windowInset.value) / 100), hasTemplate: true };
  }

  const gap = 42;
  const outer = 70;
  const cellW = state.layout === "strip" ? 780 : 650;
  const cellH = Math.round(cellW / state.frameRatio);
  const cols = state.layout === "strip" ? 1 : 2;
  const rows = state.layout === "strip" ? 4 : 2;
  const width = outer * 2 + cols * cellW + (cols - 1) * gap;
  const height = outer * 2 + rows * cellH + (rows - 1) * gap + 118;
  const slots = [];

  for (let index = 0; index < 4; index += 1) {
    const col = state.layout === "strip" ? 0 : index % 2;
    const row = state.layout === "strip" ? index : Math.floor(index / 2);
    slots.push({
      x: outer + col * (cellW + gap),
      y: outer + row * (cellH + gap),
      width: cellW,
      height: cellH,
    });
  }

  return { width, height, slots, outer, hasTemplate: false };
}

function resizeCanvas(plan) {
  if (canvas.width !== plan.width || canvas.height !== plan.height) {
    canvas.width = plan.width;
    canvas.height = plan.height;
    canvas.style.aspectRatio = `${plan.width} / ${plan.height}`;
  }
}

function drawCuteBackground(width, height) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "#eefdff");
  bg.addColorStop(0.35, "#d7f3ff");
  bg.addColorStop(0.7, "#ddd1ff");
  bg.addColorStop(1, "#ffe0f5");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(118, 104, 229, 0.12)";
  for (let i = 0; i < 18; i += 1) {
    const x = (i * 137) % width;
    const y = (i * 211) % height;
    ctx.beginPath();
    ctx.arc(x, y, 8 + (i % 4) * 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawMirroredSource(source, rect) {
  const sourceW = source.videoWidth || source.naturalWidth || source.width;
  const sourceH = source.videoHeight || source.naturalHeight || source.height;
  const zoom = Number(controls.photoZoom.value) / 100;
  const placement = coverRect(sourceW, sourceH, rect.width, rect.height, zoom);

  ctx.save();
  ctx.translate(rect.x + rect.width, rect.y);
  ctx.scale(-1, 1);
  ctx.drawImage(source, placement.x, placement.y, placement.width, placement.height);
  ctx.restore();
}

function drawPhotoArea(source, slot, radius) {
  ctx.save();
  roundedRect(slot.x, slot.y, slot.width, slot.height, radius);
  ctx.clip();
  if (source) {
    drawMirroredSource(source, slot);
  } else {
    const idle = ctx.createLinearGradient(slot.x, slot.y, slot.x + slot.width, slot.y + slot.height);
    idle.addColorStop(0, "#f9f7ff");
    idle.addColorStop(1, "#dff8ff");
    ctx.fillStyle = idle;
    ctx.fillRect(slot.x, slot.y, slot.width, slot.height);
  }
  ctx.restore();
}

function drawFullFrame(plan) {
  if (!state.frameImage) return;
  ctx.save();
  ctx.globalAlpha = Number(controls.frameOpacity.value) / 100;
  ctx.drawImage(state.frameImage, 0, 0, plan.width, plan.height);
  ctx.restore();
}

function drawDefaultSlotFrame(slot, radius) {
  ctx.save();
  roundedRect(slot.x, slot.y, slot.width, slot.height, radius);
  ctx.lineWidth = Math.max(12, slot.width * 0.025);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.78)";
  ctx.stroke();
  ctx.restore();
}

function drawSlot(slot, index, source, isActive, hasTemplate) {
  const radius = Math.min(slot.width, slot.height) * (Number(controls.cornerRadius.value) / 100);

  if (!hasTemplate) {
    ctx.save();
    ctx.shadowColor = "rgba(71, 72, 172, 0.28)";
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    roundedRect(slot.x, slot.y, slot.width, slot.height, radius);
    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.fill();
    ctx.restore();
  }

  drawPhotoArea(source, slot, radius);
  if (!hasTemplate) drawDefaultSlotFrame(slot, radius);

  if (isActive) {
    ctx.save();
    roundedRect(slot.x - 8, slot.y - 8, slot.width + 16, slot.height + 16, radius + 10);
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#ff7fd8";
    ctx.stroke();
    ctx.restore();
  }

  if (hasTemplate) return;

  ctx.save();
  ctx.fillStyle = "rgba(28, 27, 84, 0.72)";
  ctx.beginPath();
  ctx.arc(slot.x + 42, slot.y + 42, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff7ff";
  ctx.font = "900 31px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(index + 1), slot.x + 42, slot.y + 42);
  ctx.restore();
}

function drawCalibrationOverlay(plan) {
  if (!state.editingTemplate || !plan.hasTemplate) return;

  plan.slots.forEach((slot, index) => {
    const active = index === state.selectedSlot;
    const handle = Math.max(26, Math.min(plan.width, plan.height) * 0.018);
    ctx.save();
    roundedRect(slot.x, slot.y, slot.width, slot.height, 18);
    ctx.lineWidth = active ? 9 : 6;
    ctx.strokeStyle = active ? "#ffe083" : "rgba(110, 214, 255, 0.92)";
    ctx.setLineDash(active ? [] : [22, 16]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = active ? "rgba(255, 224, 131, 0.95)" : "rgba(110, 214, 255, 0.95)";
    [
      [slot.x, slot.y],
      [slot.x + slot.width, slot.y],
      [slot.x, slot.y + slot.height],
      [slot.x + slot.width, slot.y + slot.height],
    ].forEach(([x, y]) => {
      ctx.beginPath();
      ctx.arc(x, y, handle, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = "#171337";
    ctx.font = `900 ${Math.max(30, handle * 1.1)}px Trebuchet MS, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), slot.x + slot.width / 2, slot.y + slot.height / 2);
    ctx.restore();
  });
}

function drawFooter(plan) {
  const y = plan.height - 72;
  ctx.save();
  ctx.fillStyle = "#241d68";
  ctx.font = "900 42px Trebuchet MS, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("Ada's Photobooth", plan.width / 2, y);
  ctx.fillStyle = "rgba(36, 29, 104, 0.64)";
  ctx.font = "700 24px Trebuchet MS, sans-serif";
  ctx.fillText(new Date().toLocaleDateString("zh-CN"), plan.width / 2, y + 38);
  ctx.restore();
}

function activeLiveSource() {
  if (state.cameraReady && video.readyState >= 2) return video;
  if (state.albumImage) return state.albumImage;
  return null;
}

function render() {
  const plan = getCanvasPlan();
  resizeCanvas(plan);
  canvas.classList.toggle("is-editing", state.editingTemplate);
  drawCuteBackground(plan.width, plan.height);

  if (plan.hasTemplate && state.frameMode === "window") {
    drawFullFrame(plan);
  }

  plan.slots.forEach((slot, index) => {
    const source = state.shots[index] || (index === state.currentSlot ? activeLiveSource() : null);
    drawSlot(slot, index, source, state.shooting && index === state.currentSlot, plan.hasTemplate);
  });

  if (plan.hasTemplate && state.frameMode === "overlay") {
    drawFullFrame(plan);
  }

  drawCalibrationOverlay(plan);

  if (!plan.hasTemplate) {
    drawFooter(plan);
  }
  shotCounter.textContent = `${state.shots.length} / 4`;
  updateActionButtons();
}

function animationLoop() {
  render();
  requestAnimationFrame(animationLoop);
}

function ensureCustomSlots() {
  if (!state.frameImage || state.customSlots) return;
  const plan = getCanvasPlan();
  state.customSlots = normalizeSlots(plan.slots, plan.width, plan.height);
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function pointInSlot(point, slot) {
  return (
    point.x >= slot.x &&
    point.x <= slot.x + slot.width &&
    point.y >= slot.y &&
    point.y <= slot.y + slot.height
  );
}

function distance(point, x, y) {
  return Math.hypot(point.x - x, point.y - y);
}

function hitTestSlot(point, plan) {
  const handle = Math.max(34, Math.min(plan.width, plan.height) * 0.025);
  for (let index = plan.slots.length - 1; index >= 0; index -= 1) {
    const slot = plan.slots[index];
    const handles = [
      { mode: "resize-nw", x: slot.x, y: slot.y },
      { mode: "resize-ne", x: slot.x + slot.width, y: slot.y },
      { mode: "resize-sw", x: slot.x, y: slot.y + slot.height },
      { mode: "resize-se", x: slot.x + slot.width, y: slot.y + slot.height },
    ];
    const handleHit = handles.find((item) => distance(point, item.x, item.y) <= handle);
    if (handleHit) return { index, mode: handleHit.mode };
    if (pointInSlot(point, slot)) return { index, mode: "move" };
  }
  return null;
}

function clampSlot(slot, plan) {
  const minW = plan.width * 0.08;
  const minH = plan.height * 0.04;
  const next = { ...slot };
  next.width = Math.max(minW, Math.min(next.width, plan.width));
  next.height = Math.max(minH, Math.min(next.height, plan.height));
  next.x = Math.max(0, Math.min(next.x, plan.width - next.width));
  next.y = Math.max(0, Math.min(next.y, plan.height - next.height));
  return next;
}

function updateDraggedSlot(point) {
  const drag = state.drag;
  if (!drag) return;
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  let slot = { ...drag.original };

  if (drag.mode === "move") {
    slot.x += dx;
    slot.y += dy;
  }
  if (drag.mode.includes("e")) slot.width += dx;
  if (drag.mode.includes("s")) slot.height += dy;
  if (drag.mode.includes("w")) {
    slot.x += dx;
    slot.width -= dx;
  }
  if (drag.mode.includes("n")) {
    slot.y += dy;
    slot.height -= dy;
  }

  const plan = { width: drag.planWidth, height: drag.planHeight };
  slot = clampSlot(slot, plan);
  state.customSlots[drag.index] = normalizeSlots([slot], drag.planWidth, drag.planHeight)[0];
  state.finalDataUrl = "";
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("这个浏览器不能直接打开摄像头，可以先用相册照片填充。");
    return;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1440 },
        height: { ideal: 1920 },
      },
      audio: false,
    });
    video.srcObject = state.stream;
    await video.play();
    state.cameraReady = true;
    updateActionButtons();
    setStatus("摄像头已打开，可以一格一格拍。");
  } catch (error) {
    setStatus("摄像头没有打开，可以检查浏览器权限，或用相册照片填充。");
  }
}

async function captureShot() {
  const source = activeLiveSource();
  if (!source) return null;
  const slotPlan = getCanvasPlan().slots[0];
  const temp = document.createElement("canvas");
  temp.width = Math.round(slotPlan.width);
  temp.height = Math.round(slotPlan.height);
  const tempCtx = temp.getContext("2d");
  const sourceW = source.videoWidth || source.naturalWidth || source.width;
  const sourceH = source.videoHeight || source.naturalHeight || source.height;
  const zoom = Number(controls.photoZoom.value) / 100;
  const placement = coverRect(sourceW, sourceH, temp.width, temp.height, zoom);
  tempCtx.drawImage(source, placement.x, placement.y, placement.width, placement.height);
  return makeImageFromCanvas(temp);
}

async function countdownForSlot(slot) {
  state.currentSlot = slot;
  for (let number = 3; number >= 1; number -= 1) {
    countdown.textContent = number;
    countdown.hidden = false;
    playCountdownBeep(number);
    setStatus(`第 ${slot + 1} 格，${number} 秒。`);
    await wait(1000);
  }
  countdown.hidden = true;
  const shot = await captureShot();
  await wait(180);
  return shot;
}

async function shootNextSlot() {
  if (state.shooting) return;
  if (!activeLiveSource()) {
    setStatus("请先打开摄像头，或上传一张照片。");
    return;
  }
  if (state.shots.length >= 4) {
    setStatus("四格已经拍满，可以下载、重拍上一格，或点完成/下一张。");
    return;
  }

  state.shooting = true;
  state.currentSlot = state.shots.length;
  state.finalDataUrl = "";
  downloadButton.disabled = true;
  qrBox.innerHTML = "<span>拍摄中</span>";
  shareLink.hidden = true;

  const target = state.shots.length;
  const shot = await countdownForSlot(target);
  if (shot) state.shots[target] = shot;

  countdown.hidden = true;
  state.shooting = false;
  state.currentSlot = Math.min(state.shots.length, 3);

  if (state.shots.length === 4) {
    render();
    await finishPhoto();
  } else {
    qrBox.innerHTML = "<span>拍完生成</span>";
    setStatus(`第 ${target + 1} 格已拍好。可以继续拍下一格，或重拍上一格。`);
    updateActionButtons();
  }
}

async function retakeLastShot() {
  if (state.shooting) return;
  if (state.shots.length === 0) {
    setStatus("还没有照片可以重拍。");
    return;
  }
  if (!activeLiveSource()) {
    setStatus("请先打开摄像头，或上传一张照片，再重拍。");
    return;
  }

  const target = state.shots.length - 1;
  state.shooting = true;
  state.finalDataUrl = "";
  downloadButton.disabled = true;
  qrBox.innerHTML = "<span>重拍中</span>";
  shareLink.hidden = true;

  const shot = await countdownForSlot(target);
  if (shot) state.shots[target] = shot;

  state.shooting = false;
  state.currentSlot = Math.min(state.shots.length, 3);
  if (state.shots.length === 4) {
    await finishPhoto();
  } else {
    setStatus(`第 ${target + 1} 格已重拍，可以继续拍。`);
    updateActionButtons();
  }
}

async function finishPhoto() {
  render();
  state.finalDataUrl = canvas.toDataURL("image/png");
  downloadButton.disabled = false;
  setStatus("成品已生成，可以下载或扫码保存。");

  try {
    const response = await fetch("/api/photos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: state.finalDataUrl }),
    });

    if (!response.ok) throw new Error("save failed");
    const payload = await response.json();
    renderQr(payload.downloadUrl);
    shareLink.href = payload.downloadUrl;
    shareLink.hidden = false;
  } catch (error) {
    qrBox.innerHTML = "<span>本地服务打开时生成二维码</span>";
  }
}

function renderQr(url) {
  const qr = qrcode(0, "M");
  qr.addData(url);
  qr.make();
  const img = document.createElement("img");
  img.alt = "成品下载二维码";
  img.src = qr.createDataURL(8, 12);
  qrBox.replaceChildren(img);
}

function loadTemplates() {
  try {
    const saved = localStorage.getItem(TEMPLATE_STORAGE_KEY);
    const legacy = localStorage.getItem(LEGACY_TEMPLATE_STORAGE_KEY);
    state.templates = JSON.parse(saved || legacy || "[]");
    if (!saved && legacy) persistTemplates();
  } catch (error) {
    state.templates = [];
  }
  renderTemplateList();
}

function persistTemplates() {
  localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(state.templates.slice(0, 8)));
}

function renderTemplateList() {
  templateList.innerHTML = "";
  if (state.templates.length === 0) {
    const empty = document.createElement("span");
    empty.className = "empty-template";
    empty.textContent = "还没有保存模板";
    templateList.append(empty);
    return;
  }

  state.templates.forEach((template) => {
    const item = document.createElement("div");
    item.className = "template-item";
    const useButton = document.createElement("button");
    useButton.className = "template-use";
    useButton.type = "button";
    useButton.innerHTML = `<img src="${template.frameDataUrl}" alt=""><span>${template.name}</span>`;
    useButton.addEventListener("click", () => loadSavedTemplate(template.id));

    const deleteButton = document.createElement("button");
    deleteButton.className = "template-delete";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteTemplate(template.id));

    item.append(useButton, deleteButton);
    templateList.append(item);
  });
}

function deleteTemplate(id) {
  const template = state.templates.find((item) => item.id === id);
  state.templates = state.templates.filter((item) => item.id !== id);
  persistTemplates();
  renderTemplateList();
  setStatus(template ? `已删除模板「${template.name}」。` : "模板已删除。");
}

async function loadSavedTemplate(id) {
  const template = state.templates.find((item) => item.id === id);
  if (!template) return;
  try {
    state.frameImage = await imageFromDataUrl(template.frameDataUrl);
    state.frameDataUrl = template.frameDataUrl;
    state.frameRatio = state.frameImage.naturalWidth / state.frameImage.naturalHeight;
    state.customSlots = template.slots;
    state.frameMode = template.frameMode || "overlay";
    state.layout = template.layout || "strip";
    state.editingTemplate = false;
    setCheckedRadio("frameMode", state.frameMode);
    setCheckedRadio("layout", state.layout);
    state.finalDataUrl = "";
    frameInput.value = "";
    setStatus(`已载入模板「${template.name}」，可以直接拍摄，或点“调整拍照框”继续校准。`);
  } catch (error) {
    setStatus("模板读取失败，可以重新上传相框。");
  }
}

function makeStoredFrameDataUrl() {
  const plan = getCanvasPlan();
  const scale = Math.min(1, 1600 / Math.max(plan.width, plan.height));
  const temp = document.createElement("canvas");
  temp.width = Math.round(plan.width * scale);
  temp.height = Math.round(plan.height * scale);
  const tempCtx = temp.getContext("2d");
  tempCtx.drawImage(state.frameImage, 0, 0, temp.width, temp.height);
  return state.frameMode === "overlay" ? temp.toDataURL("image/png") : temp.toDataURL("image/jpeg", 0.9);
}

function saveCurrentTemplate() {
  if (!state.frameImage) {
    setStatus("请先上传相框再保存模板。");
    return;
  }
  ensureCustomSlots();
  const name = templateNameInput.value.trim() || `模板 ${state.templates.length + 1}`;
  const template = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    frameDataUrl: makeStoredFrameDataUrl(),
    frameMode: state.frameMode,
    layout: state.layout,
    slots: state.customSlots,
    createdAt: Date.now(),
  };

  try {
    state.templates = [template, ...state.templates].slice(0, 8);
    persistTemplates();
    renderTemplateList();
    templateNameInput.value = "";
    setStatus(`模板「${name}」已保存，下次可以从模板库直接选择。`);
  } catch (error) {
    setStatus("模板保存失败：图片可能太大。可以换小一点的相框图再保存。");
  }
}

function downloadFinal() {
  if (!state.finalDataUrl) {
    state.finalDataUrl = canvas.toDataURL("image/png");
  }
  const link = document.createElement("a");
  link.download = `adas-photobooth-${new Date().toISOString().slice(0, 10)}.png`;
  link.href = state.finalDataUrl;
  link.click();
}

function finishCurrentPhoto() {
  state.shots = [];
  state.currentSlot = 0;
  state.finalDataUrl = "";
  qrBox.innerHTML = "<span>拍完生成</span>";
  shareLink.hidden = true;
  setStatus("已完成这一张。模板已保留，可以直接拍下一张。");
  updateActionButtons();
}

frameInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    const [img, dataUrl] = await Promise.all([loadImage(file), fileToDataUrl(file)]);
    state.frameImage = img;
    state.frameDataUrl = dataUrl;
    state.frameRatio = img.naturalWidth / img.naturalHeight;
    state.layout = state.frameRatio < 0.82 ? "strip" : "grid";
    setCheckedRadio("layout", state.layout);
    state.customSlots = null;
    ensureCustomSlots();
    state.editingTemplate = true;
    state.selectedSlot = 0;
    state.shots = [];
    state.currentSlot = 0;
    state.finalDataUrl = "";
    qrBox.innerHTML = "<span>拍完生成</span>";
    shareLink.hidden = true;
    setStatus("已进入模板校准：拖动拍照框移动，拖四角缩放。对齐后点“确认开始拍摄”。");
  } catch (error) {
    setStatus("相框读取失败，请换一张图片。");
  }
});

photoInput.addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!file) return;
  try {
    state.albumImage = await loadImage(file);
    state.shots = [state.albumImage, state.albumImage, state.albumImage, state.albumImage];
    state.currentSlot = 3;
    updateActionButtons();
    await finishPhoto();
  } catch (error) {
    setStatus("照片读取失败，请换一张图片。");
  }
});

document.querySelectorAll('input[name="frameMode"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.frameMode = input.value;
  });
});

document.querySelectorAll('input[name="layout"]').forEach((input) => {
  input.addEventListener("change", () => {
    state.layout = input.value;
    state.customSlots = null;
    if (state.frameImage) ensureCustomSlots();
    state.finalDataUrl = "";
  });
});

Object.values(controls).forEach((input) => {
  input.addEventListener("input", () => {
    if (state.frameImage && !state.editingTemplate) {
      state.customSlots = null;
    }
    if (state.shots.length === 4) {
      state.finalDataUrl = "";
      downloadButton.disabled = false;
    }
  });
});

cameraButton.addEventListener("click", startCamera);
shootButton.addEventListener("click", shootNextSlot);
retakeButton.addEventListener("click", retakeLastShot);
downloadButton.addEventListener("click", downloadFinal);
finishButton.addEventListener("click", finishCurrentPhoto);
editTemplateButton.addEventListener("click", () => {
  if (!state.frameImage) return;
  ensureCustomSlots();
  state.editingTemplate = true;
  state.selectedSlot = 0;
  setStatus("模板校准中：拖动框体移动，拖四角缩放。");
});
confirmTemplateButton.addEventListener("click", () => {
  state.editingTemplate = false;
  setStatus("拍照框已确认。可以打开摄像头开始拍摄，或保存为模板下次直接用。");
});
saveTemplateButton.addEventListener("click", saveCurrentTemplate);

canvas.addEventListener("pointerdown", (event) => {
  if (!state.editingTemplate || !state.frameImage || state.shooting) return;
  ensureCustomSlots();
  const plan = getCanvasPlan();
  const point = canvasPoint(event);
  const hit = hitTestSlot(point, plan);
  if (!hit) return;
  state.selectedSlot = hit.index;
  state.drag = {
    mode: hit.mode,
    index: hit.index,
    start: point,
    original: { ...plan.slots[hit.index] },
    planWidth: plan.width,
    planHeight: plan.height,
  };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (!state.drag) return;
  updateDraggedSlot(canvasPoint(event));
});

canvas.addEventListener("pointerup", (event) => {
  if (!state.drag) return;
  state.drag = null;
  canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  state.drag = null;
});

render();
loadTemplates();
animationLoop();
