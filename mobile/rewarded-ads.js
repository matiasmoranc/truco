import { AdMob, AdmobConsentStatus, RewardAdPluginEvents } from '@capacitor-community/admob';
import { Capacitor } from '@capacitor/core';

// Live serving requires a deliberate release change AND the server switch.
export const TEST_ADS = true;
const units = {
  android: { test: 'ca-app-pub-3940256099942544/5224354917', live: 'ca-app-pub-9142692584360532/6281740760' },
  ios: { test: 'ca-app-pub-3940256099942544/1712485313', live: 'ca-app-pub-9142692584360532/2408365354' },
};
let initialized = false, consent, running = false;
async function initialize() {
  if (initialized) return;
  consent = await AdMob.requestConsentInfo();
  if (consent.isConsentFormAvailable && consent.status === AdmobConsentStatus.REQUIRED) {
    consent = await AdMob.showConsentForm();
  }
  if (!consent.canRequestAds) throw new Error('No pudimos habilitar el anuncio. Volvé a intentar más tarde.');
  await AdMob.initialize({ initializeForTesting: TEST_ADS });
  initialized = true;
}
export const rewardedAds = {
  supported: Capacitor.isNativePlatform() && !!units[Capacitor.getPlatform()],
  test: TEST_ADS,
  async show({ api, uid }) {
    if (running) throw new Error('Ya hay un anuncio en curso.');
    running = true;
    try {
      await initialize();
      const platform = Capacitor.getPlatform();
      const session = await api('creditPrepareAdReward', { platform, test: TEST_ADS });
      await AdMob.prepareRewardVideoAd({
        adId: units[platform][TEST_ADS ? 'test' : 'live'], npa: true,
        ...(TEST_ADS ? {} : { ssv: { userId: uid, customData: session.id } }),
      });
      // Wait for dismissal as well as the reward: native show promises can
      // resolve before the ad closes, or remain pending when the user skips.
      const listeners=[];
      let reward;
      try {
        await new Promise(async (resolve,reject)=>{
          try {
            listeners.push(await AdMob.addListener(RewardAdPluginEvents.Rewarded,item=>{reward=item;}));
            listeners.push(await AdMob.addListener(RewardAdPluginEvents.Dismissed,resolve));
            listeners.push(await AdMob.addListener(RewardAdPluginEvents.FailedToShow,()=>reject(new Error('No se pudo mostrar el anuncio.'))));
            void AdMob.showRewardVideoAd().catch(reject);
          } catch(error) { reject(error); }
        });
      } finally { await Promise.all(listeners.map(listener=>listener.remove())); }
      if (!reward || !(reward.amount > 0)) return { earned: false };
      // Demo ads never trigger Google's signed SSV callback. Never turn a
      // client event into permission to mint credits in the shared economy.
      if (TEST_ADS) return { earned: true, test: true };
      for (let attempt = 0; attempt < 10; attempt++) {
        const status = await api('creditAdRewardStatus', { id: session.id });
        if (status.credited) return { earned: true, credited: true };
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      return { earned: true, pending: true };
    } finally { running = false; }
  },
  async privacy() {
    await initialize();
    if (consent?.privacyOptionsRequirementStatus === 'REQUIRED') {
      await AdMob.showPrivacyOptionsForm();
    }
    else throw new Error('No hay un formulario de opciones disponible en esta región.');
  },
};
