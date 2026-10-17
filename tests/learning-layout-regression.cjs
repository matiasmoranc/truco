const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
const start=source.indexOf('function learningArrowPath(');
const end=source.indexOf('\nconst learningSeen',start);
const arrow=Function(source.slice(start,end)+';return learningArrowPath;')();
const box={left:100,right:350,top:80,bottom:220,width:250,height:140};
test('Practice arrows reach the visible tally edge, not outside the viewport',()=>{
  const path=arrow(box,{left:6,right:80,top:130,bottom:280,width:74,height:150});
  assert.ok(path.endsWith('87 204'));
  assert.ok(!path.includes('-'));
});
test('Practice arrows point upward at the guide and downward at actions',()=>{
  assert.ok(arrow(box,{left:300,right:340,top:10,bottom:50,width:40,height:40}).endsWith('320 57'));
  assert.ok(arrow(box,{left:100,right:350,top:600,bottom:640,width:250,height:40}).endsWith('225 593'));
});
