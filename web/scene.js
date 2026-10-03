import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const LOGO_URL = "assets/sesh-logo.png";
// Eye-socket centres in the logo image as UV (0,0 = bottom-left).
const EYES = [[0.4, 0.285], [0.557, 0.319]];
const LOGO_H = 3.4;
const LOGO_DEPTH = 0.36;
const LOGO_LAYERS = 40;
const LOGO_TEX_W = 160; // PS1-sized texture
const HALO_R = 2.15;
const BARS = 48;
const BOLT_Z = -18;
const PS1_LINES = 240; // render resolution along the shorter screen side
const GRAY_LEVELS = 8;

const root = document.documentElement;
const canvas = document.getElementById("scene");
const plaque = document.querySelector(".plaque");
const status = document.querySelector(".status");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
} catch (err) {
  document.body.classList.add("no-webgl");
  throw err;
}
renderer.setPixelRatio(1);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.setClearColor(0x000000);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000000, 0.035);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 120);
camera.position.set(0, 0, 9);

// ---------- PS1 tricks ----------

// Half the render resolution: NDC * this = pixel units, so vertices can snap to whole pixels.
const snapUniform = { value: new THREE.Vector2(160, 120) };
const SNAP_GLSL = /* glsl */ `
  gl_Position.xy = floor(gl_Position.xy / gl_Position.w * uSnap + 0.5) / uSnap * gl_Position.w;`;

// Patch a built-in material so its vertices wobble on the pixel grid.
function wobble(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uSnap = snapUniform;
    shader.vertexShader = "uniform vec2 uSnap;\n" + shader.vertexShader.replace(
      "#include <project_vertex>",
      "#include <project_vertex>\n" + SNAP_GLSL,
    );
  };
  return material;
}

function nearest(tex) {
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  return tex;
}

// Grayscale + ordered dither down to a handful of gray levels.
const ditherPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    float bayer4(vec2 p) {
      int x = int(mod(p.x, 4.0)), y = int(mod(p.y, 4.0));
      int i = x + y * 4;
      int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
      return (float(m[i]) + 0.5) / 16.0;
    }
    void main() {
      float l = dot(texture2D(tDiffuse, vUv).rgb, vec3(0.299, 0.587, 0.114));
      float n = ${(GRAY_LEVELS - 1).toFixed(1)};
      l = clamp(floor(l * n + bayer4(gl_FragCoord.xy)) / n, 0.0, 1.0);
      gl_FragColor = vec4(vec3(l), 1.0);
    }`,
});

const composer = new EffectComposer(renderer);
composer.setPixelRatio(1);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.3, 0.85));
composer.addPass(new OutputPass());
composer.addPass(ditherPass);

// Visible world-space size of the view at depth z.
function view(z) {
  const dist = camera.position.z - z;
  const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * dist;
  return { vw: vh * camera.aspect, vh };
}

function softDotTexture(size = 32) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.4)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  return nearest(new THREE.CanvasTexture(c));
}
const softDot = softDotTexture();

// ---------- storm sky ----------

const sky = {
  uTime: { value: 0 },
  uFlash: { value: 0 },
  uFlashPos: { value: new THREE.Vector2(0.5, 0.8) },
};
const SKY_Z = -40;
const SKY_W = 160;
const SKY_H = 80;
const skyMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(SKY_W, SKY_H),
  new THREE.ShaderMaterial({
    uniforms: sky,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uFlash;
      uniform vec2 uFlashPos;
      varying vec2 vUv;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
                   mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
        return v;
      }

      void main() {
        vec2 p = vUv * vec2(8.0, 4.0);
        float t = uTime * 0.03;
        vec2 q = vec2(fbm(p + vec2(t, 0.0)), fbm(p + vec2(-t * 0.7, t * 0.3) + 3.1));
        float c = fbm(p + 2.2 * q + vec2(t * 1.5, 0.0));

        float col = mix(0.0, 0.016, smoothstep(0.4, 0.9, c));
        float d = distance(vUv * vec2(2.0, 1.0), uFlashPos * vec2(2.0, 1.0));
        col += uFlash * (0.05 + 1.2 * exp(-d * 4.0)) * 0.5 * smoothstep(0.3, 0.9, c + 0.1);

        gl_FragColor = vec4(vec3(col), 1.0);
      }`,
  }),
);
skyMesh.position.z = SKY_Z;
scene.add(skyMesh);

