import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const repo=fileURLToPath(new URL('../../',import.meta.url)),parent=path.join(repo,'tools/blender/.build');await fs.mkdir(parent,{recursive:true});
const staging=await fs.mkdtemp(path.join(parent,'structure-extension-'));
try{
await fs.cp(path.join(repo,'tools/blender/impact_club_destructibles'),staging,{recursive:true,filter:p=>!p.includes('__pycache__')&&!p.endsWith('.pyc')});
await fs.mkdir(path.join(staging,'data'));await fs.copyFile(path.join(repo,'src/destruction/material-profiles.json'),path.join(staging,'data/material-profiles.json'));await fs.copyFile(path.join(repo,'assets/structures/atlas.png'),path.join(staging,'data/atlas.png'));
const blender=process.env.BLENDER_EXE??'C:\\Program Files\\Blender Foundation\\Blender 5.0\\blender.exe',output=path.resolve(repo,process.argv[2]??'tools/blender/.build/impact-club-destructibles-0.2.0.zip');await fs.mkdir(path.dirname(output),{recursive:true});
for(const args of [['--factory-startup','--command','extension','build','--source-dir',staging,'--output-filepath',output],['--factory-startup','--command','extension','validate',output]]){const result=spawnSync(blender,args,{stdio:'inherit',windowsHide:true});if(result.error)throw result.error;if(result.status!==0)throw Error(`Blender extension command failed (${result.status??1})`);}
console.log(output);
}finally{
 const actualRepo=await fs.realpath(repo),actualStaging=await fs.realpath(staging),relative=path.relative(actualRepo,actualStaging);
 if(!relative.startsWith(path.join('tools','blender','.build')+path.sep)||!path.basename(actualStaging).startsWith('structure-extension-'))throw Error('Refusing to remove staging outside the Blender workspace');
 await fs.rm(actualStaging,{recursive:true,force:true});
}
