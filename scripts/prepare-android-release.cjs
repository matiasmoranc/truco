'use strict';
const fs=require('node:fs'),path=require('node:path');
function prepareAndroidRelease(root,env=process.env){
 const app=path.join(root,'android/app'),gradle=path.join(app,'build.gradle');
 for(const key of ['CM_KEYSTORE_PATH','CM_KEYSTORE_PASSWORD','CM_KEY_ALIAS','CM_KEY_PASSWORD','ANDROID_VERSION_CODE'])if(!env[key])throw new Error('Falta '+key+' para preparar Android firmado.');
 const code=Number(env.ANDROID_VERSION_CODE);
 if(!/^\d+$/.test(env.ANDROID_VERSION_CODE)||!Number.isSafeInteger(code)||code<1||code>2100000000)throw new Error('ANDROID_VERSION_CODE debe ser un entero positivo y mayor que el publicado.');
 if(!fs.existsSync(env.CM_KEYSTORE_PATH))throw new Error('No se encontró la clave de firma configurada.');
 const encoded=env.GOOGLE_SERVICES_JSON_BASE64;
 let firebase;
 try{firebase=encoded?JSON.parse(Buffer.from(encoded,'base64').toString('utf8')):JSON.parse(fs.readFileSync(path.join(app,'google-services.json'),'utf8'));}catch{throw new Error('Falta un google-services.json válido o GOOGLE_SERVICES_JSON_BASE64.');}
 const client=firebase.client?.find(c=>c.client_info?.android_client_info?.package_name==='com.matiasmoranc.truco');
 if(firebase.project_info?.project_id!=='truco-6553d'||!client)throw new Error('El archivo Firebase debe corresponder a truco-6553d y com.matiasmoranc.truco.');
 if(!client.oauth_client?.some(c=>c.client_type===3))throw new Error('El archivo Firebase necesita un cliente OAuth web para Google.');
 let source=fs.readFileSync(gradle,'utf8');
 if(!source.includes('com.matiasmoranc.truco'))throw new Error('El proyecto Android tiene otro identificador.');
 const marker="apply from: 'truco-release.gradle'";
 if(!source.includes(marker))source+='\n'+marker+'\n';
 const config=`// Generated without embedding signing secrets.\nandroid {\n    defaultConfig {\n        versionCode Integer.parseInt(System.getenv('ANDROID_VERSION_CODE'))\n        versionName '1.0.0'\n    }\n    signingConfigs {\n        release {\n            storeFile file(System.getenv('CM_KEYSTORE_PATH'))\n            storePassword System.getenv('CM_KEYSTORE_PASSWORD')\n            keyAlias System.getenv('CM_KEY_ALIAS')\n            keyPassword System.getenv('CM_KEY_PASSWORD')\n        }\n    }\n    buildTypes {\n        release {\n            signingConfig signingConfigs.release\n        }\n    }\n}\nif (rootProject.ext.targetSdkVersion < 36 || rootProject.ext.compileSdkVersion < 36) {\n    throw new GradleException('Google Play requiere target/compile SDK 36 o superior para esta version.')\n}\n`;
 fs.writeFileSync(path.join(app,'google-services.json'),JSON.stringify(firebase,null,2));
 fs.writeFileSync(path.join(app,'truco-release.gradle'),config);fs.writeFileSync(gradle,source);
 return code;
}
if(require.main===module){try{const code=prepareAndroidRelease(path.resolve(__dirname,'..'));console.log('Android preparado para generar AAB firmado. Version '+code+'. Las credenciales no se imprimen.');}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={prepareAndroidRelease};
