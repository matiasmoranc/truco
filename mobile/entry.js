import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import * as appSdk from 'firebase/app';
import * as dbSdk from 'firebase/database';
import * as authSdk from 'firebase/auth';
import * as functionsSdk from 'firebase/functions';
import { AppUpdate, AppUpdateAvailability, AppUpdateResultCode } from '@capawesome/capacitor-app-update';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { rewardedAds } from './no-ads.js';

// App Store id, needed on iPhone to look up and open the listing.
const APP_STORE_ID = '6821732363';

// The same Firebase JS session drives database rules and callable Functions.
globalThis.trucoNative = {
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  rewardedAds,
  publicUrl: 'https://trucouruguayo.uy/',
  // The match photo goes to the phone's share sheet (Instagram, WhatsApp…) from a cache file.
  async shareImage(base64, name, text) {
    const { uri } = await Filesystem.writeFile({ path: name, data: base64, directory: Directory.Cache });
    await Share.share({ files: [uri], text, dialogTitle: 'Compartir resultado' });
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
    return fb.authSdk.signInWithCredential(fb.auth, credential);
  }
};
await import('../app.js');
