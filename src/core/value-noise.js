// Seeded 2D value noise in [-1, 1], shared by terrain geometry and paint, bench layouts and plant patches. Keep the
// integer hash unchanged so paint improvements cannot move an authored course.
export function valueNoise(seed){
 const hash=(i,j)=>{let h=Math.imul(i,374761393)+Math.imul(j,668265263)+Math.imul(seed,982451653)|0;h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296*2-1;};
 const fade=t=>t*t*(3-2*t);
 return(x,z)=>{const i=Math.floor(x),j=Math.floor(z),a=fade(x-i),b=fade(z-j);
  return(1-a)*((1-b)*hash(i,j)+b*hash(i,j+1))+a*((1-b)*hash(i+1,j)+b*hash(i+1,j+1));};
}

// Fractal sum of a 2D noise: octaves layers, each `lacunarity` x finer and `gain` x weaker, the first weighted `amplitude`.
export function fbm(noise, x, z, {octaves = 5, amplitude = .5, gain = .5, lacunarity = 2} = {}) {
 let sum = 0, weight = amplitude, frequency = 1;
 for (let octave = 0; octave < octaves; octave++) { sum += noise(x * frequency, z * frequency) * weight; weight *= gain; frequency *= lacunarity; }
 return sum;
}