// ---------- lights ----------

scene.add(new THREE.HemisphereLight(0x8a8a8a, 0x111111, 1.0));
const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
keyLight.position.set(-3, 4, 6);
scene.add(keyLight);
const lightningLight = new THREE.DirectionalLight(0xffffff, 0);
lightningLight.position.set(0, 10, 4);
scene.add(lightningLight);

// ---------- lightning ----------

const BOLT_W = 128;
const BOLT_H = 256;
const BOLT_PLANE_H = 18;

function makeBolt() {
  const c = document.createElement("canvas");
  c.width = BOLT_W;
  c.height = BOLT_H;
  const tex = nearest(new THREE.CanvasTexture(c));
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(BOLT_PLANE_H / 2, BOLT_PLANE_H), mat);
  mesh.position.z = BOLT_Z;
  scene.add(mesh);
  return { g: c.getContext("2d"), tex, mat, mesh, life: 0 };
}
const bolts = [makeBolt(), makeBolt()];
let boltIndex = 0;

function drawBolt(g) {
  g.clearRect(0, 0, BOLT_W, BOLT_H);
  const segs = [];
  const stack = [[BOLT_W * (0.3 + Math.random() * 0.4), 0, (Math.random() - 0.5) * 0.4, BOLT_H * (0.7 + Math.random() * 0.25), 1.6, 0]];
  while (stack.length) {
    let [x, y, dir, len, w, depth] = stack.pop();
    const step = 4;
    for (let d = 0; d < len; d += step) {
      const a = dir + (Math.random() - 0.5) * 1.2;
      const nx = x + Math.sin(a) * step;
      const ny = y + Math.cos(a) * step;
      segs.push([x, y, nx, ny, w * (1 - (d / len) * 0.5)]);
      x = nx;
      y = ny;
      if (depth < 3 && Math.random() < 0.03) {
        const turn = (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7);
        stack.push([x, y, dir + turn, (len - d) * (0.3 + Math.random() * 0.4), w * 0.6, depth + 1]);
      }
    }
  }
  g.lineCap = "square";
  g.shadowColor = "#fff";
  for (const [blur, color, mul] of [[6, "rgba(255,255,255,0.35)", 3], [0, "#fff", 1]]) {
    g.shadowBlur = blur;
    g.strokeStyle = color;
    for (const s of segs) {
      g.lineWidth = s[4] * mul;
      g.beginPath();
      g.moveTo(s[0], s[1]);
      g.lineTo(s[2], s[3]);
      g.stroke();
    }
  }
}

let flash = 0;
let sinceStrike = 0;
let nextStrike = 1.5;

function strike(power = 1) {
  const b = bolts[boltIndex++ % bolts.length];
  drawBolt(b.g);
  b.tex.needsUpdate = true;

  const { vw, vh } = view(BOLT_Z);
  const x = (Math.random() - 0.5) * vw * 0.9;
  b.mesh.position.x = x;
  b.mesh.position.y = vh / 2 + 1.5 - BOLT_PLANE_H / 2;
  b.mesh.scale.x = Math.random() < 0.5 ? -1 : 1;
  b.life = power;

  // project the strike onto the sky plane to light the right clouds
  const k = (camera.position.z - SKY_Z) / (camera.position.z - BOLT_Z);
  sky.uFlashPos.value.set(0.5 + (x * k) / SKY_W, 0.5 + ((vh / 2) * k * 0.6) / SKY_H);
  lightningLight.position.set(x * 0.3, 10, 4);

  flash = Math.max(flash, power);
  sinceStrike = 0;

  // real lightning flickers: a couple of quick re-strikes down the same channel
  if (!reduceMotion) {
    const n = (Math.random() * 3) | 0;
    for (let i = 1; i <= n; i++) {
      setTimeout(() => {
        flash = Math.max(flash, power * (0.5 + Math.random() * 0.5));
        b.life = Math.max(b.life, power * 0.8);
      }, i * (60 + Math.random() * 90));
    }
  }
}

