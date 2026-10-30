// The Animation Engine's effects runtime (its public/canvas.js, the "animated raster effects" part, as of 2026-10-28):
// a field drawn on the GPU in cells or as a whole scene, one WebGL2 context for every effect on the page, still under
// reduced motion and resting off screen. Copied, not changed: when the engine's effects change, copy that part again.

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches
const css = (v) => (typeof v === "string" && !/url\(|expression|[;{}<>]/i.test(v) ? v : "")
const picture = (s) => typeof s === "string" && /^(data:image\/(png|jpe?g|webp|gif|svg\+xml);|https:\/\/)/.test(s)

/* ---------------- animated raster effects: one GPU context for the whole page ---------------- */

// A moving field (flow, waves, rings, orbs, a picture) is drawn into a small texture, one texel per cell; then every
// pixel draws its cell's shape (a pixel, a halftone dot, a cross-stitch, a character, a scanline, a block) in the
// palette, with glow from the field's own blurred copies (its mipmaps) and grain. One WebGL2 context draws every effect
// on the page in turn and hands each its picture, so a page of many canvases never runs out of contexts. Effects off
// screen aren't drawn; under reduced motion each is drawn once, still.

const VS = `#version 300 es
void main(){vec2 p=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.))[gl_VertexID];gl_Position=vec4(p,0.,1.);}`

const NOISE = `
float h1(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.-2.*f);return mix(mix(h1(i),h1(i+vec2(1.,0.)),u.x),mix(h1(i+vec2(0.,1.)),h1(i+vec2(1.,1.)),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<5;i++){s+=a*n2(p);p=p*2.03+vec2(17.1,9.2);a*=.5;}return s;}`

// The finish every effect shares. A CRT (`screen`, 0–1): the glass sits in a bezel and bulges (everything drawn on it
// moves with the curve), with a phosphor mask, scanlines, the tube's falloff to its edges and a little bloom; the bezel
// is dark plastic lit by the glass. (Cells are their own grid: over them the glass curves, without the mask.) Paper (`paper`, 0–1): fibres and blotches that stay still. Then film grain.
const FX_FINISH = `
uniform float CR,PA,GR,MK;
float hash(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
// where a pixel of the frame looks onto the picture through the curved glass; sd: how far outside the glass it is
vec2 tube(vec2 px,out float sd,out vec2 cc){
  cc=px/R*2.-1.;sd=-1e3;
  if(CR<=0.)return px;
  float m=CR*.07*min(R.x,R.y);
  vec2 hs=R*.5-m;
  vec2 s=(px-R*.5)/hs;
  s*=1.+CR*.075*(s.yx*s.yx);
  cc=s;
  float r=CR*.1*min(R.x,R.y);
  vec2 d=abs(s)*hs-(hs-r);
  sd=length(max(d,0.))+min(max(d.x,d.y),0.)-r;
  return R*.5+s*R*.5;
}
vec4 finish(vec3 c,float a,vec2 px,vec2 cc,float sd){
  if(PA>0.){float f=.7*fbm(px*.03)+.3*h1(floor(px*.8));c*=1.-PA*.2*(f-.45);c=mix(c,c*vec3(1.,.97,.92),PA*.25);}
  if(CR>0.){
    float pitch=max(2.,min(R.x,R.y)/200.);
    float dm=1.-smoothstep(.2,.5,length(fract(px/pitch)-.5));
    float scan=.5+.5*cos(px.y/pitch*6.2832);
    c*=mix(1.,.7+.45*dm,CR*.75*MK)*mix(1.,.9+.1*scan,CR*MK);
    c*=1.-CR*.45*pow(clamp(dot(cc,cc)*.5,0.,1.),1.5);
    c+=c*c*.14*CR;
    vec3 bz=vec3(.014,.016,.02)+vec3(.045,.05,.06)*(1.-smoothstep(0.,min(R.x,R.y)*.06,sd))*(.55+.45*smoothstep(-1.,1.,-cc.y));
    bz+=c*.1*exp(-max(sd,0.)/(min(R.x,R.y)*.015));
    float on=1.-smoothstep(-1.,1.,sd);
    c=mix(bz,c,on);
    a=mix(1.,a,on);
  }
  c+=(hash(px+fract(T*13.)*91.)-.5)*GR*.12*a;
  return vec4(c,a);
}`

// the field, one texel per cell: rgb a picture's colour, alpha the value (0 nothing, 1 dense)
const FIELD_FS = `#version 300 es
precision highp float;
uniform vec2 G;uniform float A,T,SC,AN,SD,CT,LV;uniform int S,INV,HP;uniform sampler2D P;uniform vec2 PS;
out vec4 o;${NOISE}
float flow(vec2 q,float sd){vec2 w=vec2(fbm(q+vec2(sd,T*.12)),fbm(q+vec2(5.2+sd,1.3)-vec2(T*.09,0.)));return smoothstep(.28,.78,fbm(q+1.7*w+vec2(T*.05,-T*.04)));}
void main(){
  vec2 uv=gl_FragCoord.xy/G;
  vec2 p=(uv-.5)*vec2(A,1.);
  float c=cos(AN),s=sin(AN);
  p=mat2(c,s,-s,c)*p;
  vec2 q=p*SC*2.;
  float sd=SD*1.731;
  float v=0.;vec3 col=vec3(0.);
  if(S==0){v=flow(q,sd);}
  else if(S==1){float crest=.22*sin(p.x*2.4*SC+T*.8+sd)+.1*sin(p.x*5.1*SC-T*1.2+sd*2.)+.06*fbm(q*1.5+T*.15);v=clamp(.5-(p.y*2.-crest)*.9,0.,1.);}
  else if(S==2){vec2 cc=.12*vec2(sin(T*.27+sd),cos(T*.21));float r=length(p-cc)*SC;v=.5+.5*cos(r*14.-T*1.5);}
  else if(S==5){vec2 w=vec2(fbm(q*.6+vec2(T*.02,sd)),fbm(q*.6+vec2(3.1+sd,T*.015)));float d=fbm(q*1.1+1.5*w+vec2(T*.035,0.))+(.42-uv.y)*.45;float body=smoothstep(.3,.56,d);v=clamp(body*(.5+.65*smoothstep(.42,.78,d)),0.,1.);}
  else if(S==3){vec2 c1=vec2(.32*sin(T*.29+sd),.22*cos(T*.23+sd));vec2 c2=vec2(.42*cos(T*.17+2.+sd),.3*sin(T*.21+1.));float k=SC*SC;v=exp(-dot(p-c1,p-c1)*3.2*k)+.75*exp(-dot(p-c2,p-c2)*5.*k);v=clamp(v+.15*(fbm(q*1.2+T*.1)-.5),0.,1.);}
  // beam: soft bands of light sweeping slowly across (a screen's glare), along the direction
  else if(S==6){float x=p.x*SC;float b1=exp(-pow((x-.4*sin(T*.16+sd))*3.,2.));float b2=.3*exp(-pow((x+.6-.3*sin(T*.11+1.3+sd))*4.,2.));v=clamp(.2+.8*max(b1,b2)+.06*(fbm(q*1.3+vec2(T*.05,0.))-.5),0.,1.);}
  // cumulus: a tower of puffs rising left of centre and a low bank beside it, lit from above, shaded in its folds,
  // billowing at the edge, drifting
  else if(S==7){vec2 c=p*SC+vec2(.3,0.);float sw=0.,ss=0.;
    for(int i=0;i<20;i++){float fi=float(i),hx=fract(sin(fi*78.233+sd)*43758.5453),hy=fract(sin(fi*12.9898+sd)*43758.5453);
      vec2 ci=i<14?vec2(-.34+.68*hx*(1.-fi/17.),-.62+fi*.062):vec2(-1.45+.36*(fi-14.)+.12*hx,-.5-.07*hy);
      ci+=.025*vec2(sin(T*.2+fi),cos(T*.17+fi));
      float ri=i<14?.27-.012*fi+.06*hy:.17+.08*hy;
      vec2 l=(c-ci)/ri;float m=1.-dot(l,l),w=exp(8.*m);
      sw+=w;ss+=w*(dot(l,normalize(vec2(-.35,.94)))*.5+.5);}
    float field=log(sw)/8.,shade=ss/sw;
    float edge=field+.4*(fbm(c*7.+vec2(sd,-T*.04))-.5)+.15*(n2(c*20.)-.5);
    float body=smoothstep(0.,.1,edge);
    v=clamp(body*(.22+.55*shade+.4*(fbm(c*6.+vec2(0.,T*.03))-.5)+.25*smoothstep(0.,.5,edge)),0.,1.);}
  else if(HP==1){vec2 k=uv-.5;k/=(1.+.04*sin(T*.2))*SC;k+=vec2(.012*sin(T*.13),.009*cos(T*.11));k+=.008*vec2(n2(uv*6.+T*.3)-.5,n2(uv*6.-T*.3+4.)-.5);float pa=PS.x/PS.y;vec2 f=A>pa?vec2(1.,pa/A):vec2(A/pa,1.);col=texture(P,k*f+.5).rgb;v=dot(col,vec3(.2126,.7152,.0722));}
  else{v=flow(q,sd);}
  v=clamp((v-.5)*CT+.5+LV*.5,0.,1.);
  if(INV==1)v=1.-v;
  o=vec4(col,v);
}`

// the cells: each pixel draws its cell's shape, sized and coloured by the field there
const SHAPE_FS = `#version 300 es
precision highp float;
uniform vec2 R,G;uniform float C,GP,SB,DI,SO,GL,T,NC,UN;uniform int SH,NI,TI,FD;uniform vec4 GND;uniform vec3 INK[6];
uniform sampler2D F,AT;
out vec4 o;${NOISE}${FX_FINISH}
float bay(vec2 g){int x=int(mod(g.x,4.)),y=int(mod(g.y,4.));int m[16]=int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);return(float(m[x+y*4])+.5)/16.;}
vec3 ramp(float v){if(NI<2)return INK[0];float x=clamp(v,0.,1.)*float(NI-1);int i=min(int(x),NI-2);return mix(INK[i],INK[i+1],x-float(i));}
void main(){
  float sd;vec2 cc;
  vec2 px=tube(gl_FragCoord.xy,sd,cc);
  vec2 g=floor(px/C);
  vec2 l=fract(px/C)-.5;
  vec4 f=texelFetch(F,ivec2(min(g,G-1.)),0);
  // smooth: no cells, the field itself, read between its texels, a gradient that moves
  if(SH==6)f=texture(F,px/(G*C));
  float v=f.a;
  float b=bay(g);
  float on=mix(1.,step(b,v),DI);
  float sz=mix(1.,sqrt(v),SB);
  float hf=.5*(1.-GP)*sz;
  float aa=1.2/C+SO*.25;
  float cov=0.;
  if(SH==0||SH==5){cov=1.-smoothstep(hf-aa,hf+aa,max(abs(l.x),abs(l.y)));}
  else if(SH==1){cov=1.-smoothstep(hf-aa,hf+aa,length(l));}
  else if(SH==2){float arm=min(abs(l.x-l.y),abs(l.x+l.y))*.7071;float w=.13*(1.-GP)*sz+.02;cov=(1.-smoothstep(w-aa,w+aa,arm))*(1.-smoothstep(hf-aa,hf+aa,max(abs(l.x),abs(l.y))));}
  else if(SH==3){float idx=clamp(floor(v*(NC-1.)+.5+(b-.5)*DI),0.,NC-1.);vec2 q=l/max(sz,.05);if(max(abs(q.x),abs(q.y))<.5)cov=texture(AT,vec2((idx+q.x+.5)/NC,.5-q.y)).a;}
  else if(SH==4){float st=abs(fract((l.x+.5)*3.)-.5);float w=.45*sz;float gy=.5-GP*.25;cov=(1.-smoothstep(w-aa*3.,w+aa*3.,st))*(1.-smoothstep(gy-aa,gy+aa,max(abs(l.x),abs(l.y))));}
  else if(SH==6){cov=1.;on=1.;}
  cov*=on;
  vec2 u=px/R;
  float m=1.;
  if(FD==1)m=smoothstep(0.,.4,u.y);
  else if(FD==2)m=smoothstep(0.,.4,1.-u.y);
  else if(FD==3)m=smoothstep(0.,.18,min(min(u.x,1.-u.x),min(u.y,1.-u.y)));
  else if(FD==4)m=1.-smoothstep(.25,.75,length(u-.5)*1.41);
  cov*=m;
  // the picture itself under the cells, soft (read between the field's texels, a level down): the cells, in its own
  // colours, lifted a little so they read over it
  vec3 under=textureLod(F,px/(G*C),1.2).rgb;
  vec3 gnd=mix(GND.rgb*GND.a,under,UN);
  float ga=max(GND.a,UN);
  vec3 ink=TI==1?mix(f.rgb,vec3(1.),UN*.42):ramp(v);
  vec3 c=ink*cov+gnd*(1.-cov);
  float a=cov+ga*(1.-cov);
  float gv=textureLod(F,px/(G*C),2.5).a*m;
  float gw=GL*gv*gv*.55;
  c+=INK[max(NI-1,0)]*gw;
  a=max(a,min(1.,gw));
  o=finish(c,a,px,cc,sd);
}`

// Scenes: whole pictures drawn at every pixel in the palette, with no cells (a sky over the sea, a painted coast,
// 1970s swirls, overlapping circles, Bauhaus tiles, a tunnel of rounded light, blocks of stepped colour). The palette
// is the ground then up to six inks; what each one paints is in src/canvas/effects.md.
const SCENE_FS = `#version 300 es
precision highp float;
uniform vec2 R;uniform float T,SC,SD,CT,LV;uniform int SN,NI,FD;uniform vec4 GND;uniform vec3 INK[6];
out vec4 o;${NOISE}${FX_FINISH}
vec3 pal(int i){return i<=0?GND.rgb:INK[min(i-1,NI-1)];}
vec3 ramp(float v){if(NI<2)return INK[0];float x=clamp(v,0.,1.)*float(NI-1);int i=min(int(x),NI-2);return mix(INK[i],INK[i+1],x-float(i));}
// a shape's coverage, antialiased over one pixel (PXW: a pixel in the scene's own units, set by each scene)
float PXW=.001;
float cover(float d){return 1.-smoothstep(-PXW,PXW,d);}
float sdSeg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.);return length(pa-ba*h);}
float sdTri(vec2 p,vec2 a,vec2 b,vec2 c){vec2 e0=b-a,e1=c-b,e2=a-c,v0=p-a,v1=p-b,v2=p-c;
  vec2 q0=v0-e0*clamp(dot(v0,e0)/dot(e0,e0),0.,1.),q1=v1-e1*clamp(dot(v1,e1)/dot(e1,e1),0.,1.),q2=v2-e2*clamp(dot(v2,e2)/dot(e2,e2),0.,1.);
  float s=sign(e0.x*e2.y-e0.y*e2.x);
  vec2 d=min(min(vec2(dot(q0,q0),s*(v0.x*e0.y-v0.y*e0.x)),vec2(dot(q1,q1),s*(v1.x*e1.y-v1.y*e1.x))),vec2(dot(q2,q2),s*(v2.x*e2.y-v2.y*e2.x)));
  return -sqrt(d.x)*sign(d.y);}
float smin(float a,float b,float k){float h=clamp(.5+.5*(b-a)/k,0.,1.);return mix(b,a,h)-k*h*(1.-h);}
mat2 rot(float a){float c=cos(a),s=sin(a);return mat2(c,s,-s,c);}
// a cell's random number, exact in integers: the float hash gives the same cell a slightly different number in each
// neighbour's pass on some GPUs, and a disc or a block drawn from two cells then disagrees with itself
float hc(vec2 c,float salt){uvec3 v=uvec3(ivec3(ivec2(floor(c))+32768,int(salt*97.)+4096));v=v*1664525u+1013904223u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;v^=v>>16u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;return float(v.x&0xffffffu)/16777215.;}
vec4 hc4(vec2 c,float salt){uvec3 v=uvec3(ivec3(ivec2(floor(c))+32768,int(salt*97.)+4096));v=v*1664525u+1013904223u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;v^=v>>16u;v.x+=v.y*v.z;v.y+=v.z*v.x;v.z+=v.x*v.y;return vec4(v.x&0xffffu,v.x>>16u,v.y&0xffffu,v.y>>16u)/65535.;}

// a sky over a still sea: a soft gradient into haze, long cirrus drifting, mist breathing on the horizon, ripples
// crowding toward it. ground: the sky's top; inks: the haze, the sea, the cirrus. level: the horizon's height
vec4 horizon(vec2 uv,vec2 p){
  float hz=.28+.2*LV;
  vec3 top=pal(0),haze=pal(1),sea=pal(2),wisp=pal(3);
  float y=uv.y;vec3 c;
  if(y>=hz){
    float k=clamp((y-hz)/(1.-hz),0.,1.);
    c=mix(haze,top,pow(smoothstep(0.,.8,k),.6));
    float wx=p.x*SC*.9-T*.02;
    float s=fbm(vec2((wx+.45*fbm(vec2(wx*1.5,y*5.)+SD))*1.8,(y+.05*fbm(vec2(wx*1.2+SD,0.)))*18.));
    c=mix(c,wisp,smoothstep(.58,.78,s)*smoothstep(.08,.3,k)*smoothstep(.88,.5,k)*.7*CT);
  }else{
    float d=hz-y;
    c=mix(haze,sea,smoothstep(0.,hz,d));
    float z=1./(d+.03);
    float r=fbm(vec2(p.x*z*.8+T*.03,z*2.-T*.3));
    c+=(r-.5)*.08*smoothstep(0.,.04,d);
  }
  float mist=exp(-pow((y-hz-.012)/(.055+.012*sin(T*.2)),2.));
  c=mix(c,mix(haze,vec3(1.),.22),mist*(.5+.2*fbm(vec2(p.x*2.-T*.03,y*4.))));
  return vec4(c,1.);
}

// a painted coast: a sky with clouds (and the sun, when it's up), hills and a town across the water, two sailboats
// rocking with their reflections, gulls, the sun's road on the waves, a rocky cliff in front with scrub, and a tree
// leaning out over it, swaying. ground: the sky; inks: the glow at the horizon, the sea, ink (rock, shadow, outlines),
// the sun, clouds, leaves. level: the sun's height; below -0.6 it's behind the clouds: no disc, white gulls, an olive
// tree and daisies (an oil painting), else an ink-and-wash pine. contrast: how cloudy
vec4 coast(vec2 uv){
  float A=R.x/R.y;PXW=1./R.y;
  vec2 u=uv+.003*(vec2(n2(uv*vec2(90.,60.)),n2(uv*vec2(60.,90.)+7.))-.5);
  vec2 q=vec2(u.x*A,u.y);
  float hz=.46;
  vec3 sky=pal(0),glow=pal(1),sea=pal(2),ink=pal(3),sun=pal(4),cloud=pal(5),leaf=pal(6);
  bool ink2=LV>-.6;
  vec2 sp=vec2(.72*A,hz+.16+.1*LV);
  float sdist=length(q-sp);
  vec3 c=mix(glow,sky,smoothstep(hz,1.,u.y));
  c=mix(c,glow,(ink2?.6:.3)*exp(-sdist*2.4));
  if(ink2)c=mix(c,sun,cover(sdist-.08)*.95);
  // clouds: lit on top, washed with shadow underneath, drifting
  float band=smoothstep(hz+.05,hz+.25,u.y);
  vec2 cq=vec2(q.x*(ink2?.8:1.1)-T*.012,u.y*(ink2?4.:3.))+vec2(SD*3.,0.);
  float cl=smoothstep(.52,.62,fbm(cq*1.5)+.3*band-.3+.22*(CT-1.)+.1*(u.y-.7))*band*mix(1.,smoothstep(1.05,.8,u.y),ink2?.6:.2);
  float lit=smoothstep(.4,.75,fbm(cq*3.1+vec2(0.,1.3))+.6*(u.y-.72));
  c=mix(c,mix(ink2?mix(cloud,ink,.45):mix(cloud,sky,.6),cloud,lit),cl*.92);
  // hills across the water, hazed by the distance, and the headland on the right with its town
  float far=hz+.012+.04*fbm(vec2(q.x*5.+SD,1.))*smoothstep(.1,.3,u.x)*smoothstep(.78,.6,u.x);
  c=mix(c,mix(ink,glow,.62),cover(u.y-far)*.85*step(hz,u.y));
  float right=hz+smoothstep(.58,.98,u.x)*(.12+.06*fbm(vec2(q.x*4.+SD,3.)))+.015*fbm(vec2(q.x*14.,5.))*smoothstep(.6,.7,u.x);
  c=mix(c,mix(mix(ink,sky,ink2?.5:.68),ink,(ink2?.55:.3)*fbm(q*vec2(8.,14.))),cover(u.y-right)*.9*step(hz,u.y));
  c=mix(c,mix(cloud,vec3(1.),.3),cover(u.y-hz-.005-.022*h1(vec2(floor(u.x*170.),1.)))*.8*step(.8,u.x)*step(hz,u.y));
  // the sea: lighter toward the horizon, broken strokes of trough and crest crowding toward it, the sun's road
  if(u.y<hz){
    float d=hz-u.y;
    c=mix(mix(sea,glow,.35),sea,smoothstep(0.,.16,d));
    c=mix(c,mix(sea,ink,.3),smoothstep(.15,.45,d));
    float z=1./(d+.03);
    float r=fbm(vec2(q.x*z*.45+T*.02,z*1.2-T*.2));
    c=mix(c,mix(sea,ink,.45),smoothstep(.5,.34,r)*.5);
    c=mix(c,mix(glow,vec3(1.),.4),smoothstep(.6,.78,r)*.55);
    float road=exp(-pow((q.x-sp.x)/(.03+.28*d),2.));
    float glint=smoothstep(.6,.9,n2(vec2(q.x*70./(1.+d*5.),z*5.-T*1.4)));
    c=mix(c,ink2?mix(sun,cloud,.35):vec3(1.),road*glint*(ink2?.9:.5));
  }
  // two sailboats, rocking, their reflections broken by the water
  for(int i=0;i<2;i++){
    float fi=float(i);
    vec2 b=vec2((.285+.125*fi)*A+.01*sin(T*.04+fi*2.),hz-.016-.014*fi+.003*sin(T*1.1+fi*1.7));
    float s=mix(.085,.16,fi);
    vec2 l=rot(.04*sin(T*.9+fi))*(q-b);
    float sail=min(sdTri(l,vec2(-s*.04,s*.1),vec2(-s*.04,s),vec2(s*.36,s*.12)),sdTri(l,vec2(-s*.1,s*.1),vec2(-s*.1,s*.82),vec2(-s*.42,s*.12)));
    float hull=max(abs(l.x)-s*.3+max(0.,-l.y)*1.5,abs(l.y+s*.02)-s*.05);
    float mast=sdSeg(l,vec2(-s*.07,0.),vec2(-s*.07,s*1.06))-s*.012;
    vec3 sc=mix(mix(sky,vec3(1.),.6),glow,.25);
    c=mix(c,mix(sc,ink,.25*smoothstep(-.3,.4,l.x/s)),cover(sail));
    c=mix(c,ink,cover(abs(sail)-s*.01)*.5);
    c=mix(c,ink,cover(min(hull,mast)));
    vec2 rl=vec2(l.x+.003*sin(l.y*500.+T*3.),-l.y-s*.1);
    float rs=min(sdTri(rl,vec2(-s*.04,s*.1),vec2(-s*.04,s),vec2(s*.36,s*.12)),sdTri(rl,vec2(-s*.1,s*.1),vec2(-s*.1,s*.82),vec2(-s*.42,s*.12)));
    c=mix(c,mix(sc,sea,.45),cover(rs)*.4*step(l.y,-s*.06));
  }
  // gulls, beating their wings, drifting across
  for(int i=0;i<3;i++){
    float fi=float(i);
    vec2 b=vec2((fract(.3+fi*.11+T*.006)*1.3-.15)*A,.8-fi*.06+.02*sin(T*.3+fi));
    float s=.045-.008*fi,f=sin(T*4.5+fi*2.1);
    vec2 l=q-b;
    vec2 el=vec2(s*.5,s*(.15+.25*f)),tip=vec2(s,s*(.05+.45*f));
    float w=min(min(sdSeg(l,vec2(0.),vec2(-el.x,el.y)),sdSeg(l,vec2(-el.x,el.y),vec2(-tip.x,tip.y))),min(sdSeg(l,vec2(0.),el),sdSeg(l,el,tip)));
    if(!ink2)c=mix(c,mix(ink,sky,.4),cover(w-s*.13)*.8);
    c=mix(c,ink2?ink:vec3(1.),cover(w-s*.09));
    if(!ink2)c=mix(c,ink,cover(max(w-s*.09,s*.78-abs(l.x)))*.85);
  }
  // the cliff in front: lit rock and inked cracks falling from the left edge to the water, scrub along it, rocks
  // and a line of surf where it meets the sea
  float top=mix(.6,0.,smoothstep(.03,.58,u.x))+.07*(fbm(vec2(u.x*5.+SD,2.))-.5)+.03*(fbm(vec2(u.x*28.,4.))-.5);
  top=max(top,step(u.x,.8)*smoothstep(.42,.5,u.x)*.085*smoothstep(.48,.62,fbm(vec2(u.x*11.+SD,9.)))*(.6+.4*fbm(vec2(u.x*40.,3.))));
  float ridge=1.-abs(2.*fbm(q*vec2(4.,14.)+3.)-1.);
  vec3 rock=mix(mix(ink,glow,ink2?.45:.25),mix(glow,cloud,ink2?.3:.5),smoothstep(.22,.62,fbm(q*vec2(6.,9.)+SD)));
  rock=mix(rock,ink,smoothstep(.82,.95,ridge)*(ink2?.8:.5));
  rock=mix(rock,ink,smoothstep(.6,.8,fbm(q*vec2(26.,7.)))*(ink2?.45:.25));
  float scrub=smoothstep(.55,.62,fbm(q*12.+5.)+.25*smoothstep(.12,0.,top-u.y));
  rock=mix(rock,mix(mix(leaf,ink,.45),mix(leaf,cloud,.25),smoothstep(.5,.8,fbm(q*40.))),scrub);
  if(!ink2){
    vec2 g=q*11.,id=floor(g),ctr=id+.5+.4*(vec2(h1(id+3.),h1(id+5.))-.5),f=g-ctr;
    float sz=mix(.6,1.,h1(id+9.)),here=step(.4,h1(id))*step(ctr.x/11./A,.2)*step(ctr.y/11.,.34),r=length(f)/sz,pet=.32+.08*cos(atan(f.y,f.x)*7.+h1(id)*6.);
    rock=mix(rock,mix(cloud,vec3(1.),.5),cover((r-pet)*sz/11.)*here);
    rock=mix(rock,sun,cover((r-.1)*sz/11.)*here);
  }
  c=mix(c,rock,cover(u.y-top));
  c=mix(c,ink,cover(abs(u.y-top)-.002)*.45*step(u.x,.6));
  c=mix(c,mix(cloud,vec3(1.),.5),smoothstep(.01,0.,abs(u.y-top-.007))*step(.42,u.x)*step(u.x,.8)*.5*n2(vec2(q.x*40.,T)));
  // the tree, swaying: a trunk and branches, a crown of layered pine clumps (ink) or a round olive crown (oil)
  vec2 tq=q+vec2((.006*sin(T*.7)+.003*sin(T*1.9))*max(0.,u.y-.45)*3.,0.);
  float tr=sdSeg(tq,vec2(.1*A,.42),vec2(.08*A,.6))-.022;
  tr=min(tr,sdSeg(tq,vec2(.08*A,.6),vec2(.05*A,.8))-.016);
  tr=min(tr,sdSeg(tq,vec2(.075*A,.66),vec2(.2*A,.82))-.007);
  tr=min(tr,sdSeg(tq,vec2(.06*A,.74),vec2(.16*A,.92))-.006);
  tr=min(tr,sdSeg(tq,vec2(.055*A,.78),vec2(0.,.9))-.006);
  float crown=-1.;
  for(int i=0;i<5;i++){
    vec4 k=ink2?(i==0?vec4(.05,.93,.13,.065):i==1?vec4(.16,.88,.12,.055):i==2?vec4(.26,.82,.09,.045):i==3?vec4(.1,.79,.1,.05):vec4(0.,.84,.08,.08))
               :(i==0?vec4(.08,.94,.19,.11):i==1?vec4(.22,.9,.15,.09):i==2?vec4(.33,.84,.11,.07):i==3?vec4(.13,.79,.12,.08):vec4(.02,.83,.09,.11));
    crown=max(crown,1.-length((tq-vec2(k.x*A,k.y))/k.zw));
  }
  float lv=step(-.2,crown)*smoothstep(.5,.56,fbm(tq*vec2(24.,30.)+SD*2.)+crown*.6);
  vec3 lc=ink2?mix(ink,mix(leaf,cloud,.3),smoothstep(.55,.85,fbm(tq*60.))):mix(mix(leaf,ink,.35),mix(leaf,cloud,.45),smoothstep(.45,.8,fbm(tq*45.)+tq.y-.85));
  c=mix(c,ink,cover(tr)*.9);
  c=mix(c,lc,lv);
  c*=.95+.1*fbm(q*vec2(14.,40.));
  return vec4(c,1.);
}

// 1970s swirls: contour bands of slow, interfering waves: ribbons of three stripes, a gap of the ground between,
// the colours turning from ribbon to ribbon. contrast: how many bands
vec4 swirl(vec2 p){
  vec2 q=p*SC*2.8+vec2(SD*1.7,SD);
  float t=T*.6;
  vec2 w=q+.6*vec2(sin(q.y*1.3+t),cos(q.x*1.1-t*.8));
  float f=sin(w.x*1.4+sin(w.y*1.9+t)*1.1)+sin(w.y*1.2+sin(w.x*1.6-t*.9)*1.3)+.6*sin((w.x-w.y)*.8+t*.6);
  float k=f*4.5*CT,b=floor(k),fr=fract(k),aa=min(fwidth(k)*1.5,.5);
  float n=float(NI);
  vec3 c1=mod(b,4.)<.5?pal(0):pal(1+int(mod(floor(b/4.)*3.+mod(b,4.)-1.,n)));
  float b2=b+1.;
  vec3 c2=mod(b2,4.)<.5?pal(0):pal(1+int(mod(floor(b2/4.)*3.+mod(b2,4.)-1.,n)));
  return vec4(mix(c1,c2,smoothstep(1.-aa,1.,fr)),1.);
}

// circles: clusters of overlapping discs, darker where they cross like ink over ink, floating; small dots between
vec4 circles(vec2 p){
  vec2 q=p*SC*2.2;PXW=SC*2.2/R.y;
  vec3 c=vec3(0.);float cov=0.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 cell=floor(q)+vec2(i,j);
    // one hash for the cluster (is it there, where, how many discs), one for each disc (its size, place, ink); the
    // coverage is measured in pixels, not by derivatives, so skipping empty cells and spare discs is safe
    vec4 hk=hc4(cell,SD);
    if(hk.x<.15)continue;
    vec2 ctr=cell+.5+.3*(hk.yz-.5)+.04*vec2(sin(T*.3+hk.x*6.),cos(T*.25+hk.x*5.));
    float k=1.+floor(hk.w*3.99);
    for(int d=0;d<4;d++){
      float fd=float(d);
      if(fd>=k)break;
      vec4 hd=hc4(cell,SD+1.+fd);
      float r=mix(.18,.5,hd.x)*(d==0?1.:.85)*(1.+.035*sin(T*.4+hd.w*6.));
      vec2 o=ctr+(d==0?vec2(0.):.3*(hd.yz-.5))+.025*vec2(sin(T*.2+hd.w*9.),cos(T*.17+hd.w*7.));
      float a=cover(length(q-o)-r);
      vec3 col=pal(1+int(hd.w*float(NI)*.999));
      c=cov>0.?mix(c,mix(c*col*1.45,col,.45),a*.75):(a>0.?col:c);
      cov=max(cov,a);
    }
  }
  vec2 g=q*3.,id=floor(g);
  vec4 hs=hc4(id,SD+9.);
  float a=cover((length(g-id-.5-.25*(hs.xy-.5))-mix(.12,.22,hs.z))/3.)*step(.86,hs.w);
  vec3 col=pal(1+int(fract(hs.z*7.)*float(NI)*.999));
  c=cov>0.?mix(c,c*col*1.45,a*.75):(a>0.?col:c);
  cov=max(cov,a);
  return vec4(c,cov);
}

// Bauhaus tiles: a grid of squares, each a motif (half and quarter discs, triangles, circles, rings and fields of
// dots, stripes, two-tone halves) in the inks, the last ink drawing the grid. Now and then a tile turns a quarter.
vec4 tiles(vec2 px){
  float ts=R.y/max(1.,4./SC);PXW=1./ts;
  vec2 g=px/ts,cell=floor(g),l=fract(g);
  float h=h1(cell+SD*1.7),h2=h1(cell+3.1+SD),h3=h1(cell+7.7+SD);
  float per=7.,tt=T*.7+h*per;
  float ang=(floor(tt/per)+smoothstep(0.,.12,fract(tt/per))+floor(h2*4.))*1.5708;
  vec2 r=rot(ang)*(l-.5);
  int m=int(h3*11.);
  int ni=max(NI-1,1);
  vec3 col=pal(1+int(fract(h*13.)*float(NI)*.999)),col2=pal(1+int(fract(h*29.)*float(ni)*.999));
  float dots=cover((length(fract(l*9.)-.5)-.17)/9.),stripes=cover((abs(fract(r.y*7.)-.5)-.2)/7.);
  vec3 c=pal(0);
  if(m==0)c=mix(c,col,cover(length(r-vec2(-.5,0.))-.5));
  else if(m==1)c=mix(c,col,cover(length(r+.5)-1.));
  else if(m==2)c=mix(c,col,cover((r.x+r.y)*.7071));
  else if(m==3)c=mix(c,col,cover(length(r)-.33));
  else if(m==4){float ring=abs(length(r)-.34)-.13;c=mix(c,col,cover(ring)*dots);c=mix(c,col,cover(abs(ring)-.008));}
  else if(m==5)c=mix(c,col,stripes*cover(r.x));
  else if(m==6)c=mix(c,col,cover((r.x+r.y)*.7071)*dots);
  else if(m==7){c=mix(c,col,cover(r.x));c=mix(c,col2,cover(-r.x)*cover(r.y));}
  else if(m==8){c=mix(c,col,stripes*(1.-cover(length(r)-.28)));c=mix(c,col,cover(abs(length(r)-.28)-.01));}
  else if(m==9){c=mix(c,col,cover(length(r-vec2(0.,-.5))-.5)*dots);c=mix(c,col,cover(abs(length(r-vec2(0.,-.5))-.5)-.008)*step(-.5,r.y));}
  float e=min(min(l.x,1.-l.x),min(l.y,1.-l.y))*ts;
  c=mix(c,pal(NI),1.-smoothstep(.5,1.3,e-max(.4,ts*.004)));
  return vec4(c,1.);
}

// a tunnel of rounded light: nested rounded rectangles (twice as wide as tall) rising from the foot, flowing outward,
// each band its colour on the ramp from the first ink (the heart) to the last (the outside, then the ground),
// shaded where it steps down to the next
vec4 tunnel(vec2 uv){
  float A=R.x/R.y;
  vec2 q=vec2((uv.x-.5)*A,uv.y)/SC;
  vec2 a=abs(q)/vec2(1.9,1.);
  float s=pow(pow(a.x,5.)+pow(a.y,5.),.2);
  float N=7.*CT,k=s*N-T*.3,b=floor(k),fr=fract(k);
  float v=(b+.5+T*.3)/N;
  vec3 col=v>1.?pal(0):ramp(v);
  float aa=min(fwidth(k)*1.5,.4);
  vec3 c=col*(.72+.36*smoothstep(0.,.55,fr));
  c=mix(c,(v+1./N>1.?pal(0):ramp(v+1./N))*.72,smoothstep(1.-aa,1.,fr));
  return vec4(c,1.);
}

// blocks of stepped colour: squares, dominoes and L shapes fitted together with a dark seam, each one hue stepping
// from light at its edge to deep at its heart (or the other way), the steps flowing inward
vec2 blockOf(vec2 c){
  vec2 s=floor(c*.5)*2.,l=c-s;
  int k=int(hc(s,SD*3.1)*7.);
  if(k==0)return s;
  if(k==1)return s+vec2(0.,l.y);
  if(k==2)return s+vec2(l.x,0.);
  vec2 one=k==3?vec2(1.):k==4?vec2(0.,1.):k==5?vec2(1.,0.):vec2(0.);
  return l==one?s+l:s+.5;
}
vec4 blocks(vec2 px){
  float cs=R.y/max(1.,4./SC);PXW=1./cs;
  vec2 g=px/cs,c=floor(g),B=blockOf(c);
  // the distance to the block's edge, side by side (an edge split across cells is still one edge), rounded only where
  // edges meet at a corner
  float dl=1e3,dr=1e3,dd=1e3,du=1e3;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 m=c+vec2(i,j);
    if(blockOf(m)!=B)continue;
    if(blockOf(m+vec2(-1.,0.))!=B)dl=min(dl,sdSeg(g,m,m+vec2(0.,1.)));
    if(blockOf(m+vec2(1.,0.))!=B)dr=min(dr,sdSeg(g,m+vec2(1.,0.),m+1.));
    if(blockOf(m+vec2(0.,-1.))!=B)dd=min(dd,sdSeg(g,m,m+vec2(1.,0.)));
    if(blockOf(m+vec2(0.,1.))!=B)du=min(du,sdSeg(g,m+vec2(0.,1.),m+1.));
  }
  float d=smin(smin(dl,dr,.2),smin(dd,du,.2),.2);
  float h=hc(B*2.+1.,SD+1.37);
  vec3 hue=pal(1+int(h*float(NI)*.999));
  vec3 light=mix(hue,vec3(1.),.62),deep=hue*.3;
  float N=14.*CT,k=d*N+T*.3,b=floor(k),fr=fract(k);
  float x=clamp((b+.5-T*.3)/(N*.5),0.,1.);
  if(fract(h*7.31)<.5)x=1.-x;
  // pale, through the full hue, to deep
  vec3 col=x<.5?mix(light,hue,x*2.):mix(hue,deep,x*2.-1.);
  vec3 cl=col*(.74+.34*smoothstep(0.,.5,fr));
  return vec4(mix(pal(0),cl,cover(.035-d)),1.);
}

void main(){
  float sd;vec2 cc;
  vec2 px=tube(gl_FragCoord.xy,sd,cc);
  vec2 uv=px/R,p=(uv-.5)*vec2(R.x/R.y,1.);
  vec4 s=SN==1?horizon(uv,p):SN==2?coast(uv):SN==3?swirl(p):SN==4?circles(p):SN==5?tiles(px):SN==6?tunnel(uv):blocks(px);
  float m=1.;
  if(FD==1)m=smoothstep(0.,.4,uv.y);
  else if(FD==2)m=smoothstep(0.,.4,1.-uv.y);
  else if(FD==3)m=smoothstep(0.,.18,min(min(uv.x,1.-uv.x),min(uv.y,1.-uv.y)));
  else if(FD==4)m=1.-smoothstep(.25,.75,length(uv-.5)*1.41);
  float cov=s.a*m;
  o=finish(s.rgb*cov+GND.rgb*GND.a*(1.-cov),cov+GND.a*(1.-cov),px,cc,sd);
}`

const FX = { gl: null, el: null, field: null, shape: null, scene: null, vao: null, dead: false, raf: 0, all: new Set(), pics: new Map(), atlases: new Map(), stub: null }
const SRC = ["flow", "waves", "rings", "orb", "picture", "clouds", "beam", "cumulus", "horizon", "coast", "swirl", "circles", "tiles", "tunnel", "blocks"]
/** the sources drawn as whole pictures at every pixel (the scene program), in its order: SN 1, 2, … */
const SCENES = SRC.slice(8)
const CELL = ["pixel", "dot", "cross", "char", "line", "block", "smooth"]
const FADE = ["none", "bottom", "top", "edges", "radial"]
const clampN = (v, lo, hi, d) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d)

