import {LinearMipmapLinearFilter} from 'three';
import {STRUCTURE_ATLAS} from '../material-profiles.js';

// UV rectangle [u0,v0,u1,v1] of one atlas tile inside its gutter, in the same
// convention as the exported GLB coordinates (V measured from the image top).
export function structureAtlasRect(row,column=0){
 const {columns,rows,tilePixels,paddingPixels}=STRUCTURE_ATLAS,inset=(paddingPixels+.5)/tilePixels;
 return[(column+inset)/columns,1-(row+1-inset)/rows,(column+1-inset)/columns,1-(row+inset)/rows];
}

// Three r180 allocates immutable texture storage for the supplied mip chain.
// Stop while each tile still has at least a one-pixel gutter, so distant mips
// never average different materials. Downsample each tile independently.
export function prepareStructureAtlas(texture){
 if(texture.userData.structureAtlas)return;
 const image=texture.image,{columns,rows,tilePixels,paddingPixels}=STRUCTURE_ATLAS;
 if(!image||image.width!==columns*tilePixels||image.height!==rows*tilePixels)throw Error('Unexpected structure atlas dimensions');
 const levels=[image],last=Math.floor(Math.log2(paddingPixels));
 for(let level=1;level<=last;level++){
  const size=tilePixels>>level,canvas=document.createElement('canvas');canvas.width=columns*size;canvas.height=rows*size;const context=canvas.getContext('2d');
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++)context.drawImage(image,column*tilePixels,row*tilePixels,tilePixels,tilePixels,column*size,row*size,size,size);
  levels.push(canvas);
 }
 texture.mipmaps=levels;texture.generateMipmaps=false;texture.minFilter=LinearMipmapLinearFilter;texture.anisotropy=1;texture.userData.structureAtlas=true;texture.needsUpdate=true;
}
