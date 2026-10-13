const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('mobile/rewarded-ads.js','utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'')+'\nglobalThis.ads=rewardedAds;';
function setup(platform,{earned=true,consent=true}={}){
 const events={Rewarded:'reward',Dismissed:'dismiss',FailedToShow:'failed'},listeners={},loads=[],calls=[];
 const AdMob={requestConsentInfo:async()=>({canRequestAds:consent,status:'NOT_REQUIRED'}),initialize:async()=>calls.push('initialize'),addListener:async(name,fn)=>{listeners[name]=fn;return {remove:async()=>{delete listeners[name];}};},prepareRewardVideoAd:async options=>loads.push(options),showRewardVideoAd:async()=>{if(earned)listeners.reward({amount:1,type:'credit'});listeners.dismiss();return {amount:earned?1:0};}};
 const sandbox={AdMob,AdmobConsentStatus:{REQUIRED:'REQUIRED'},RewardAdPluginEvents:events,Capacitor:{isNativePlatform:()=>platform!=='web',getPlatform:()=>platform},setTimeout};
 vm.runInNewContext(source,sandbox);
 return {ads:sandbox.ads,loads,calls,listeners,api:async(name,data)=>{calls.push({name,data});return {test:true};}};
}
for(const platform of ['ios','android'])test(platform+' uses demo ads voluntarily and never requests a real credit grant',async()=>{
 const h=setup(platform);assert.equal(h.loads.length,0);
 const result=await h.ads.show({api:h.api,uid:'u'});
 assert.equal(result.test,true);assert.equal(result.credited,undefined);
 assert.match(h.loads[0].adId,/3940256099942544/);assert.equal(h.loads[0].ssv,undefined);
 assert.equal(h.calls.filter(c=>c.name).length,1);assert.equal(h.calls.find(c=>c.name).name,'creditPrepareAdReward');
 assert.equal(Object.keys(h.listeners).length,0);
});
test('Skipping a demo never grants a reward and permits another attempt',async()=>{
 const h=setup('ios',{earned:false});
 assert.equal((await h.ads.show({api:h.api,uid:'u'})).earned,false);
 assert.equal((await h.ads.show({api:h.api,uid:'u'})).earned,false);
});
test('Consent cannot be bypassed and browser ads are unsupported',async()=>{
 const h=setup('android',{consent:false});
 await assert.rejects(()=>h.ads.show({api:h.api,uid:'u'}));assert.equal(h.loads.length,0);assert.equal(h.calls.length,0);
 assert.equal(setup('web').ads.supported,false);
});
