import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ThreeMFLoader } from 'three/addons/loaders/3MFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

const FILAMENT = 0x6fd3bd;

function loaderFor(ext) {
  if (ext === 'stl') return new STLLoader();
  if (ext === '3mf') return new ThreeMFLoader();
  if (ext === 'obj') return new OBJLoader();
  throw new Error(`Can't preview .${ext} files`);
}

/** Load a mesh file and return an Object3D, Z-up converted to Y-up, sitting on the plate. */
async function loadObject(url, ext, onProgress) {
  const loader = loaderFor(ext);
  const data = await new Promise((res, rej) => loader.load(url, res, (e) => onProgress?.(e.total ? e.loaded / e.total : null), rej));
  const material = new THREE.MeshStandardMaterial({ color: FILAMENT, roughness: 0.55, metalness: 0.05, flatShading: false });
  let obj;
  if (data.isBufferGeometry) {
    // Many STL exporters write zero normals; always rebuild them.
    data.deleteAttribute('normal');
    data.computeVertexNormals();
    obj = new THREE.Mesh(data, material);
  } else {
    obj = data;
    obj.traverse((c) => { if (c.isMesh) { c.material = material; if (!c.geometry.attributes.normal) c.geometry.computeVertexNormals(); } });
  }
  const wrap = new THREE.Group();
  wrap.add(obj);
  if (ext !== 'obj') obj.rotation.x = -Math.PI / 2; // printers are Z-up
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  wrap.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(wrap).getSize(new THREE.Vector3());
  let tris = 0;
  wrap.traverse((c) => { if (c.isMesh) tris += (c.geometry.index ? c.geometry.index.count : c.geometry.attributes.position.count) / 3; });
  return { object: wrap, size, tris: Math.round(tris), material };
}

function makeScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xeef3f7, 0x2a2d32, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 4); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fd8ff, 0.6); rim.position.set(-4, 2, -3); scene.add(rim);
  return scene;
}

function frame(camera, controls, size) {
  const radius = size.length() * 0.5 || 10;
  const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
  camera.near = dist / 200; camera.far = dist * 50; camera.updateProjectionMatrix();
  const target = new THREE.Vector3(0, size.y / 2, 0);
  camera.position.copy(target).add(new THREE.Vector3(0.75, 0.55, 1).normalize().multiplyScalar(dist));
  controls?.target.copy(target);
  controls?.update();
}

export class Viewer {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', '3D preview. Drag to rotate, scroll to zoom.');
    this.renderer.domElement.setAttribute('role', 'img');
    this.scene = makeScene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.alive = true;
    const loop = () => { if (!this.alive) return; this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    loop();
  }
  resize() {
    const w = this.container.clientWidth || 400, h = this.container.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  async load(url, ext, onProgress) {
    const { object, size, tris, material } = await loadObject(url, ext, onProgress);
    if (!this.alive) return null;
    if (this.object) this.scene.remove(this.object);
    if (this.grid) this.scene.remove(this.grid);
    const span = Math.max(size.x, size.z) * 1.6 || 20;
    const step = span > 300 ? 50 : span > 120 ? 20 : 10;
    const cells = Math.ceil(span / step) * step;
    this.grid = new THREE.GridHelper(cells, cells / step, 0x56606a, 0x3c434b);
    this.scene.add(this.grid);
    this.scene.add(object);
    this.object = object;
    this.material = material;
    frame(this.camera, this.controls, size);
    return { size, tris };
  }
  toggleWire() { if (this.material) this.material.wireframe = !this.material.wireframe; }
  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => { o.geometry?.dispose?.(); });
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.renderer.domElement.remove();
  }
}

let thumbRenderer;
/** Render a 512px PNG preview of a mesh (used when a model has no cover image). */
export async function renderThumb(url, ext) {
  thumbRenderer ||= new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  thumbRenderer.setSize(512, 512, false);
  thumbRenderer.setPixelRatio(1);
  thumbRenderer.outputColorSpace = THREE.SRGBColorSpace;
  thumbRenderer.setClearColor(0x30353b, 1);
  const scene = makeScene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
  const { object, size } = await loadObject(url, ext);
  scene.add(object);
  frame(camera, null, size);
  camera.lookAt(0, size.y / 2, 0);
  thumbRenderer.render(scene, camera);
  const blob = await new Promise((r) => thumbRenderer.domElement.toBlob(r, 'image/png'));
  scene.traverse((o) => o.geometry?.dispose?.());
  return blob;
}