/** An effect's settings from anywhere, held to their ranges (the editor's check is in src/canvas/effects.ts). */
function fxParams(r = {}) {
  const colors = (Array.isArray(r.colors) ? r.colors : []).filter((c) => typeof c === "string" && css(c)).slice(0, 7)
  return {
    source: SRC.includes(r.source) ? r.source : "flow",
    picture: picture(r.picture) ? r.picture : "",
    cell: CELL.includes(r.cell) ? r.cell : "dot",
    chars: typeof r.chars === "string" && r.chars.length > 1 ? [...r.chars].slice(0, 16).join("") : " .:-=+*#",
    size: clampN(r.size, 3, 120, 12),
    gap: clampN(r.gap, 0, 0.9, 0.1),
    sizeBy: clampN(r.sizeBy, 0, 1, 1),
    dither: clampN(r.dither, 0, 1, 0),
    soft: clampN(r.soft, 0, 1, 0),
    contrast: clampN(r.contrast, 0.2, 3, 1.3),
    level: clampN(r.level, -1, 1, 0),
    invert: !!r.invert,
    scale: clampN(r.scale, 0.2, 5, 1.2),
    speed: clampN(r.speed, 0, 3, 0.3),
    angle: clampN(r.angle, -360, 360, 0),
    colors: colors.length >= 2 ? colors : ["#ffffff", "#2f8ff0"],
    tint: !!r.tint,
    under: clampN(r.under, 0, 1, 0),
    glow: clampN(r.glow, 0, 1, 0),
    grain: clampN(r.grain, 0, 1, 0),
    fade: FADE.includes(r.fade) ? r.fade : "none",
    seed: clampN(r.seed, 0, 1000, 0),
    screen: clampN(r.screen, 0, 1, 0),
    paper: clampN(r.paper, 0, 1, 0),
  }
}

