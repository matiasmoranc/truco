'use strict';
// Native build assets derived from the existing game logo, not a new design.
const fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const root=path.resolve(__dirname,'..'),green='#103d2e';
async function main(){
 const logo=await sharp(path.join(root,'assets/truco-v3.png')).trim().modulate({saturation:0.65}).png().toBuffer();
 async function icon(size,fraction,transparent=false){
  const mark=await sharp(logo).resize({width:Math.round(size*fraction),height:Math.round(size*fraction),fit:'inside'}).png().toBuffer();
  return sharp({create:{width:size,height:size,channels:4,background:transparent?'#00000000':green}}).composite([{input:mark,gravity:'centre'}]).png().toBuffer();
 }
 async function write(file,buffer){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,buffer);}
 // Reusable store artwork uses the same logo and opaque background.
 const store=path.join(root,'publication/assets');
 for(const size of [512,1024]){
  await write(path.join(store,'truco-icon-'+size+'.png'),await sharp(await icon(size,0.78)).removeAlpha().png({palette:true,colours:256,effort:10}).toBuffer());
 }
 const android=path.join(root,'android/app/src/main/res');
 try{await fs.access(android);
  for(const [density,size] of Object.entries({mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192})){
   const directory=path.join(android,'mipmap-'+density),image=await icon(size,0.78);
   await write(path.join(directory,'ic_launcher.png'),image);
   await write(path.join(directory,'ic_launcher_round.png'),image);
   // Adaptive foreground spans 108dp; keep the logo inside its mask safe area.
   await write(path.join(directory,'ic_launcher_foreground.png'),await icon(Math.round(size*108/48),0.54,true));
  }
  const xml='<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android"><background android:drawable="@color/truco_icon_background"/><foreground android:drawable="@mipmap/ic_launcher_foreground"/></adaptive-icon>\n';
  for(const name of ['ic_launcher','ic_launcher_round'])await write(path.join(android,'mipmap-anydpi-v26',name+'.xml'),xml);
  await write(path.join(android,'values/truco_icon.xml'),'<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="truco_icon_background">'+green+'</color></resources>\n');
  console.log('Iconos Android actualizados.');
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const ios=path.join(root,'ios/App/App/Assets.xcassets/AppIcon.appiconset');
 try{await fs.access(ios);
  const file=path.join(ios,'Contents.json'),catalog=JSON.parse(await fs.readFile(file,'utf8'));
  for(const image of catalog.images){
   const size=image.size?Math.round(parseFloat(image.size)*parseFloat(image.scale||'1x')):1024;
   image.filename='truco-'+size+'.png';
   const png=await icon(size,0.78);await write(path.join(ios,image.filename),await sharp(png).removeAlpha().png().toBuffer());
  }
  await fs.writeFile(file,JSON.stringify(catalog,null,2)+'\n');console.log('Iconos iPhone actualizados.');
 }catch(error){if(error.code!=='ENOENT')throw error;}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
