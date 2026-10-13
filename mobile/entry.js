import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import * as appSdk from 'firebase/app';
import * as dbSdk from 'firebase/database';
import * as authSdk from 'firebase/auth';
import * as functionsSdk from 'firebase/functions';
import { rewardedAds } from './rewarded-ads.js';

// The same Firebase JS session drives database rules and callable Functions.
globalThis.trucoNative = {
  isNative: Capacitor.isNativePlatform(),
  platform: Capacitor.getPlatform(),
  rewardedAds,
  publicUrl: 'https://matiasmoranc.github.io/truco/',
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