// any CSS colour to [r, g, b, a] in 0–1, by letting the browser read it
const colours = new Map()
function rgba(c) {
  if (colours.has(c)) return colours.get(c)
  let out = [0, 0, 0, 0]
  if (c !== "transparent") {
    FX.stub ??= document.createElement("canvas").getContext("2d")
    const x = FX.stub
    x.fillStyle = "#000"
    x.fillStyle = c
    const v = String(x.fillStyle)
    const hex = /^#([0-9a-f]{6})$/i.exec(v)
    if (hex) {
      const n = parseInt(hex[1], 16)
      out = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1]
    } else {
      const m = /rgba?\(([^)]+)\)/.exec(v)
      if (m) {
        const [r, g, b, a = 1] = m[1].split(",").map(Number)
        out = [r / 255, g / 255, b / 255, a]
      }
    }
  }
  colours.set(c, out)
  return out
}

/** The shared WebGL2 context and its two programs. The shaders compile in the background where the browser can
    (KHR_parallel_shader_compile): asking for a program's status straight away made the page wait for the GPU driver,
    seconds on Direct3D. Returns the context, null when effects can't run, or undefined while still compiling. */
function fxGL() {
  if (FX.gl || FX.dead) return FX.gl
  if (!FX.boot) {
    const el = document.createElement("canvas")
    const gl = el.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false })
    if (!gl) {
      FX.dead = true
      return null
    }
    const shader = (type, src) => {
      const sh = gl.createShader(type)
      gl.shaderSource(sh, src)
      gl.compileShader(sh)
      return sh
    }
    const start = (fs) => {
      const p = gl.createProgram()
      const v = shader(gl.VERTEX_SHADER, VS)
      const f = shader(gl.FRAGMENT_SHADER, fs)
      gl.attachShader(p, v)
      gl.attachShader(p, f)
      gl.linkProgram(p)
      return { p, v, f }
    }
    FX.boot = { el, gl, ext: gl.getExtension("KHR_parallel_shader_compile"), field: start(FIELD_FS), shape: start(SHAPE_FS), scene: start(SCENE_FS) }
  }
  const { el, gl, ext, field, shape, scene } = FX.boot
  if (ext && !(gl.getProgramParameter(field.p, ext.COMPLETION_STATUS_KHR) && gl.getProgramParameter(shape.p, ext.COMPLETION_STATUS_KHR))) return undefined
  FX.boot = null
  const finish = ({ p, v, f }) => {
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getShaderInfoLog(f) || gl.getShaderInfoLog(v) || gl.getProgramInfoLog(p))
    const u = {}
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const a = gl.getActiveUniform(p, i)
      u[a.name.replace(/\[0\]$/, "")] = gl.getUniformLocation(p, a.name)
    }
    return { p, u }
  }
  try {
    FX.field = finish(field)
    FX.shape = finish(shape)
  } catch (e) {
    console.warn("[canvas] effects are off:", e.message)
    FX.dead = true
    return null
  }
  // the scene program is the biggest: it finishes compiling on its own, and the cell effects don't wait for it
  FX.sceneBoot = { ext, scene, finish }
  FX.vao = gl.createVertexArray()
  // a 1 × 1 clear texture for samplers with nothing to read (the field's picture, the cells' characters), so neither
  // ever points at the texture being drawn into
  FX.blank = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, FX.blank)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  el.addEventListener("webglcontextlost", (e) => {
    e.preventDefault()
    FX.gl = null
    FX.dead = true
    FX.scene = null
    FX.sceneBoot = null
    for (const x of FX.all) Object.assign(x, { tex: null, fbo: null, tw: 0, th: 0, drawn: "" })
    FX.pics.clear()
    FX.atlases.clear()
  })
  el.addEventListener("webglcontextrestored", () => {
    FX.dead = false
    fxGL()
    fxKick()
  })
  FX.gl = gl
  FX.el = el
  // characters drawn before the page's fonts arrived are drawn again once they have
  document.fonts?.ready.then(() => {
    for (const t of FX.atlases.values()) gl.deleteTexture(t.tex)
    FX.atlases.clear()
    for (const x of FX.all) x.drawn = ""
    fxKick()
  })
  return gl
}

