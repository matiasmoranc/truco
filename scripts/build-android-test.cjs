'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),android=path.join(root,'android');
const windows=process.platform==='win32';
function run(command,args,options={}){
 const result=spawnSync(command,args,{cwd:root,stdio:'inherit',...options});
 if(result.error)throw result.error;
 if(result.status!==0)throw new Error('La compilación no terminó correctamente. Revisá el error anterior.');
}
try{
 if(!fs.existsSync(path.join(android,windows?'gradlew.bat':'gradlew')))throw new Error('Falta el proyecto Android. Ejecutá npm run mobile:add:android primero.');
 if(!fs.existsSync(path.join(android,'app','google-services.json')))throw new Error('Falta android/app/google-services.json. Usá el archivo de Firebase con el que ya funciona Google.');
 const env={...process.env};
 if(!env.JAVA_HOME&&windows){
  const jbr=path.join(process.env.ProgramFiles||'C:\\Program Files','Android','Android Studio','jbr');
  if(fs.existsSync(path.join(jbr,'bin','java.exe')))env.JAVA_HOME=jbr;
 }
 if(!process.env.npm_execpath)throw new Error('Ejecutá este script con npm run mobile:apk.');
 run(process.execPath,[process.env.npm_execpath,'run','mobile:sync'],{env});
 run(windows?'gradlew.bat':'./gradlew',['assembleDebug'],{cwd:android,env,shell:windows});
 const source=path.join(android,'app','build','outputs','apk','debug','app-debug.apk');
 if(!fs.existsSync(source))throw new Error('Gradle terminó pero no se encontró app-debug.apk.');
 const output=path.join(root,'artifacts');fs.mkdirSync(output,{recursive:true});
 const target=path.join(output,'truco-uruguayo-prueba.apk');fs.copyFileSync(source,target);
 console.log('\nAPK de prueba listo: '+target);
 console.log('Usa las mismas cuentas, mesas y créditos que la web. No está publicado en Play Store.');
}catch(error){console.error('\n'+error.message);process.exitCode=1;}
