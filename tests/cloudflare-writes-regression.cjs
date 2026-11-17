'use strict';
// Cloudflare's free plan allows 100,000 rows written and 100,000 object requests a day: a table must not
// save when nothing changed, and pages must not keep asking for timers that already ran.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');

test('A table answers a command that changes nothing without saving, and never sets the same alarm twice',()=>{
 const room=read('cloudflare/src/table-room.js');
 const act=room.slice(room.indexOf("if(message.t==='act')"),room.indexOf("throw new Error('Mensaje desconocido.')"));
 assert.ok(act.indexOf('const before=JSON.stringify(this.engine.snapshot())')<act.indexOf('await this.engine.act('));
 assert.match(act,/if\(JSON\.stringify\(this\.engine\.snapshot\(\)\)===before\)return this\.result\(uid\);/);
 const arm=room.slice(room.indexOf('async arm(){'),room.indexOf('async alarm(){'));
 assert.match(arm,/if\(next===this\.alarmAt\)return;/);
 assert.match(room,/async alarm\(\)\{\s*\/\/[^\n]*\n\s*this\.alarmAt=undefined;/,'a fired alarm is forgotten');
});

test('A finished game sends no ticks, and a tick that changed nothing waits 15 seconds for the next',()=>{
 const app=read('app.js');
 const due=app.slice(app.indexOf('function managedTickDue('),app.indexOf('let lastTick='));
 assert.ok(due.indexOf("if(room.status==='complete')return false;")<due.indexOf('connectionPresence'),'no disconnect ticks once the game ended');
 assert.match(app,/if\(key===lastTick\.key&&now-lastTick\.at<15000\)return;/);
});
