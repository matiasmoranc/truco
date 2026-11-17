import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import * as appSdk from 'firebase/app';
import * as dbSdk from 'firebase/database';
import * as authSdk from 'firebase/auth';
import * as functionsSdk from 'firebase/functions';
import { AppUpdate, AppUpdateAvailability, AppUpdateResultCode } from '@capawesome/capacitor-app-update';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { TextToSpeech, QueueStrategy } from '@capacitor-community/text-to-speech';
import { rewardedAds } from './no-ads.js';

// App Store id, needed on iPhone to look up and open the listing.
const APP_STORE_ID = '6821732363';

// Android's web view has no speech synthesis: the calls ("¡Truco!", "Envido"…) use the phone's own voice.
// iPhone keeps the web voice, which works there.
// The phone's speech engine starts a moment after the app and until then answers that it has
// no language, so the choice is kept only once the engine finds one: an early call must not
// leave the voice on a language the phone lacks (the engine refuses those and stays quiet).
let voiceLang = null;
async function androidVoiceLang() {
  if (voiceLang) return voiceLang;
  for (const lang of ['es-UY', 'es-AR', 'es-419', 'es-US', 'es-ES']) {
    try { if ((await TextToSpeech.isLanguageSupported({ lang })).supported) return (voiceLang = lang); } catch { /* Try the next one. */ }
  }
  // Any other Spanish the phone has (es-MX…), or else the phone's own language.
  try {
    const languages = (await TextToSpeech.getSupportedLanguages()).languages || [];
    const own = String(navigator.language || '').toLowerCase().split('-')[0];
    const found = languages.find(l => /^es\b/i.test(l)) || languages.find(l => own && l.toLowerCase().split('-')[0] === own);
    if (found) return (voiceLang = found);
  } catch { /* The engine is not ready yet. */ }
  return null;
}
// Engine still starting or language refused: try again a moment later, unless a newer call came.
const VOICE_RETRY_MS = 700;
let voiceTurn = 0;
const nativeVoice = Capacitor.getPlatform() === 'android' ? {
  async speak(text) {
    const turn = ++voiceTurn;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) { await new Promise(done => setTimeout(done, VOICE_RETRY_MS)); if (turn !== voiceTurn) return; }
      const lang = await androidVoiceLang();
      if (!lang) continue;
      try { await TextToSpeech.speak({ text, lang, rate: 0.95, pitch: 0.75, volume: 1, queueStrategy: QueueStrategy.Flush }); return; }
      catch (error) {
        if (!/initiali[sz]ed|not supported|not available/i.test(String(error?.message))) { console.warn('[truco:voice] native', error); return; }
        voiceLang = null;
      }
    }
    console.warn('[truco:voice] the phone has no voice for this language');
  },
  stop() { voiceTurn++; TextToSpeech.stop().catch(() => {}); }
} : null;

// The same Firebase JS session drives database rules and callable Functions.
globalThis.trucoNative = {
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  rewardedAds,
  nativeVoice,
  publicUrl: 'https://trucouruguayo.uy/',
  // The installed version ("1.0.11"), so the admin can tell who has an old app. Null if unknown.
  appVersion: (() => { let info = null; return () => (info ??= App.getInfo().then(i => i.version || null).catch(() => null)); })(),
  // The match photo goes to the phone's share sheet (Instagram, WhatsApp…) from a cache file.
  async shareImage(base64, name) {
    const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
    await Share.share({ files: [uri], dialogTitle: 'Compartir resultado' });
  },
  // A newer version in Google Play or the App Store: { version } or null. Never throws.
  async checkForUpdate() {
    try {
      const info = await AppUpdate.getAppUpdateInfo(Capacitor.getPlatform() === 'ios' ? { country: 'uy' } : undefined);
      if (info.updateAvailability !== AppUpdateAvailability.UPDATE_AVAILABLE) return null;
      return { version: info.availableVersionName || info.availableVersionCode || '' };
    } catch { return null; }
  },
  // Push notifications for friend requests and table invitations. Asks permission once,
  // returns the phone's token (or null) and reports taps on a notification.
  async registerPush(onTap) {
    try {
      if (Capacitor.getPlatform() === 'android') await FirebaseMessaging.createChannel({ id: 'invitaciones', name: 'Invitaciones', description: 'Invitaciones a jugar y solicitudes de amistad', importance: 5, sound: 'default' }).catch(() => {});
      let { receive } = await FirebaseMessaging.checkPermissions();
      if (receive === 'prompt' || receive === 'prompt-with-rationale') ({ receive } = await FirebaseMessaging.requestPermissions());
      if (receive !== 'granted') return null;
      await FirebaseMessaging.removeAllListeners();
      await FirebaseMessaging.addListener('notificationActionPerformed', event => onTap?.(event.notification?.data || {}));
      const { token } = await FirebaseMessaging.getToken();
      return token || null;
    } catch { return null; }
  },
  // Android installs it inside the app (Google Play); iPhone opens the App Store page.
  async installUpdate() {
    if (Capacitor.getPlatform() === 'android') {
      // The user can cancel Google's update screen; anything else that keeps it from
      // running (not installed from Play, no update info) opens the Play Store page.
      try {
        await AppUpdate.getAppUpdateInfo();
        const { code } = await AppUpdate.performImmediateUpdate();
        if (code === AppUpdateResultCode.OK || code === AppUpdateResultCode.CANCELED) return;
      } catch { /* Fall back to the store page. */ }
    }
    await AppUpdate.openAppStore(Capacitor.getPlatform() === 'ios' ? { appId: APP_STORE_ID } : undefined);
  },
  sdk: { app: appSdk, database: dbSdk, auth: authSdk, functions: functionsSdk },
  async reauthenticateForDeletion(fb, user, provider) {
    const result=provider==='apple.com'?await FirebaseAuthentication.signInWithApple():await FirebaseAuthentication.signInWithGoogle();
    const native=result.credential;
    if(!native?.idToken)throw new Error('No recibimos la credencial de acceso.');
    const credential=provider==='apple.com'
      ?new fb.authSdk.OAuthProvider(provider).credential({idToken:native.idToken,rawNonce:native.nonce})
      :fb.authSdk.GoogleAuthProvider.credential(native.idToken,native.accessToken);
    await fb.authSdk.reauthenticateWithCredential(user,credential);
    if(provider==='apple.com'){
      const token=Capacitor.getPlatform()==='ios'?native.authorizationCode:native.accessToken;
      if(!token)throw new Error('No recibimos la autorización de Apple. Volvé a intentar.');
      await FirebaseAuthentication.revokeAccessToken({token});
    }
  },
  async signIn(fb, provider) {
    const result = provider === 'apple.com'
      ? await FirebaseAuthentication.signInWithApple()
      : await FirebaseAuthentication.signInWithGoogle();
    const native = result.credential;
    if (!native?.idToken) throw new Error('No se recibió la credencial de acceso.');
    const credential = provider === 'apple.com'
      ? new fb.authSdk.OAuthProvider(provider).credential({ idToken: native.idToken, rawNonce: native.nonce })
      : fb.authSdk.GoogleAuthProvider.credential(native.idToken, native.accessToken);
    const signedIn = await fb.authSdk.signInWithCredential(fb.auth, credential);
    // Apple shares the name only on the first sign-in; keep it to name the new account.
    signedIn.nameHint = result.user?.displayName || result.additionalUserInfo?.profile?.firstName || '';
    return signedIn;
  }
};
await import('../app.js');