/** The scene program, once it has compiled; undefined while it still is, null if this GPU can't run it. */
function sceneGL(gl) {
  if (FX.scene !== null || !FX.sceneBoot) return FX.scene ?? null
  const { ext, scene, finish } = FX.sceneBoot
  if (ext && !gl.getProgramParameter(scene.p, ext.COMPLETION_STATUS_KHR)) return undefined
  FX.sceneBoot = null
  try {
    FX.scene = finish(scene)
  } catch (e) {
    console.warn("[canvas] scene effects are off:", e.message)
  }
  return FX.scene
}

/** The characters of a "char" effect as a strip of glyphs, white on clear. */
function atlas(gl, chars) {
  let a = FX.atlases.get(chars)
  if (a) return a
  const S = 64
  const list = [...chars]
  const c = Object.assign(document.createElement("canvas"), { width: S * list.length, height: S })
  const x = c.getContext("2d")
  x.fillStyle = "#fff"
  x.textAlign = "center"
  x.textBaseline = "middle"
  x.font = `600 ${S * 0.8}px "Geist Mono", ui-monospace, monospace`
  list.forEach((ch, i) => x.fillText(ch, i * S + S / 2, S / 2 + S * 0.04))
  // uploads go through a spare unit, so they never unbind what a draw is reading
  gl.activeTexture(gl.TEXTURE3)
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  a = { tex, n: list.length }
  FX.atlases.set(chars, a)
  return a
}

