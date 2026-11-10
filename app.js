'use strict';
const $ = id => document.getElementById(id);
const desktop = Boolean(window.theater);
const colors = ['#c4f279', '#83c8fb', '#d5a2f5', '#f3be78', '#f48e9e', '#7bdbca'];
const runtimes = new Map();
const browserFiles = new Map();
let project = { version: 1, title: 'Meine Aufführung', clickMode: 'select', overlap: true, master: 80, cues: [] };
let selected = null;
let showMode = false;
let context, masterNode, draftTimer, toastTimer;
let assigning = false;
let cueDrag = null;
let suppressCueClickUntil = 0;
let projectEpoch = 0;
let checkRunning = false;
const secondsSetting = value => Number.isFinite(Number(value)) ? Math.max(0, Math.min(120, Number(value))) : 0;

const time = seconds => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
};
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const currentCue = () => project.cues.find(cue => cue.id === selected);
const dbText = value => `${value > 0 ? '+' : ''}${value} dB`;
function toast(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').style.display = 'none'; }, 5500);
}
function newCue(file = null) {
  return { id: crypto.randomUUID(), title: file ? file.name.replace(/\.[^.]+$/, '') : 'Neuer Einsatz',
    notes: '', path: file?.path || '', fileName: file?.name || '', gain: 0, fadeIn: 0, fadeOut: 0, loop: 'off', behavior: 'stop', color: colors[project.cues.length % colors.length] };
}
function persist() {
  $('saveState').textContent = 'Speichere …';
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try {
      if (desktop) await window.theater.saveDraft(project);
      else localStorage.setItem('theater-draft-v1', JSON.stringify(project));
      $('saveState').textContent = 'Entwurf lokal gespeichert';
    } catch { $('saveState').textContent = 'Speichern fehlgeschlagen'; toast('Der lokale Entwurf konnte nicht gespeichert werden. Bitte Projektdatei speichern.'); }
  }, 300);
}
function runtime(id) {
  if (!runtimes.has(id)) runtimes.set(id, { audio: null, gainNode: null, source: null, url: null, loading: null, state: 'idle', error: '', token: 0, fadeTimer: null, fadeNode: null, loopFading: false });
  return runtimes.get(id);
}
function audioContext() {
  if (!context) {
    context = new AudioContext();
    masterNode = context.createGain();
    masterNode.gain.value = project.master / 100;
    masterNode.connect(context.destination);
  }
  return context;
}
async function prepare(cue) {
  const rt = runtime(cue.id);
  if (rt.audio) return rt;
  if (rt.loading) return rt.loading;
  rt.loading = (async () => {
    let blob;
    if (browserFiles.has(cue.id)) blob = browserFiles.get(cue.id);
    else if (desktop && cue.path) {
      const bytes = await window.theater.readAudio(cue.path);
      blob = new Blob([bytes]);
    } else throw new Error(cue.fileName ? 'Datei bitte erneut zuordnen.' : 'Bitte zuerst eine Audiodatei auswählen.');
    if (!project.cues.includes(cue) || runtimes.get(cue.id) !== rt) throw new Error('Laden abgebrochen.');
    const ctx = audioContext();
    rt.url = URL.createObjectURL(blob);
    rt.audio = new Audio();
    rt.audio.preload = 'auto';
    rt.audio.src = rt.url;
    rt.audio.loop = cue.loop === 'continuous';
    rt.source = ctx.createMediaElementSource(rt.audio);
    rt.gainNode = ctx.createGain();
    rt.gainNode.gain.value = Math.pow(10, cue.gain / 20);
    rt.fadeNode = ctx.createGain();
    rt.source.connect(rt.gainNode).connect(rt.fadeNode).connect(masterNode);
    rt.audio.addEventListener('timeupdate', () => updateLoopFade(cue, rt));
    rt.audio.addEventListener('ended', () => {
      if (cue.loop === 'fade' && rt.state === 'playing') { void repeatCue(cue, rt); return; }
      clearTimeout(rt.fadeTimer); rt.token++; rt.state = 'idle'; rt.loopFading = false;
      rt.audio.currentTime = 0; renderCards(); refreshPlayback();
    });
    rt.audio.addEventListener('loadedmetadata', () => { renderCards(); refreshPlayback(); });
    rt.audio.addEventListener('error', () => {
      rt.token++; rt.state = 'error'; rt.error = 'Audiodatei ist nicht lesbar oder das Format wird nicht unterstützt.';
      renderCards(); refreshPlayback(); toast(`${cue.title}: ${rt.error}`);
    });
    return rt;
  })();
  try { return await rt.loading; }
  finally { rt.loading = null; }
}
function stopCue(id) {
  const rt = runtimes.get(id);
  if (!rt) return;
  rt.token++;
  clearTimeout(rt.fadeTimer);
  rt.loopFading = false;
  if (rt.fadeNode) { rt.fadeNode.gain.cancelScheduledValues(context.currentTime); rt.fadeNode.gain.value = 1; }
  if (rt.audio) { rt.audio.pause(); rt.audio.currentTime = 0; }
  rt.state = 'idle';
}
function stopAll() {
  for (const id of runtimes.keys()) stopCue(id);
  renderCards(); refreshPlayback();
}
function release(id) {
  const rt = runtimes.get(id);
  if (!rt) return;
  stopCue(id);
  if (rt.audio) { rt.audio.removeAttribute('src'); rt.audio.load(); }
  rt.source?.disconnect(); rt.gainNode?.disconnect(); rt.fadeNode?.disconnect();
  if (rt.url) URL.revokeObjectURL(rt.url);
  runtimes.delete(id);
}
async function trigger(cue) {
  if (!cue) return;
  const rt = runtime(cue.id);
  if (rt.state === 'fading') { stopCue(cue.id); renderCards(); refreshPlayback(); return; }
  if (rt.state === 'playing') { fadeCue(cue, cue.behavior === 'pause'); return; }
  if (rt.state === 'loading') { stopCue(cue.id); renderCards(); refreshPlayback(); return; }
  if (!project.overlap) for (const id of runtimes.keys()) if (id !== cue.id) stopCue(id);
  const token = ++rt.token;
  rt.state = 'loading'; rt.error = '';
  renderCards(); refreshPlayback();
  try {
    await audioContext().resume();
    await prepare(cue);
    if (token !== rt.token || !project.cues.includes(cue)) return;
    rt.loopFading = false;
    rt.audio.loop = cue.loop === 'continuous';
    const fadeIn = loopFadeTime(cue, rt, cue.fadeIn);
    rt.fadeNode.gain.cancelScheduledValues(context.currentTime);
    rt.fadeNode.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, context.currentTime);
    await rt.audio.play();
    if (token !== rt.token) { rt.audio.pause(); return; }
    rt.state = 'playing';
    if (fadeIn > 0) rt.fadeNode.gain.linearRampToValueAtTime(1, context.currentTime + fadeIn);
  } catch (error) {
    if (token !== rt.token) return;
    rt.state = 'error'; rt.error = error.message;
    toast(`${cue.title}: ${error.message}`);
  }
  renderCards(); refreshPlayback();
}
function renderCards() {
  if (cueDrag) return;
  $('cueCount').textContent = project.cues.length;
  $('projectSummary').textContent = `${project.cues.length} Einsätze · ${showMode ? 'Aufführungsmodus' : 'Bearbeitungsmodus'} · ${project.overlap ? 'Überlagerung erlaubt' : 'Ein Einsatz zur Zeit'}`;
  if (!project.cues.length) {
    $('cueGrid').innerHTML = '<div class="empty">Deine Bühne ist bereit.<br><br>Füge Audiodateien oder eine leere Kachel hinzu.</div>';
    return;
  }
  $('cueGrid').innerHTML = project.cues.map((cue, index) => {
    const rt = runtimes.get(cue.id);
    const state = rt?.state || 'idle';
    const status = { playing: '● LÄUFT', paused: 'Ⅱ PAUSE', loading: 'LÄDT …', error: 'DATEI PRÜFEN', idle: cue.path || browserFiles.has(cue.id) ? 'BEREIT' : 'DATEI ZUORDNEN' }[state];
    return `<article class="cue ${selected === cue.id ? 'selected' : ''} ${state}" data-id="${escapeHtml(cue.id)}" role="button" tabindex="0" aria-label="${escapeHtml(cue.title)} – ${status}" aria-pressed="${selected === cue.id}" style="--cue-color:${cue.color}">
      <div class="cue-head"><span class="cue-index"><span class="drag-handle" draggable="false" title="Anfassen und an die markierte Position ziehen" aria-label="Kachel verschieben">⠿</span>${String(index + 1).padStart(2, '0')}</span><span class="cue-state">${status}</span></div>
      <h3>${escapeHtml(cue.title)}</h3><p>${escapeHtml(cue.notes || 'Noch keine Regie-Notiz.')}</p>
      <div class="cue-bottom"><span>${cue.loop !== 'off' ? '&#8734; ' : ''}${cue.behavior === 'pause' ? 'Ⅱ Pause / Fortsetzen' : '■ Stopp / Neustart'}</span><span class="gain">${dbText(cue.gain)}</span><span data-duration class="cue-time">${rt?.audio?.duration ? time(rt.audio.duration) : '—:—'}</span></div><div class="cue-progress"></div></article>`;
  }).join('');
}
function renderEditor() {
  const cue = currentCue();
  $('editor').querySelectorAll('input,textarea,select,button').forEach(el => { el.disabled = !cue || showMode; });
  $('cueNumber').textContent = cue ? String(project.cues.indexOf(cue) + 1).padStart(2, '0') : '—';
  $('cueTitle').value = cue?.title || '';
  $('cueNotes').value = cue?.notes || '';
  $('fileName').textContent = cue?.fileName || 'Datei auswählen …';
  $('cueBehavior').value = cue?.behavior || 'stop';
  $('cueLoop').value = cue?.loop || 'off';
  $('cueFadeIn').value = cue?.fadeIn || 0;
  $('cueFadeOut').value = cue?.fadeOut || 0;
  $('cueGain').value = cue?.gain || 0;
  $('gainValue').textContent = dbText(cue?.gain || 0);
  $('colorChoices').innerHTML = colors.map((color, i) => `<button class="swatch ${cue?.color === color ? 'active' : ''}" style="--swatch:${color}" data-color="${color}" aria-label="Kachelfarbe ${['Grün', 'Blau', 'Violett', 'Orange', 'Rosa', 'Türkis'][i]}" ${!cue || showMode ? 'disabled' : ''}></button>`).join('');
}
function render() {
  $('projectTitle').value = project.title;
  $('clickMode').value = project.clickMode;
  $('allowOverlap').checked = project.overlap;
  $('masterGain').value = project.master;
  $('masterValue').textContent = `${project.master} %`;
  document.body.classList.toggle('show-mode', showMode);
  $('modeButton').textContent = showMode ? '● Aufführung' : '◉ Bearbeiten';
  $('modeButton').classList.toggle('show', showMode);
  for (const id of ['addFiles', 'addCue', 'loadDemo', 'openProject', 'clickMode', 'allowOverlap', 'openFolder']) $(id).disabled = showMode;
  $('projectTitle').readOnly = showMode;
  renderCards(); renderEditor(); refreshPlayback();
}
function choose(id) {
  selected = id;
  renderCards(); renderEditor(); refreshPlayback();
}
function refreshPlayback() {
  const cue = currentCue();
  const rt = cue && runtimes.get(cue.id);
  $('selectedTitle').textContent = cue?.title || 'Keine Kachel ausgewählt';
  $('selectedMode').textContent = ['playing', 'fading'].includes(rt?.state) ? '● LÄUFT' : rt?.state === 'paused' ? 'PAUSIERT' : rt?.state === 'loading' ? 'LÄDT …' : rt?.state === 'error' ? 'DATEI PRÜFEN' : 'VORGEWÄHLT';
  $('playSelected').textContent = ['playing', 'fading'].includes(rt?.state) ? (cue.behavior === 'pause' ? 'Ⅱ' : '■') : rt?.state === 'loading' ? '■' : '▶';
  $('playSelected').disabled = !cue;
  $('resetSelected').disabled = !cue;
  const count = [...runtimes.values()].filter(item => ['playing', 'fading'].includes(item.state)).length;
  $('runningCount').textContent = count ? `${count} ${count === 1 ? 'Einsatz läuft' : 'Einsätze laufen'}` : 'Kein Einsatz läuft';
  updateProgress();
}
function updateProgress() {
  const rt = runtimes.get(selected);
  const position = rt?.audio?.currentTime || 0;
  const duration = Number.isFinite(rt?.audio?.duration) ? rt.audio.duration : 0;
  $('elapsed').textContent = time(position);
  $('remaining').textContent = '−' + time(duration - position);
  $('remaining').classList.toggle('ending', duration > 0 && duration - position <= 10 && ['playing', 'fading'].includes(rt?.state));
  $('mainProgress').style.width = `${duration ? position / duration * 100 : 0}%`;
  for (const card of $('cueGrid').querySelectorAll('.cue')) {
    const item = runtimes.get(card.dataset.id);
    const length = item?.audio?.duration || 0;
    const left = Math.max(0, length - (item?.audio?.currentTime || 0));
    const active = ['playing', 'paused', 'fading'].includes(item?.state);
    card.querySelector('[data-duration]').textContent = length && Number.isFinite(length) ? (active ? '\u2212' + time(left) : time(length)) : '--:--';
    card.classList.toggle('ending', length > 0 && left <= 10 && ['playing', 'fading'].includes(item?.state));
    card.querySelector('.cue-progress').style.width = `${length ? item.audio.currentTime / length * 100 : 0}%`;
  }
}
function updateCue(field, value) {
  const cue = currentCue();
  if (!cue || showMode) return;
  cue[field] = value;
  if (field === 'gain') {
    const node = runtimes.get(cue.id)?.gainNode;
    if (node) node.gain.setTargetAtTime(Math.pow(10, value / 20), context.currentTime, .02);
    $('gainValue').textContent = dbText(value);
  }
  if (field === 'loop') {
    const rt = runtimes.get(cue.id);
    if (rt?.audio) {
      rt.audio.loop = value === 'continuous';
      if (rt.state === 'playing' && rt.loopFading) {
        rt.fadeNode.gain.cancelScheduledValues(context.currentTime);
        rt.fadeNode.gain.setValueAtTime(1, context.currentTime);
      }
      rt.loopFading = false;
    }
  }
  renderCards(); refreshPlayback(); persist();
}
function normalize(raw) {
  if (raw?.version !== 1 || !Array.isArray(raw.cues) || raw.cues.length > 1000) throw new Error('Diese Datei ist kein gültiges Theaterprojekt.');
  return {
    version: 1, title: String(raw.title || 'Meine Aufführung').slice(0, 200), clickMode: raw.clickMode === 'direct' ? 'direct' : 'select',
    overlap: raw.overlap !== false, master: Number.isFinite(raw.master) ? Math.max(0, Math.min(100, raw.master)) : 80,
    cues: raw.cues.map(item => ({ id: crypto.randomUUID(), title: String(item.title || 'Einsatz').slice(0, 120), notes: String(item.notes || '').slice(0, 10000),
      path: typeof item.path === 'string' ? item.path : '', fileName: String(item.fileName || ''),
      gain: Number.isFinite(item.gain) ? Math.max(-36, Math.min(12, item.gain)) : 0,
      fadeIn: secondsSetting(item.fadeIn), fadeOut: secondsSetting(item.fadeOut),
      loop: ['continuous', 'fade'].includes(item.loop) ? item.loop : 'off',
      behavior: item.behavior === 'pause' ? 'pause' : 'stop', color: colors.includes(item.color) ? item.color : colors[0] }))
  };
}
function loadProject(raw) {
  const next = normalize(raw);
  projectEpoch++;
  for (const id of [...runtimes.keys()]) release(id);
  browserFiles.clear();
  project = next;
  selected = project.cues[0]?.id || null;
  if (masterNode) masterNode.gain.value = project.master / 100;
  render(); persist();
}
async function pickFiles(replace) {
  assigning = replace;
  if (!desktop) { $('browserFiles').multiple = !replace; $('browserFiles').click(); return; }
  const target = selected;
  const epoch = projectEpoch;
  try {
    const files = await window.theater.pickAudio();
    if (epoch !== projectEpoch) return;
    if (replace) {
      const cue = project.cues.find(item => item.id === target);
      if (files[0] && cue) { release(cue.id); cue.path = files[0].path; cue.fileName = files[0].name; }
    } else for (const file of files) { const cue = newCue(file); project.cues.push(cue); selected = cue.id; }
    render(); persist();
  } catch (error) { toast(error.message); }
}
function demo() {
  loadProject({ version: 1, title: 'Ein Abend auf der Bühne', master: 80, cues: [
    { title: 'Einlass · Atmosphäre', notes: 'Publikum kommt an. Leise unter den Saal legen.', behavior: 'pause', gain: -12, color: colors[0] },
    { title: 'Der erste Vorhang', notes: 'Lichtwechsel abwarten. Auf Zeichen der Regie.', gain: -3, color: colors[1] },
    { title: 'Gewitter', notes: 'Szene 2 · Nach „Hast du das gehört?“', gain: -6, color: colors[2] },
    { title: 'Telefon klingelt', notes: 'Zweimal klingeln lassen, dann stoppen.', gain: 0, color: colors[3] },
    { title: 'Zwischenspiel', notes: 'Umbau zu Szene 3. Auf Handzeichen ausblenden.', behavior: 'pause', gain: -9, color: colors[4] },
    { title: 'Schlussapplaus', notes: 'Nach dem letzten Satz und dem Blackout.', gain: -3, color: colors[5] }
  ] });
}

