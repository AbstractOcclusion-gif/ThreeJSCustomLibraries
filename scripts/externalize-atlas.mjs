// Remove the embedded copy of the shared atlas from an authored GLB. Preserve
// every mesh/node/accessor; rewrite buffer-view indices and byte offsets only.
export function externalizeAtlas(bytes,uri='../atlas.png'){
 const jsonLength=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+jsonLength).toString());
 if(!gltf.images?.some(image=>image.bufferView!=null))return bytes;
 if(gltf.images.length!==1||gltf.buffers.length!==1)throw Error('Structure parts require one shared atlas image and one geometry buffer');
 const imageViews=new Set(gltf.images.map(image=>image.bufferView)),binaryOffset=20+jsonLength+8,binary=bytes.subarray(binaryOffset,binaryOffset+gltf.buffers[0].byteLength);
 const ranges=[...imageViews].map(i=>{const view=gltf.bufferViews[i];return[view.byteOffset??0,(view.byteOffset??0)+Math.ceil(view.byteLength/4)*4];}).sort((a,b)=>a[0]-b[0]);
 const chunks=[];let cursor=0;for(const [start,end]of ranges){if(start<cursor)throw Error('Overlapping atlas buffer views');chunks.push(binary.subarray(cursor,start));cursor=end;}chunks.push(binary.subarray(cursor));
 const geometry=Buffer.concat(chunks),map=new Map(),views=[];
 for(const [index,view]of gltf.bufferViews.entries())if(!imageViews.has(index)){const offset=view.byteOffset??0;map.set(index,views.length);views.push({...view,byteOffset:offset-ranges.reduce((n,[start,end])=>n+(end<=offset?end-start:0),0)});}
 for(const image of gltf.images){delete image.bufferView;delete image.mimeType;image.uri=uri;}
 function remap(value){if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value))if(key==='bufferView'){if(!map.has(item))throw Error('Atlas buffer also referenced by geometry');value[key]=map.get(item);}else remap(item);}
 gltf.bufferViews=views;remap(gltf);gltf.buffers[0].byteLength=geometry.length;
 let json=Buffer.from(JSON.stringify(gltf));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const bin=Buffer.concat([geometry,Buffer.alloc((4-geometry.length%4)%4)]),result=Buffer.alloc(12+8+json.length+8+bin.length);
 result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);const at=20+json.length;result.writeUInt32LE(bin.length,at);result.writeUInt32LE(0x004e4942,at+4);bin.copy(result,at+8);return result;
}