/** A picture for a "picture" effect, loaded once per page; a picture another site won't share stays a flow. */
function pic(gl, src) {
  let p = FX.pics.get(src)
  if (p) return p
  p = { tex: null, w: 1, h: 1, ready: false }
  FX.pics.set(src, p)
  const img = new Image()
  img.crossOrigin = "anonymous"
  img.decoding = "async"
  img.onload = () => {
    try {
      gl.activeTexture(gl.TEXTURE3)
      p.tex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, p.tex)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      Object.assign(p, { w: img.naturalWidth, h: img.naturalHeight, ready: true })
      for (const x of FX.all) x.drawn = ""
      fxKick()
    } catch {
      /* not ours to read */
    }
  }
  img.src = src
  return p
}

/** One effect on the page: its own canvas (the shared context hands it its picture), what it draws, at what size. */
function fxEntry(params, visible) {
  const el = Object.assign(document.createElement("canvas"), { className: "ec-fx" })
  el.setAttribute("aria-hidden", "true")
  const e = { el, ctx: el.getContext("2d"), p: params, w: 0, h: 0, scale: 1, visible, t0: performance.now(), drawn: "", sig: "", tex: null, fbo: null, tw: 0, th: 0 }
  FX.all.add(e)
  return e
}
function fxDrop(e) {
  FX.all.delete(e)
  if (FX.gl && e.tex) {
    FX.gl.deleteTexture(e.tex)
    FX.gl.deleteFramebuffer(e.fbo)
  }
}
const fxSig = (e) => `${JSON.stringify(e.p)}|${Math.round(e.w)}x${Math.round(e.h)}|${e.scale.toFixed(3)}`