// ---------- logo, halo, visualizer ----------

const stage = new THREE.Group();
scene.add(stage);
const pivot = new THREE.Group();
stage.add(pivot);

const metal = wobble(new THREE.MeshPhongMaterial({ color: 0xbbbbbb, flatShading: true, shininess: 30, emissive: 0x111111 }));

const halo = new THREE.Group();
halo.position.z = -0.7;
halo.add(new THREE.Mesh(new THREE.TorusGeometry(HALO_R - 0.06, 0.05, 4, 32), metal));
halo.add(new THREE.Mesh(new THREE.TorusGeometry(HALO_R - 0.22, 0.02, 3, 32), metal));
pivot.add(halo);

const bars = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1, 0.08), metal, BARS);
halo.add(bars);
const dummy = new THREE.Object3D();

const backGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: softDot, color: 0x555555, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false,
}));
backGlow.scale.setScalar(7);
backGlow.position.z = -1.6;
pivot.add(backGlow);

const eyeMat = wobble(new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3), fog: false }));
const eyeGlows = [];
const logoLight = { value: 1 };
let hitPlane = null;

// Unlit, affine-textured, vertex-snapped slice of the logo.
function sliceMaterial(tex, shade) {
  const mat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog]),
    fog: true,
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      uniform vec2 uSnap;
      varying vec3 vAffine;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        ${SNAP_GLSL}
        // Pre-multiply by w so the GPU's perspective correction cancels out:
        // PS1-style affine texture warp.
        vAffine = vec3(uv * gl_Position.w, gl_Position.w);
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform sampler2D map;
      uniform float uShade;
      uniform float uLight;
      varying vec3 vAffine;
      void main() {
        vec4 t = texture2D(map, vAffine.xy / vAffine.z);
        if (t.a < 0.5) discard;
        gl_FragColor = vec4(t.rgb * uShade * uLight, 1.0);
        #include <fog_fragment>
      }`,
  });
  Object.assign(mat.uniforms, {
    map: { value: tex },
    uShade: { value: shade },
    uLight: logoLight,
    uSnap: snapUniform,
  });
  return mat;
}

new THREE.ImageLoader().load(LOGO_URL, (img) => {
  // Downsample to a PS1-sized texture.
  const c = document.createElement("canvas");
  c.width = LOGO_TEX_W;
  c.height = Math.round((LOGO_TEX_W * img.height) / img.width);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const tex = nearest(new THREE.CanvasTexture(c));
  tex.colorSpace = THREE.SRGBColorSpace;

  const H = LOGO_H;
  const W = (H * img.width) / img.height;
  const geo = new THREE.PlaneGeometry(W, H, 3, 3);

  // Fake an extrusion by stacking alpha-tested slices, darkening toward the back.
  for (let i = 0; i < LOGO_LAYERS; i++) {
    const k = i / (LOGO_LAYERS - 1);
    const slice = new THREE.Mesh(geo, sliceMaterial(tex, i === 0 ? 1 : 0.45 - k * 0.38));
    slice.position.z = -k * LOGO_DEPTH;
    pivot.add(slice);
  }

  for (const [u, v] of EYES) {
    const x = (u - 0.5) * W;
    const y = (v - 0.5) * H;
    const ember = new THREE.Mesh(new THREE.CircleGeometry(0.1, 6), eyeMat);
    ember.position.set(x, y, -LOGO_DEPTH * 0.7);
    pivot.add(ember);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDot, color: 0xffffff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    glow.position.set(x, y, 0.02);
    glow.scale.setScalar(0.3);
    pivot.add(glow);
    eyeGlows.push(glow);
  }

  hitPlane = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  pivot.add(hitPlane);
  document.body.classList.add("scene-ready");
});

// ---------- rain & ash ----------

const DROPS = 700;
const rainPos = new Float32Array(DROPS * 6);
const rainSpeed = new Float32Array(DROPS);
function resetDrop(i, anywhere) {
  const x = (Math.random() - 0.5) * 30;
  const y = anywhere ? (Math.random() - 0.5) * 18 : 9 + Math.random() * 3;
  const z = -10 + Math.random() * 14;
  const len = 0.3 + Math.random() * 0.3;
  rainPos.set([x, y, z, x + len * 0.18, y - len, z], i * 6);
  rainSpeed[i] = 14 + Math.random() * 8;
}
for (let i = 0; i < DROPS; i++) resetDrop(i, true);
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
const rainMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false });
scene.add(new THREE.LineSegments(rainGeo, rainMat));

const ASH = 70;
const ashPos = new Float32Array(ASH * 3);
const ashVel = new Float32Array(ASH * 2);
function resetAsh(i, anywhere) {
  ashPos.set([(Math.random() - 0.5) * 14, anywhere ? (Math.random() - 0.5) * 10 : -6, -4 + Math.random() * 7], i * 3);
  ashVel[i * 2] = 0.2 + Math.random() * 0.6;
  ashVel[i * 2 + 1] = Math.random() * Math.PI * 2;
}
for (let i = 0; i < ASH; i++) resetAsh(i, true);
const ashGeo = new THREE.BufferGeometry();
ashGeo.setAttribute("position", new THREE.BufferAttribute(ashPos, 3));
scene.add(new THREE.Points(ashGeo, new THREE.PointsMaterial({
  color: 0xbbbbbb, size: 1, sizeAttenuation: false, transparent: true, opacity: 0.7, depthWrite: false,
})));

// ---------- layout & input ----------

let baseY = 0;
function layout() {
  const w = innerWidth;
  const h = innerHeight;
  // Render tiny, let CSS blow it up with hard pixels.
  const scale = PS1_LINES / Math.min(w, h);
  const rw = Math.max(1, Math.round(w * scale));
  const rh = Math.max(1, Math.round(h * scale));
  renderer.setSize(rw, rh, false);
  composer.setSize(rw, rh);
  snapUniform.value.set(rw / 2, rh / 2);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  // Fit the logo + halo into the gap between the status pill and the radio box.
  const { vw, vh } = view(0);
  const top = status ? status.getBoundingClientRect().bottom : h * 0.1;
  const bottom = plaque ? plaque.getBoundingClientRect().top : h * 0.7;
  const regionH = (Math.max(bottom - top, h * 0.3) / h) * vh;
  const s = Math.min(regionH / 5.4, (vw * 0.82) / 5.4);
  stage.scale.setScalar(s);
  baseY = (0.5 - (top + bottom) / 2 / h) * vh;
}
addEventListener("resize", layout);
if (plaque) new ResizeObserver(layout).observe(plaque);
layout();

const pointer = new THREE.Vector2();
const target = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
function overLogo(e) {
  if (!hitPlane) return false;
  pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(hitPlane).length > 0;
}
addEventListener("pointermove", (e) => {
  target.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1);
  canvas.style.cursor = overLogo(e) ? "pointer" : "";
});
canvas.addEventListener("click", (e) => {
  if (overLogo(e)) window.seshRadio?.toggle();
});

// ---------- loop ----------

const clock = new THREE.Clock();
const tilt = new THREE.Vector2();
let bassAvg = 0.2;
let lastFlashCss = -1;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  const audio = window.seshRadio?.levels() ?? null;
  const bass = audio ? audio.bass : 0.12 + 0.06 * Math.sin(t * 1.5);

  // lightning: random strikes, plus strikes on big bass hits while playing
  sinceStrike += dt;
  bassAvg += (bass - bassAvg) * Math.min(1, dt * 2);
  if (sinceStrike > nextStrike) {
    strike(0.7 + Math.random() * 0.3);
    nextStrike = reduceMotion ? 20 : (audio ? 3 : 4) + Math.random() * 7;
  } else if (audio && !reduceMotion && sinceStrike > 1.4 && bass > 0.6 && bass > bassAvg * 1.3) {
    strike(1);
  }
  flash *= Math.exp(-dt * 6);
  for (const b of bolts) {
    b.life *= Math.exp(-dt * 5);
    b.mat.opacity = Math.min(1, b.life);
    b.mat.color.setScalar(1 + 2 * b.life);
  }
  sky.uTime.value = t;
  sky.uFlash.value = flash;
  lightningLight.intensity = flash * 7;
  rainMat.opacity = 0.1 + flash * 0.4;
  logoLight.value = 0.8 + flash * 0.6 + bass * 0.15;

  const flashCss = Math.round(flash * 100) / 100;
  if (flashCss !== lastFlashCss) {
    root.style.setProperty("--flash", flashCss);
    lastFlashCss = flashCss;
  }

  // logo: idle sway + pointer tilt + bass pulse
  tilt.lerp(target, Math.min(1, dt * 3));
  const sway = reduceMotion ? 0 : 1;
  pivot.rotation.y = tilt.x * 0.4 + Math.sin(t * 0.45) * 0.22 * sway;
  pivot.rotation.x = tilt.y * 0.25 + Math.sin(t * 0.6) * 0.06 * sway;
  stage.position.y = baseY + Math.sin(t * 0.8) * 0.06 * sway;
  pivot.scale.setScalar(1 + bass * 0.05);
  camera.position.x += (tilt.x * 0.4 - camera.position.x) * Math.min(1, dt * 2);
  camera.lookAt(0, 0, 0);

  eyeMat.color.setScalar(0.5 + bass * 2.5);
  for (const g of eyeGlows) g.material.opacity = 0.1 + bass * 0.4;
  backGlow.material.opacity = 0.06 + bass * 0.18;

  // halo visualizer
  halo.rotation.z += dt * 0.05;
  const spec = audio?.spectrum;
  for (let i = 0; i < BARS; i++) {
    const k = i < BARS / 2 ? i : BARS - 1 - i;
    const v = spec
      ? spec[Math.floor((k / (BARS / 2)) * spec.length * 0.7)] / 255
      : 0.05 + 0.04 * Math.sin(t * 2 + i * 0.35);
    const h = 0.06 + v * 0.9;
    const a = (i / BARS) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * (HALO_R + h / 2), Math.sin(a) * (HALO_R + h / 2), 0);
    dummy.rotation.z = a - Math.PI / 2;
    dummy.scale.set(1, h, 1);
    dummy.updateMatrix();
    bars.setMatrixAt(i, dummy.matrix);
  }
  bars.instanceMatrix.needsUpdate = true;

  // rain
  for (let i = 0; i < DROPS; i++) {
    const o = i * 6;
    const dy = rainSpeed[i] * dt;
    rainPos[o + 1] -= dy;
    rainPos[o + 4] -= dy;
    rainPos[o] -= dy * 0.18;
    rainPos[o + 3] -= dy * 0.18;
    if (rainPos[o + 4] < -9) resetDrop(i, false);
  }
  rainGeo.attributes.position.needsUpdate = true;

  // ash
  for (let i = 0; i < ASH; i++) {
    const o = i * 3;
    ashPos[o + 1] += ashVel[i * 2] * dt;
    ashPos[o] += Math.sin(t * 1.3 + ashVel[i * 2 + 1]) * dt * 0.2;
    if (ashPos[o + 1] > 6) resetAsh(i, false);
  }
  ashGeo.attributes.position.needsUpdate = true;

  composer.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