$('cueGrid').addEventListener('click', event => {
  if (Date.now() < suppressCueClickUntil) return;
  const card = event.target.closest('.cue');
  if (!card || event.target.closest('.drag-handle')) return;
  choose(card.dataset.id);
  if (project.clickMode === 'direct') void trigger(currentCue());
});
$('cueGrid').addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    const card = event.target.closest('.cue');
    if (card) { event.preventDefault(); choose(card.dataset.id); if (project.clickMode === 'direct') void trigger(currentCue()); }
  }
});
// Pointer capture haelt den Anfasspunkt auch ausserhalb der Kachel am Zeiger.
$('cueGrid').addEventListener('dragstart', event => event.preventDefault());
$('cueGrid').addEventListener('pointerdown', event => {
  const handle = event.target.closest('.drag-handle');
  if (!handle || showMode || cueDrag || event.button !== 0 || !event.isPrimary) return;
  event.preventDefault();
  const card = handle.closest('.cue'), rect = card.getBoundingClientRect();
  cueDrag = { id: card.dataset.id, card, pointerId: event.pointerId,
    startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY,
    offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top,
    width: rect.width, height: rect.height, active: false, frame: null };
  $('cueGrid').setPointerCapture(event.pointerId);
});
function moveCueDrag() {
  const drag = cueDrag;
  if (!drag?.active) return;
  drag.card.style.left = `${drag.x - drag.offsetX}px`;
  drag.card.style.top = `${drag.y - drag.offsetY}px`;
  const grid = $('cueGrid'), bounds = grid.getBoundingClientRect();
  drag.inside = drag.x >= bounds.left && drag.x <= bounds.right && drag.y >= bounds.top && drag.y <= bounds.bottom;
  drag.placeholder.classList.toggle('drop-outside', !drag.inside);
  if (!drag.inside) return;
  // Die Rasterplaetze bleiben stabil; die Luecke wandert an den naechsten Platz.
  const slots = [...grid.children];
  const centerX = drag.x - drag.offsetX + drag.width / 2;
  const centerY = drag.y - drag.offsetY + drag.height / 2;
  let index = 0, distance = Infinity;
  slots.forEach((slot, i) => {
    const r = slot.getBoundingClientRect();
    const next = (r.left + r.width / 2 - centerX) ** 2 + (r.top + r.height / 2 - centerY) ** 2;
    if (next < distance) { index = i; distance = next; }
  });
  const others = slots.filter(slot => slot !== drag.placeholder);
  grid.insertBefore(drag.placeholder, others[index] || null);
  drag.placeholder.textContent = `Hier ablegen ? Platz ${index + 1}`;
}
function scrollCueDrag() {
  const drag = cueDrag;
  if (!drag?.active) return;
  const grid = $('cueGrid'), r = grid.getBoundingClientRect();
  if (drag.inside && grid.scrollHeight > grid.clientHeight) {
    const edge = Math.min(55, r.height / 4);
    const speed = drag.y < r.top + edge ? -12 * (1 - (drag.y - r.top) / edge)
      : drag.y > r.bottom - edge ? 12 * (1 - (r.bottom - drag.y) / edge) : 0;
    if (speed) { grid.scrollTop += speed; moveCueDrag(); }
  }
  drag.frame = requestAnimationFrame(scrollCueDrag);
}
document.addEventListener('pointermove', event => {
  const drag = cueDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;
  drag.x = event.clientX; drag.y = event.clientY;
  if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) < 5) return;
  event.preventDefault();
  if (!drag.active) {
    drag.active = true;
    drag.placeholder = document.createElement('div');
    drag.placeholder.className = 'cue-drop-slot';
    drag.placeholder.style.setProperty('--cue-color', drag.card.style.getPropertyValue('--cue-color'));
    drag.placeholder.style.height = `${drag.height}px`;
    drag.card.replaceWith(drag.placeholder);
    drag.card.classList.add('cue-dragging');
    Object.assign(drag.card.style, { width: `${drag.width}px`, height: `${drag.height}px` });
    drag.card.setAttribute('aria-hidden', 'true');
    document.body.append(drag.card);
    document.body.classList.add('reordering');
    drag.frame = requestAnimationFrame(scrollCueDrag);
  }
  moveCueDrag();
}, { passive: false });
function finishCueDrag(commit = false) {
  const drag = cueDrag;
  if (!drag) return;
  cueDrag = null;
  if ($('cueGrid').hasPointerCapture(drag.pointerId)) $('cueGrid').releasePointerCapture(drag.pointerId);
  cancelAnimationFrame(drag.frame);
  if (!drag.active) return;
  suppressCueClickUntil = Date.now() + 350;
  if (commit && drag.inside && !showMode) {
    const index = [...$('cueGrid').children].indexOf(drag.placeholder);
    const from = project.cues.findIndex(cue => cue.id === drag.id);
    if (from >= 0) { const [cue] = project.cues.splice(from, 1); project.cues.splice(index, 0, cue); persist(); }
  }
  drag.card.remove(); drag.placeholder.remove();
  document.body.classList.remove('reordering');
  renderCards(); renderEditor(); refreshPlayback();
}
document.addEventListener('pointerup', event => {
  if (cueDrag?.pointerId !== event.pointerId) return;
  cueDrag.x = event.clientX; cueDrag.y = event.clientY;
  moveCueDrag(); finishCueDrag(true);
});
document.addEventListener('pointercancel', event => { if (cueDrag?.pointerId === event.pointerId) finishCueDrag(); });
$('cueGrid').addEventListener('lostpointercapture', () => finishCueDrag());
window.addEventListener('blur', () => finishCueDrag());
window.addEventListener('resize', () => finishCueDrag());
$('projectTitle').addEventListener('input', () => { project.title = $('projectTitle').value; persist(); });
$('cueTitle').addEventListener('input', () => updateCue('title', $('cueTitle').value));
$('cueNotes').addEventListener('input', () => updateCue('notes', $('cueNotes').value));
$('cueLoop').addEventListener('change', () => updateCue('loop', $('cueLoop').value));
$('cueBehavior').addEventListener('change', () => updateCue('behavior', $('cueBehavior').value));
for (const [id, field] of [['cueFadeIn','fadeIn'],['cueFadeOut','fadeOut']]) $(id).addEventListener('change', () => { updateCue(field, secondsSetting($(id).value)); renderEditor(); });
$('cueGain').addEventListener('input', () => updateCue('gain', Number($('cueGain').value)));
$('resetGain').addEventListener('click', () => { updateCue('gain', 0); $('cueGain').value = 0; });
$('colorChoices').addEventListener('click', event => { const color = event.target.dataset.color; if (color) { updateCue('color', color); renderEditor(); } });
$('addFiles').addEventListener('click', () => void pickFiles(false));
$('assignFile').addEventListener('click', () => void pickFiles(true));
$('addCue').addEventListener('click', () => { const cue = newCue(); project.cues.push(cue); selected = cue.id; render(); persist(); });
$('deleteCue').addEventListener('click', () => {
  const cue = currentCue();
  if (!cue || !confirm(`Kachel „${cue.title}“ entfernen? Die Audiodatei bleibt erhalten.`)) return;
  const index = project.cues.indexOf(cue);
  release(cue.id); browserFiles.delete(cue.id);
  project.cues.splice(index, 1);
  selected = project.cues[Math.min(index, project.cues.length - 1)]?.id || null;
  render(); persist();
});
$('clickMode').addEventListener('change', () => { project.clickMode = $('clickMode').value; persist(); });
$('allowOverlap').addEventListener('change', () => {
  project.overlap = $('allowOverlap').checked;
  if (!project.overlap) stopAll();
  renderCards(); persist();
});
$('masterGain').addEventListener('input', () => {
  project.master = Number($('masterGain').value);
  if (masterNode) masterNode.gain.setTargetAtTime(project.master / 100, context.currentTime, .02);
  $('masterValue').textContent = `${project.master} %`; persist();
});
$('modeButton').addEventListener('click', () => { if (showMode && !confirm('Vorstellungsmodus verlassen und Bearbeitung freigeben?')) return; showMode = !showMode; render(); });
$('playSelected').addEventListener('click', () => void trigger(currentCue()));
$('resetSelected').addEventListener('click', () => { if (selected) { stopCue(selected); renderCards(); refreshPlayback(); } });
$('stopAll').addEventListener('click', stopAll);
$('loadDemo').addEventListener('click', () => { if (confirm('Aktuelle Anordnung durch sechs Demo-Kacheln ersetzen? Die Demo enthält keine Audiodateien.')) demo(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); finishCueDrag(); stopAll(); return; }
  if ($('checkDialog').open) return;
  if (event.target.closest('input,textarea,select,[contenteditable=true]') || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'Space') {
    event.preventDefault();
    if (!event.repeat) void trigger(currentCue());
  } else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    const index = project.cues.findIndex(cue => cue.id === selected);
    const columns = getComputedStyle($('cueGrid')).gridTemplateColumns.split(' ').length;
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
    const next = Math.max(0, Math.min(project.cues.length - 1, index + step));
    if (project.cues[next]) choose(project.cues[next].id);
  }
});
$('browserFiles').addEventListener('change', () => {
  const files = [...$('browserFiles').files];
  if (assigning) {
    const cue = currentCue();
    if (files[0] && cue) { release(cue.id); browserFiles.set(cue.id, files[0]); cue.path = ''; cue.fileName = files[0].name; }
  } else for (const file of files) {
    const cue = newCue({ name: file.name });
    project.cues.push(cue); browserFiles.set(cue.id, file); selected = cue.id;
  }
  $('browserFiles').value = ''; render(); persist();
});
async function saveProject(portable = false) {
  try {
    if (desktop) {
      const file = await window.theater.saveProject(project, portable);
      if (file) toast(portable ? 'Projekt und Audiodateien wurden exportiert.' : 'Projektdatei gespeichert.');
    } else {
      if (portable) { toast('Export mit Audiodateien steht im Desktopprogramm zur Verfügung.'); return; }
      const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url;
      link.download = (project.title.replace(/[^a-z0-9äöüß_-]/gi, '_') || 'Auffuehrung') + '.theater.json';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Projekt gespeichert. Im Browser müssen Audiodateien nach dem Öffnen erneut zugeordnet werden.');
    }
  } catch (error) { toast('Speichern fehlgeschlagen: ' + error.message); }
}
$('saveProject').addEventListener('click', () => void saveProject());
$('exportProject').addEventListener('click', () => void saveProject(true));
$('openProject').addEventListener('click', async () => {
  if (!confirm('Anderes Projekt öffnen? Der aktuelle Stand sollte vorher als Projektdatei gespeichert sein.')) return;
  try {
    if (desktop) { const data = await window.theater.openProject(); if (data) { loadProject(data); toast('Projekt geladen.'); } }
    else $('browserProject').click();
  } catch (error) { toast('Öffnen fehlgeschlagen: ' + error.message); }
});
$('browserProject').addEventListener('change', async () => {
  try { const file = $('browserProject').files[0]; if (file) { loadProject(JSON.parse(await file.text())); toast('Projekt geladen. Audiodateien bitte erneut zuordnen.'); } }
  catch (error) { toast(error.message); }
  $('browserProject').value = '';
});
async function init() {
  try {
    const raw = desktop ? await window.theater.loadDraft() : JSON.parse(localStorage.getItem('theater-draft-v1') || 'null');
    if (raw) loadProject(raw); else demo();
  } catch { demo(); }
  $('footerHint').textContent = desktop ? 'Desktop · Automatische Entwurfssicherung aktiv' : 'Browser-Vorschau · Audiodateien nach Neustart erneut zuordnen';
  render();
  setInterval(updateProgress, 100);
}
void init();