/** The palette (the ground, then up to six inks) and the finish (the screen, paper, grain), into either program. */
function fxShared(gl, P, p) {
  const ground = rgba(p.colors[0])
  const inks = p.colors.slice(1).map(rgba)
  gl.uniform4f(P.u.GND, ground[0], ground[1], ground[2], ground[3])
  gl.uniform3fv(P.u.INK, new Float32Array([0, 1, 2, 3, 4, 5].flatMap((i) => (inks[i] || inks[inks.length - 1]).slice(0, 3))))
  gl.uniform1i(P.u.NI, inks.length)
  gl.uniform1i(P.u.FD, FADE.indexOf(p.fade))
  gl.uniform1f(P.u.CR, p.screen)
  gl.uniform1f(P.u.PA, p.paper)
  gl.uniform1f(P.u.GR, p.grain)
  gl.uniform1f(P.u.MK, SCENES.includes(p.source) || p.cell === "smooth" ? 1 : 0)
}

/** Draws an effect into its canvas; false while the program it needs is still compiling. */
function fxDraw(gl, e, t) {
  const p = e.p
  const scene = SCENES.includes(p.source)
  // a retina screen's own density: characters and dots stay crisp at their edges (a painted scene is soft enough at
  // the frame's own, and it's the heaviest to draw)
  const dpr = Math.min(devicePixelRatio || 1, p.source === "coast" || p.source === "horizon" ? 1 : 2)
  const W = Math.max(1, Math.round(e.w * dpr))
  const H = Math.max(1, Math.round(e.h * dpr))
  if (scene) {
    const P = sceneGL(gl)
    if (P === undefined) return false
    if (!P) {
      fxPlain(e)
      return true
    }
  }
  if (e.el.width !== W || e.el.height !== H) Object.assign(e.el, { width: W, height: H })
  if (FX.el.width < W || FX.el.height < H) Object.assign(FX.el, { width: Math.max(FX.el.width, W), height: Math.max(FX.el.height, H) })
  if (scene) {
    const P = FX.scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, W, H)
    gl.useProgram(P.p)
    gl.bindVertexArray(FX.vao)
    gl.uniform2f(P.u.R, W, H)
    gl.uniform1f(P.u.T, t)
    gl.uniform1f(P.u.SC, p.scale)
    gl.uniform1f(P.u.SD, p.seed)
    gl.uniform1f(P.u.CT, p.contrast)
    gl.uniform1f(P.u.LV, p.level)
    gl.uniform1i(P.u.SN, SCENES.indexOf(p.source) + 1)
    fxShared(gl, P, p)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    e.ctx.clearRect(0, 0, W, H)
    e.ctx.drawImage(FX.el, 0, FX.el.height - H, W, H, 0, 0, W, H)
    return true
  }
  const C = Math.max(2, p.size * e.scale * dpr)
  const cols = Math.ceil(W / C)
  const rows = Math.ceil(H / C)
  // the field, into the effect's own small texture
  if (!e.tex) {
    e.tex = gl.createTexture()
    e.fbo = gl.createFramebuffer()
  }
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, e.tex)
  if (e.tw !== cols || e.th !== rows) {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindFramebuffer(gl.FRAMEBUFFER, e.fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, e.tex, 0)
    e.tw = cols
    e.th = rows
  }
  const photo = p.source === "picture" && p.picture ? pic(gl, p.picture) : null
  const F = FX.field
  gl.bindFramebuffer(gl.FRAMEBUFFER, e.fbo)
  gl.viewport(0, 0, cols, rows)
  gl.useProgram(F.p)
  gl.bindVertexArray(FX.vao)
  gl.uniform2f(F.u.G, cols, rows)
  gl.uniform1f(F.u.A, W / H)
  gl.uniform1f(F.u.T, t)
  gl.uniform1i(F.u.S, SRC.indexOf(p.source))
  gl.uniform1f(F.u.SC, p.scale)
  gl.uniform1f(F.u.AN, (p.angle * Math.PI) / 180)
  gl.uniform1f(F.u.SD, p.seed)
  gl.uniform1f(F.u.CT, p.contrast)
  gl.uniform1f(F.u.LV, p.level)
  gl.uniform1i(F.u.INV, p.invert ? 1 : 0)
  gl.uniform1i(F.u.HP, photo?.ready ? 1 : 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, photo?.ready ? photo.tex : FX.blank)
  gl.uniform1i(F.u.P, 1)
  gl.uniform2f(F.u.PS, photo?.ready ? photo.w : 1, photo?.ready ? photo.h : 1)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, e.tex)
  gl.generateMipmap(gl.TEXTURE_2D)
  // the cells, into the bottom-left corner of the shared canvas
  const S = FX.shape
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.viewport(0, 0, W, H)
  gl.useProgram(S.p)
  gl.uniform1i(S.u.F, 0)
  gl.uniform2f(S.u.R, W, H)
  gl.uniform2f(S.u.G, cols, rows)
  gl.uniform1f(S.u.C, C)
  gl.uniform1i(S.u.SH, CELL.indexOf(p.cell))
  gl.uniform1f(S.u.GP, p.gap)
  gl.uniform1f(S.u.SB, p.sizeBy)
  gl.uniform1f(S.u.DI, p.dither)
  gl.uniform1f(S.u.SO, p.soft)
  gl.uniform1f(S.u.GL, p.glow)
  gl.uniform1f(S.u.T, t)
  gl.uniform1i(S.u.TI, p.tint && photo?.ready ? 1 : 0)
  gl.uniform1f(S.u.UN, photo?.ready ? p.under : 0)
  fxShared(gl, S, p)
  const chars = p.cell === "char" ? atlas(gl, p.chars) : null
  gl.activeTexture(gl.TEXTURE2)
  gl.bindTexture(gl.TEXTURE_2D, chars ? chars.tex : FX.blank)
  gl.uniform1i(S.u.AT, 2)
  gl.uniform1f(S.u.NC, chars ? chars.n : 1)
  gl.activeTexture(gl.TEXTURE0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  e.ctx.clearRect(0, 0, W, H)
  e.ctx.drawImage(FX.el, 0, FX.el.height - H, W, H, 0, 0, W, H)
  return true
}

