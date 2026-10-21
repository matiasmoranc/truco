const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../app.js'),'utf8');
function setup(reduced=false){
 const animations=[],container={children:[],insertBefore(node,before){const old=this.children.indexOf(node);if(old>=0)this.children.splice(old,1);const index=before?this.children.indexOf(before):this.children.length;this.children.splice(index,0,node);node.parent=this;}};
 function node(){const vars={};return {dataset:{},style:{setProperty(k,v){vars[k]=v;},removeProperty(k){delete this[k];}},vars,setAttribute(k,v){this[k]=v;},getBoundingClientRect(){return {left:150+container.children.indexOf(this)*50-container.children.length*25,top:400,width:80,height:130};},remove(){const i=container.children.indexOf(this);if(i>=0)container.children.splice(i,1);},animate(frames,options){animations.push({card:this.dataset.card,frames,options});return {finished:Promise.resolve(),cancel(){}};}};}
 const c={state:{},$:()=>container,document:{createElement:node},matchMedia:q=>({matches:q.includes('reduced-motion')?reduced:true}),getComputedStyle:n=>({transform:n.style.transform||`rotate(${n.vars['--hand-fan-angle']||'0deg'})`}),cardImageStyle:()=>'',cardAccessibleName:c=>c.id};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function handFanPose('),source.indexOf('let activeCardFlight=null;')),c);
 return {c,container,animations};
}
const cards=['a','b','c'].map(id=>({id}));
test('Three cards become two tilted cards, then one centered upright card',()=>{
 const {c,container,animations}=setup();c.renderPlayerHand(cards,true);const [a,b,d]=container.children;
 assert.deepEqual(container.children.map(n=>n.vars['--hand-fan-angle']),['-12deg','0deg','12deg']);assert.equal(animations.length,0);
 c.state.launchingCardId='a';c.renderPlayerHand(cards,false);
 assert.deepEqual(container.children,[b,d]);assert.deepEqual(container.children.map(n=>n.vars['--hand-fan-angle']),['-7.5deg','7.5deg']);assert.equal(animations.length,2);assert.ok(animations.every(a=>a.options.duration===180));
 c.state.launchingCardId='b';c.renderPlayerHand(cards.slice(1),false);assert.equal(container.children.length,1);assert.equal(container.children[0],d);assert.equal(d.vars['--hand-fan-angle'],'0deg');assert.equal(d.vars['--hand-fan-y'],'0px');assert.equal(animations.at(-1).options.duration,180);
});
test('Server snapshots and turn changes preserve cards and do not restart centering',()=>{
 const {c,container,animations}=setup();c.renderPlayerHand(cards,true);c.state.launchingCardId='a';c.renderPlayerHand(cards,false);const nodes=[...container.children],count=animations.length;
 for(let i=0;i<5;i++)c.renderPlayerHand(cards,i%2===0);
 assert.deepEqual(container.children,nodes);assert.equal(animations.length,count);assert.equal(nodes[0]['aria-disabled'],'false');
});
test('A failed play restores the removed card and recenters the same remaining nodes',()=>{
 const {c,container,animations}=setup();c.renderPlayerHand(cards,true);const b=container.children[1];c.state.launchingCardId='a';c.renderPlayerHand(cards,false);c.state.launchingCardId=null;c.renderPlayerHand(cards,true);
 assert.equal(container.children.length,3);assert.equal(container.children[1],b);assert.equal(b.vars['--hand-fan-angle'],'0deg');assert.equal(animations.length,4);
});
test('Reduced-motion users get the final balanced fan without movement',()=>{
 const {c,container,animations}=setup(true);c.renderPlayerHand(cards,true);c.state.launchingCardId='b';c.renderPlayerHand(cards,false);assert.deepEqual(container.children.map(n=>n.vars['--hand-fan-angle']),['-7.5deg','7.5deg']);assert.equal(animations.length,0);
});