function fadeCue(cue, pause = false) {
  const rt = runtimes.get(cue.id);
  if (!rt || !['playing', 'fading'].includes(rt.state)) return;
  if (rt.state === 'fading') return;
  const finish = () => {
    if (pause) { rt.token++; rt.audio.pause(); rt.state = 'paused'; }
    else stopCue(cue.id);
    renderCards(); refreshPlayback();
  };
  if (!cue.fadeOut) { finish(); return; }
  const token = ++rt.token;
  rt.state = 'fading';
  rt.fadeNode.gain.cancelAndHoldAtTime(context.currentTime);
  rt.fadeNode.gain.linearRampToValueAtTime(0, context.currentTime + cue.fadeOut);
  rt.fadeTimer = setTimeout(() => { if (rt.token === token) finish(); }, cue.fadeOut * 1000);
  renderCards(); refreshPlayback();
}
$('fadeAll').addEventListener('click', () => {
  for (const cue of project.cues) {
    const rt = runtimes.get(cue.id);
    if (rt?.state === 'loading' || rt?.state === 'paused') stopCue(cue.id);
    else fadeCue(cue);
  }
  renderCards(); refreshPlayback();
});
window.addEventListener('beforeunload', event => {
  if (showMode || [...runtimes.values()].some(rt => ['playing','fading','loading'].includes(rt.state))) {
    event.preventDefault(); event.returnValue = '';
  }
});
function metadataReady(audio) {
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => { clearTimeout(timer); audio.removeEventListener('loadedmetadata', ok); audio.removeEventListener('error', fail); };
    const ok = () => { cleanup(); Number.isFinite(audio.duration) && audio.duration > 0 ? resolve() : reject(new Error('Keine gueltige Spieldauer')); };
    const fail = () => { cleanup(); reject(new Error('Format nicht lesbar')); };
    audio.addEventListener('loadedmetadata', ok); audio.addEventListener('error', fail);
    timer = setTimeout(() => { cleanup(); reject(new Error('Zeitlimit beim Lesen')); }, 15000);
    if (audio.error) fail(); else if (audio.readyState >= 1) ok();
  });
}
async function runCheck() {
  if (checkRunning) return false;
  checkRunning = true; $('runCheck').disabled = true;
  const epoch = projectEpoch;
  const cues = [...project.cues];
  $('checkResults').replaceChildren();
  let failures = 0;
  try {
    for (const cue of cues) {
      const row = document.createElement('p'); row.textContent = '... ' + cue.title; $('checkResults').append(row);
      try {
        if (desktop && cue.path && !browserFiles.has(cue.id)) await window.theater.checkAudio(cue.path);
        const rt = await prepare(cue); await metadataReady(rt.audio);
        row.textContent = 'OK: ' + cue.title + ' / ' + time(rt.audio.duration); row.className = 'check-ok';
      }
      catch (error) { failures++; row.textContent = 'OK: ' + cue.title + ' / ' + error.message; row.textContent = row.textContent.replace('OK: ', 'FEHLER: '); row.className = 'check-error'; }
      if (epoch !== projectEpoch) throw new Error('Projekt wurde waehrend der Pruefung geaendert. Bitte erneut pruefen.');
    }
    const result = document.createElement('p');
    result.textContent = !cues.length ? 'Keine Einsaetze vorhanden.' : failures ? failures + ' Einsatz/Einsaetze muessen korrigiert werden.' : 'Alle ' + cues.length + ' Audiodateien lesbar. Saalausgang bitte noch hoerbar testen.';
    $('checkResults').append(result);
    return cues.length > 0 && failures === 0;
  } catch (error) { toast(error.message); return false; }
  finally { checkRunning = false; $('runCheck').disabled = false; }
}
async function refreshOutputs() {
  const select = $('audioOutput');
  try {
    const devices = await navigator.mediaDevices?.enumerateDevices();
    const outputs = devices?.filter(d => d.kind === 'audiooutput' && d.deviceId !== 'default') || [];
    select.replaceChildren(new Option('Systemstandard', ''));
    outputs.forEach((d, i) => select.add(new Option(d.label || 'Audioausgang ' + (i + 1), d.deviceId)));
    select.value = context?.sinkId || '';
    select.disabled = !AudioContext.prototype.setSinkId;
    $('outputHint').textContent = select.disabled ? 'Auswahl im Betriebssystem vornehmen. Aktiver Ausgang: Systemstandard.' : 'Auswahl gilt fuer diese Sitzung. Systemstandard folgt der Audioauswahl des Betriebssystems.';
  } catch { select.disabled = true; $('outputHint').textContent = 'Systemstandard aktiv. Audioausgang in den Systemeinstellungen pruefen.'; }
}
$('preflight').addEventListener('click', () => { $('checkDialog').showModal(); void refreshOutputs(); });
$('closeCheck').addEventListener('click', () => $('checkDialog').close());
$('runCheck').addEventListener('click', () => void runCheck());
$('audioOutput').addEventListener('change', async () => {
  try { await audioContext().setSinkId($('audioOutput').value); }
  catch (error) { toast('Audioausgang konnte nicht geaendert werden: ' + error.message); await refreshOutputs(); }
});
$('testTone').addEventListener('click', async () => {
  $('testTone').disabled = true;
  try {
    const ctx = audioContext(); await ctx.resume();
    const oscillator = ctx.createOscillator(), level = ctx.createGain();
    oscillator.frequency.value = 440; level.gain.setValueAtTime(0, ctx.currentTime);
    level.gain.linearRampToValueAtTime(.025, ctx.currentTime + .05);
    level.gain.setValueAtTime(.025, ctx.currentTime + .85);
    level.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    oscillator.connect(level).connect(masterNode);
    oscillator.onended = () => { oscillator.disconnect(); level.disconnect(); $('testTone').disabled = false; };
    oscillator.start(); oscillator.stop(ctx.currentTime + 1);
  } catch (error) { $('testTone').disabled = false; toast(error.message); }
});

