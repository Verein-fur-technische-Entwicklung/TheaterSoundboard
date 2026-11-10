// Test packaged app, then restart the entire process to verify restored audio paths.
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), port=9233;
const binary=path.resolve(process.argv[2]);
const scriptName=process.argv[3]||'files-smoke.cjs';
const profileName=scriptName==='loop-smoke.cjs'?'.loop-test-data':'.files-test-data';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function connect(){
 for(let i=0;i<120;i++)try{
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws=new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return ws;
 }catch{await delay(500);}
 throw Error('Inspector unavailable');
}
async function evaluate(ws,expression){
 const id=1;return new Promise((resolve,reject)=>{
  const listener=e=>{const m=JSON.parse(e.data);if(m.id!==id)return;ws.removeEventListener('message',listener);m.result?.exceptionDetails?reject(Error(JSON.stringify(m.result.exceptionDetails))):resolve(m.result?.result?.value);};
  ws.addEventListener('message',listener);ws.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}}));
 });
}
function launch(){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;return spawn(binary,[`--inspect=127.0.0.1:${port}`,'--disable-gpu',`--user-data-dir=${path.join(root,profileName)}`],{env,stdio:['ignore','pipe','pipe']});}
(async()=>{
 await fs.rm(path.join(root,profileName,'result.json'),{force:true});
 let child=launch();child.stdout.on('data',b=>process.stdout.write(b));child.stderr.on('data',()=>{});
 let ws=await connect();
 for(let i=0;i<100;i++){if(await evaluate(ws,`Boolean(process.mainModule && process.mainModule.require('electron').app.isReady() && process.mainModule.require('electron').BrowserWindow.getAllWindows().some(w=>w.webContents.getURL()&&!w.webContents.isLoading()))`))break;await delay(100);}
 const source=(await fs.readFile(path.join(root,'tests',scriptName),'utf8')).replace("require('../main.cjs');",'// packaged process');
 await evaluate(ws,`(function(require,__dirname){${source}\n})(process.mainModule.require.bind(process.mainModule),${JSON.stringify(path.join(root,'tests'))})`);ws.close();
 let result;
 for(let i=0;i<180;i++){try{result=JSON.parse(await fs.readFile(path.join(root,profileName,'result.json'),'utf8'));break;}catch{await delay(500);}}
 assert.equal(result?.status,'passed');await delay(1000);
 if(scriptName==='loop-smoke.cjs'){console.log('PASS packaged loop:',result.checks);return;}
 child=launch();child.stderr.on('data',()=>{});ws=await connect();
 const restarted=await evaluate(ws,`(async()=>{
  const require=process.mainModule.require.bind(process.mainModule);const {BrowserWindow}=require('electron');const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const win=BrowserWindow.getAllWindows()[0];if(win.webContents.isLoading())await new Promise(r=>win.webContents.once('did-finish-load',r));
  const js=s=>win.webContents.executeJavaScript(s,true);
  for(let i=0;i<50;i++){if(await js('project.cues.length')===3)break;await delay(100);}
  const title=await js('project.title'),check=await js('runCheck()');
  await js('choose(project.cues[0].id);trigger(currentCue())');await delay(300);
  const state=await js('runtime(selected).state');await js('stopAll()');
  return {title,check,state,version:require('electron').app.getVersion()};
 })()`);
 assert.equal(restarted.title,'MP3-Praxistest');assert.equal(restarted.check,true);assert.equal(restarted.state,'playing');
 await fs.writeFile(path.join(root,'.files-test-data/packaged-restart.json'),JSON.stringify(restarted,null,2));
 await evaluate(ws,`setTimeout(()=>process.mainModule.require('electron').app.exit(0),100);true`);ws.close();
 console.log('PASS packaged application and full process restart:',restarted);
})().catch(e=>{console.error(e);process.exitCode=1;});
