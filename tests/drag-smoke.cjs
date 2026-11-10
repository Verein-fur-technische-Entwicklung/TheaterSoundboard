const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const path = require('node:path');
const projectRoot = path.resolve(__dirname, '..');
const fs = require('node:fs/promises');
app.setPath('userData', path.join(projectRoot, '.drag-test-data'));
require('../main.cjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const deadline = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    if (win.webContents.isLoading()) await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    await delay(500);
    const js = async script => {try{return await win.webContents.executeJavaScript(script,true);}catch(e){console.error('SCRIPT',script);throw e;}};
    await js('demo();');
    const mouse = async (type, x, y) => { if(type==='mouseDown'){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y)});await delay(40);} win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1}); await delay(60); };
    const positions = () => js(`Array.from(document.querySelectorAll('#cueGrid .cue')).map(c=>{const r=c.getBoundingClientRect(),h=c.querySelector('.drag-handle').getBoundingClientRect();return {x:h.left+h.width/2,y:h.top+h.height/2,left:r.left,top:r.top,id:c.dataset.id}})`);
    let pos = await positions();
    const original = await js('project.cues.map(c=>c.id)');
    await mouse('mouseMove',pos[0].x,pos[0].y); await mouse('mouseDown',pos[0].x,pos[0].y);
    await mouse('mouseMove',pos[2].x,pos[2].y);
    assert.equal(await js('cueDrag.active'),true);
    const anchor = await js(`(()=>{const r=cueDrag.card.getBoundingClientRect();return {x:r.left+cueDrag.offsetX,y:r.top+cueDrag.offsetY,slot:[...$('cueGrid').children].indexOf(cueDrag.placeholder)}})()`);
    assert.ok(Math.abs(anchor.x-pos[2].x)<1); assert.ok(Math.abs(anchor.y-pos[2].y)<1); assert.equal(anchor.slot,2);
    await js('renderCards();');
    assert.equal(await js(`document.querySelectorAll('.cue-drop-slot').length`),1);
    await fs.writeFile(path.join(projectRoot,'preview-drag.png'),(await win.webContents.capturePage()).toPNG());
    await mouse('mouseUp',pos[2].x,pos[2].y);
    assert.deepEqual(await js('project.cues.map(c=>c.id)'),[original[1],original[2],original[0],...original.slice(3)]);
    assert.equal(await js('selected'),original[0]);
    assert.equal(await js(`document.querySelectorAll('.cue-dragging,.cue-drop-slot').length`),0);
    // Rueckwaerts ziehen.
    pos=await positions(); await mouse('mouseDown',pos[2].x,pos[2].y); await mouse('mouseMove',pos[0].x,pos[0].y); await mouse('mouseUp',pos[0].x,pos[0].y);
    assert.deepEqual(await js('project.cues.map(c=>c.id)'),original);
    // Ausserhalb loslassen verwirft die Bewegung.
    pos=await positions(); await mouse('mouseDown',pos[0].x,pos[0].y); await mouse('mouseMove',15,15); await mouse('mouseUp',15,15);
    assert.deepEqual(await js('project.cues.map(c=>c.id)'),original);
    // Escape verwirft ebenfalls.
    await mouse('mouseDown',pos[0].x,pos[0].y); await mouse('mouseMove',pos[1].x,pos[1].y);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
    await mouse('mouseUp',pos[1].x,pos[1].y);
    assert.deepEqual(await js('project.cues.map(c=>c.id)'),original);
    // Automatisches Scrollen am unteren Rand.
    await js(`$('cueGrid').style.maxHeight='210px';`); pos=await positions();
    const bounds=await js(`(()=>{const r=$('cueGrid').getBoundingClientRect();return {bottom:r.bottom}})()`);
    await mouse('mouseDown',pos[0].x,pos[0].y);await mouse('mouseMove',pos[0].x,bounds.bottom-5);await delay(500);
    assert.ok(await js(`$('cueGrid').scrollTop`)>0);
    await js('finishCueDrag();'); await mouse('mouseUp',pos[0].x,bounds.bottom-5);
    assert.deepEqual(await js('project.cues.map(c=>c.id)'),original);
    await js(`showMode=true; render();`);
    assert.equal(await js(`getComputedStyle(document.querySelector('.drag-handle')).visibility`),'hidden');
    await js('showMode=false; render();');
    console.log('PASS: Echte Mausbewegungen, fester Anfasspunkt, Einrastvorschau, vor/zurueck sortieren, Abbruch ausserhalb/Escape, Autoscroll und Vorstellungsmodus.');
    clearTimeout(deadline);app.exit(0);
  } catch(error) {console.error(error);clearTimeout(deadline);app.exit(1);}
});
