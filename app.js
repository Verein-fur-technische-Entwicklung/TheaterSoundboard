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
let dragId = null;
let projectEpoch = 0;

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
    notes: '', path: file?.path || '', fileName: file?.name || '', gain: 0, behavior: 'stop', color: colors[project.cues.length % colors.length] };
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
  if (!runtimes.has(id)) runtimes.set(id, { audio: null, gainNode: null, source: null, url: null, loading: null, state: 'idle', error: '', token: 0 });
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
    if (desktop && cue.path) {
      const bytes = await window.theater.readAudio(cue.path);
      blob = new Blob([bytes]);
    } else if (browserFiles.has(cue.id)) blob = browserFiles.get(cue.id);
    else throw new Error(cue.fileName ? 'Datei bitte erneut zuordnen.' : 'Bitte zuerst eine Audiodatei auswählen.');
    if (!project.cues.includes(cue) || runtimes.get(cue.id) !== rt) throw new Error('Laden abgebrochen.');
    const ctx = audioContext();
    rt.url = URL.createObjectURL(blob);
    rt.audio = new Audio();
    rt.audio.preload = 'auto';
    rt.audio.src = rt.url;
    rt.source = ctx.createMediaElementSource(rt.audio);
    rt.gainNode = ctx.createGain();
    rt.gainNode.gain.value = Math.pow(10, cue.gain / 20);
    rt.source.connect(rt.gainNode).connect(masterNode);
    rt.audio.addEventListener('ended', () => {
      rt.state = 'idle'; rt.audio.currentTime = 0; renderCards(); refreshPlayback();
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
  rt.source?.disconnect(); rt.gainNode?.disconnect();
  if (rt.url) URL.revokeObjectURL(rt.url);
  runtimes.delete(id);
}
async function trigger(cue) {
  if (!cue) return;
  const rt = runtime(cue.id);
  if (rt.state === 'playing') {
    if (cue.behavior === 'pause') { rt.token++; rt.audio.pause(); rt.state = 'paused'; }
    else stopCue(cue.id);
    renderCards(); refreshPlayback(); return;
  }
  if (rt.state === 'loading') { stopCue(cue.id); renderCards(); refreshPlayback(); return; }
  if (!project.overlap) for (const id of runtimes.keys()) if (id !== cue.id) stopCue(id);
  const token = ++rt.token;
  rt.state = 'loading'; rt.error = '';
  renderCards(); refreshPlayback();
  try {
    await audioContext().resume();
    await prepare(cue);
    if (token !== rt.token || !project.cues.includes(cue)) return;
    await rt.audio.play();
    if (token !== rt.token) { rt.audio.pause(); return; }
    rt.state = 'playing';
  } catch (error) {
    if (token !== rt.token) return;
    rt.state = 'error'; rt.error = error.message;
    toast(`${cue.title}: ${error.message}`);
  }
  renderCards(); refreshPlayback();
}
function renderCards() {
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
      <div class="cue-head"><span class="cue-index"><span class="drag-handle" draggable="${!showMode}" title="Kachel verschieben">⠿</span>${String(index + 1).padStart(2, '0')}</span><span class="cue-state">${status}</span></div>
      <h3>${escapeHtml(cue.title)}</h3><p>${escapeHtml(cue.notes || 'Noch keine Regie-Notiz.')}</p>
      <div class="cue-bottom"><span>${cue.behavior === 'pause' ? 'Ⅱ Pause / Fortsetzen' : '■ Stopp / Neustart'}</span><span class="gain">${dbText(cue.gain)}</span><span data-duration>${rt?.audio?.duration ? time(rt.audio.duration) : '—:—'}</span></div><div class="cue-progress"></div></article>`;
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
  for (const id of ['addFiles', 'addCue', 'loadDemo', 'openProject']) $(id).disabled = showMode;
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
  $('selectedMode').textContent = rt?.state === 'playing' ? '● LÄUFT' : rt?.state === 'paused' ? 'PAUSIERT' : rt?.state === 'loading' ? 'LÄDT …' : rt?.state === 'error' ? 'DATEI PRÜFEN' : 'VORGEWÄHLT';
  $('playSelected').textContent = rt?.state === 'playing' ? (cue.behavior === 'pause' ? 'Ⅱ' : '■') : rt?.state === 'loading' ? '■' : '▶';
  $('playSelected').disabled = !cue;
  $('resetSelected').disabled = !cue;
  const count = [...runtimes.values()].filter(item => item.state === 'playing').length;
  $('runningCount').textContent = count ? `${count} ${count === 1 ? 'Einsatz läuft' : 'Einsätze laufen'}` : 'Kein Einsatz läuft';
  updateProgress();
}
function updateProgress() {
  const rt = runtimes.get(selected);
  const position = rt?.audio?.currentTime || 0;
  const duration = Number.isFinite(rt?.audio?.duration) ? rt.audio.duration : 0;
  $('elapsed').textContent = time(position);
  $('remaining').textContent = '−' + time(duration - position);
  $('mainProgress').style.width = `${duration ? position / duration * 100 : 0}%`;
  for (const card of $('cueGrid').querySelectorAll('.cue')) {
    const item = runtimes.get(card.dataset.id);
    const length = item?.audio?.duration || 0;
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
$('cueGrid').addEventListener('dragstart', event => {
  if (showMode || !event.target.closest('.drag-handle')) { event.preventDefault(); return; }
  dragId = event.target.closest('.cue').dataset.id;
  event.dataTransfer.setData('text/plain', dragId);
  event.dataTransfer.effectAllowed = 'move';
});
$('cueGrid').addEventListener('dragover', event => { if (!showMode && dragId) event.preventDefault(); });
$('cueGrid').addEventListener('drop', event => {
  event.preventDefault();
  if (showMode || !dragId) return;
  const target = event.target.closest('.cue')?.dataset.id;
  if (target && target !== dragId) {
    const from = project.cues.findIndex(cue => cue.id === dragId);
    const to = project.cues.findIndex(cue => cue.id === target);
    const [cue] = project.cues.splice(from, 1);
    project.cues.splice(to, 0, cue);
    renderCards(); renderEditor(); persist();
  }
  dragId = null;
});
$('cueGrid').addEventListener('dragend', () => { dragId = null; });
$('projectTitle').addEventListener('input', () => { project.title = $('projectTitle').value; persist(); });
$('cueTitle').addEventListener('input', () => updateCue('title', $('cueTitle').value));
$('cueNotes').addEventListener('input', () => updateCue('notes', $('cueNotes').value));
$('cueBehavior').addEventListener('change', () => updateCue('behavior', $('cueBehavior').value));
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
$('modeButton').addEventListener('click', () => { showMode = !showMode; render(); });
$('playSelected').addEventListener('click', () => void trigger(currentCue()));
$('resetSelected').addEventListener('click', () => { if (selected) { stopCue(selected); renderCards(); refreshPlayback(); } });
$('stopAll').addEventListener('click', stopAll);
$('loadDemo').addEventListener('click', () => { if (confirm('Aktuelle Anordnung durch sechs Demo-Kacheln ersetzen? Die Demo enthält keine Audiodateien.')) demo(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); stopAll(); return; }
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
