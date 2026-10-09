// Run against a private Firebase export, never commit the export or output.
const fs=require('node:fs');
function buildIndex(data){
 const index={...(data.usernames||{})}, conflicts=[];
 for(const [uid,profile] of Object.entries(data.profiles||{})){
  const name=profile?.name;
  if(typeof name!=='string'||!name)continue;
  const key=name.toLowerCase().replaceAll('.', '%2E');
  if(/[#$\[\]/\u0000-\u001f\u007f]/.test(key)){conflicts.push({uid,name,reason:'Invalid legacy name; rename it first'});continue;}
  if(index[key]&&index[key]!==uid){conflicts.push({uid,name,owner:index[key],reason:'Duplicate name ignoring case'});continue;}
  index[key]=uid;
 }
 return {index,conflicts};
}
if(require.main===module){
 const [input,output]=process.argv.slice(2);
 if(!input||!output)throw new Error('Usage: node scripts/build-username-index.cjs database-export.json usernames.json');
 const {index,conflicts}=buildIndex(JSON.parse(fs.readFileSync(input,'utf8')));
 if(conflicts.length){console.error(JSON.stringify(conflicts,null,2));process.exitCode=1;}
 else{fs.writeFileSync(output,JSON.stringify(index,null,2)+'\n',{flag:'wx'});console.log('Index generated. Import ONLY at /usernames in Firebase.');}
}
module.exports={buildIndex};