// Standard-ZIP ohne Kompression: Audiodateien sind bereits komprimiert.
function zipBundle(entries) {
  const encoder = new TextEncoder(), local = [], central = [];
  let offset = 0, centralSize = 0;
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  for (const entry of entries) {
    const name = encoder.encode(entry.name), bytes = entry.bytes, crc = crc32(bytes);
    if (offset + bytes.length > 0x7fffffff) throw new Error('Browserexport ist auf 2 GB begrenzt. Bitte Desktopversion verwenden.');
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(12, 33, true);
    h.setUint32(14, crc, true); h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true); h.setUint16(26, name.length, true); header.set(name, 30);
    const directory = new Uint8Array(46 + name.length), d = new DataView(directory.buffer);
    d.setUint32(0, 0x02014b50, true); d.setUint16(4, 20, true); d.setUint16(6, 20, true); d.setUint16(8, 0x800, true); d.setUint16(14, 33, true);
    d.setUint32(16, crc, true); d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true); d.setUint16(28, name.length, true); d.setUint32(42, offset, true); directory.set(name, 46);
    local.push(header, bytes); central.push(directory); offset += header.length + bytes.length; centralSize += directory.length;
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, centralSize, true); e.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}
async function exportBrowserBundle() {
  const copy = structuredClone(project), entries = [];
  for (const [i, cue] of copy.cues.entries()) {
    const file = browserFiles.get(cue.id);
    if (!file) throw new Error('Audiodatei fehlt: ' + cue.title);
    cue.path = 'audio/' + String(i + 1).padStart(3, '0') + '-' + file.name.replace(/[\\/]/g, '_');
    entries.push({ name: cue.path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  entries.push({ name: 'Auffuehrung.theater.json', bytes: new TextEncoder().encode(JSON.stringify(copy, null, 2)) });
  const url = URL.createObjectURL(zipBundle(entries)), link = document.createElement('a');
  link.href = url; link.download = 'Theater-Projekt.zip'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('ZIP exportiert. Zum Oeffnen entpacken und im Browser den Projektordner oeffnen.');
}
$('openFolder').hidden = desktop;
$('openFolder').addEventListener('click', () => { if (!showMode && confirm('Projektordner laden? Aktuellen Stand vorher speichern.')) $('browserFolder').click(); });
$('browserFolder').addEventListener('change', async () => {
  try {
    const files = [...$('browserFolder').files], json = files.filter(f => f.name.endsWith('.theater.json'));
    if (json.length !== 1) throw new Error('Ordner muss genau eine .theater.json enthalten.');
    const raw = JSON.parse(await json[0].text()), next = normalize(raw);
    const base = json[0].webkitRelativePath.slice(0, -json[0].name.length);
    const mapped = next.cues.map(cue => files.find(f => f.webkitRelativePath === base + cue.path.replace(/\\/g, '/')));
    if (mapped.some(file => !file)) throw new Error('Mindestens eine Audiodatei fehlt im Projektordner.');
    loadProject(raw);
    project.cues.forEach((cue, i) => browserFiles.set(cue.id, mapped[i]));
    render(); toast('Projekt mit Audiodateien geladen.');
  } catch (error) { toast(error.message); }
  $('browserFolder').value = '';
});

function loopFadeTime(cue, rt, value) {
  return cue.loop === 'fade' && Number.isFinite(rt.audio?.duration)
    ? Math.min(value || 0, rt.audio.duration / 2) : (value || 0);
}
function updateLoopFade(cue, rt) {
  if (cue.loop !== 'fade' || rt.state !== 'playing' || rt.loopFading || !cue.fadeOut) return;
  const remaining = rt.audio.duration - rt.audio.currentTime;
  const length = loopFadeTime(cue, rt, cue.fadeOut);
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > length) return;
  rt.loopFading = true;
  rt.fadeNode.gain.cancelAndHoldAtTime(context.currentTime);
  rt.fadeNode.gain.linearRampToValueAtTime(0, context.currentTime + remaining);
}
async function repeatCue(cue, rt) {
  const token = ++rt.token;
  rt.loopFading = false;
  rt.audio.currentTime = 0;
  const length = loopFadeTime(cue, rt, cue.fadeIn);
  rt.fadeNode.gain.cancelScheduledValues(context.currentTime);
  rt.fadeNode.gain.setValueAtTime(length > 0 ? 0 : 1, context.currentTime);
  try {
    await rt.audio.play();
    if (rt.token !== token) { if (rt.state !== 'playing') rt.audio.pause(); return; }
    if (length > 0) rt.fadeNode.gain.linearRampToValueAtTime(1, context.currentTime + length);
    renderCards(); refreshPlayback();
  } catch (error) {
    if (rt.token !== token) return;
    rt.state = 'error'; rt.error = error.message; renderCards(); refreshPlayback(); toast(error.message);
  }
}