/** Without WebGL2: the ground, with the first ink as a soft light. */
function fxPlain(e) {
  const W = Math.max(1, Math.round(e.w))
  const H = Math.max(1, Math.round(e.h))
  Object.assign(e.el, { width: W, height: H })
  const x = e.ctx
  x.fillStyle = e.p.colors[0]
  x.fillRect(0, 0, W, H)
  const g = x.createRadialGradient(W * 0.6, H * 0.45, 0, W * 0.6, H * 0.45, Math.max(W, H) * 0.6)
  g.addColorStop(0, e.p.colors[1])
  g.addColorStop(1, "rgba(0,0,0,0)")
  x.fillStyle = g
  x.fillRect(0, 0, W, H)
}

function fxFrame(now) {
  FX.raf = 0
  const gl = fxGL()
  // the shaders are still compiling in the background: look again next frame, draw nothing yet
  if (gl === undefined) {
    FX.raf = requestAnimationFrame(fxFrame)
    return
  }
  let again = false
  for (const e of FX.all) {
    if (!e.el.isConnected || !e.w || !e.h || !e.visible()) continue
    const still = reduced() || !(e.p.speed > 0)
    e.sig = fxSig(e)
    if (still && e.drawn === e.sig) continue
    // a preview (the gallery, the lab) moves at its own pace, under the screen's: a slow drift reads the same at 30
    if (!still && e.fps && now - (e.last || 0) < 1000 / e.fps - 2) {
      again = true
      continue
    }
    e.last = now
    // a scene whose program is still compiling shows its plain ground, and is drawn again next frame
    if (gl && fxDraw(gl, e, still ? 7.3 : ((now - e.t0) / 1000) * e.p.speed) === false) {
      fxPlain(e)
      again = true
      continue
    }
    if (!gl) fxPlain(e)
    e.drawn = e.sig
    if (!still) again = true
  }
  if (again) FX.raf = requestAnimationFrame(fxFrame)
}
const fxKick = () => {
  if (!FX.raf) FX.raf = requestAnimationFrame(fxFrame)
}

/** An effect on its own, outside a canvas (the editor's gallery, the template lab's previews): drawn in `el`, moving
    while it's on screen. `frame`: the width of the frame its sizes are for (cells keep their share of it). `fps`: how
    often a moving one redraws (30: a gallery of them shares the screen with everything else). Returns
    { update(effect), destroy() }. */
export function effect(el, settings, { frame = 1440, fps = 30 } = {}) {
  const vis = { on: false }
  const e = fxEntry(fxParams(settings), () => vis.on)
  e.fps = fps
  el.replaceChildren(e.el)
  const size = () => {
    e.w = el.clientWidth
    e.h = el.clientHeight
    e.scale = Math.max(0.5, e.w / frame)
    fxKick()
  }
  const io = new IntersectionObserver(([x]) => {
    vis.on = x.isIntersecting
    fxKick()
  })
  const ro = new ResizeObserver(size)
  io.observe(el)
  ro.observe(el)
  size()
  return {
    update(next) {
      e.p = fxParams(next)
      fxKick()
    },
    destroy() {
      io.disconnect()
      ro.disconnect()
      fxDrop(e)
      e.el.remove()
    },
  }
}

