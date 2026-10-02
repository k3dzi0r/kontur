import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshData } from '../types';

/** Podgląd Three.js w układzie Z-w-górę (jak w slicerze), jednostki = mm. */
export class Viewer3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private mesh: THREE.Mesh | null = null;
  private ro: ResizeObserver;
  private frame = 0;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(200, -320, 220);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.target.set(0, 0, 60);

    this.scene.background = new THREE.Color(0x15181d);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(150, -250, 400);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb8ff, 0.6);
    rim.position.set(-200, 300, 150);
    this.scene.add(rim);

    // stół 256×256 mm (Bambu Lab A1), siatka co 10 mm
    const grid = new THREE.GridHelper(256, 25.6, 0x4a515c, 0x2b3038);
    grid.rotation.x = Math.PI / 2;
    this.scene.add(grid);
    const bed = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(256, 256)),
      new THREE.LineBasicMaterial({ color: 0x6b7480 }),
    );
    this.scene.add(bed);
    this.scene.add(new THREE.AxesHelper(20));

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    const loop = () => {
      this.frame = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setMesh(data: MeshData | null) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    if (!data) return;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    geom.setIndex(new THREE.BufferAttribute(data.indices, 1));
    geom.computeBoundingBox();
    geom.computeBoundingSphere();
    const mat = new THREE.MeshStandardMaterial({ color: 0xe8e3d9, roughness: 0.65, metalness: 0.0, flatShading: true });
    this.mesh = new THREE.Mesh(geom, mat);
    this.scene.add(this.mesh);
    this.fit();
  }

  /** Kamera dopasowana do modelu. */
  fit() {
    if (!this.mesh) return;
    const box = this.mesh.geometry.boundingBox!;
    const center = box.getCenter(new THREE.Vector3());
    const radius = this.mesh.geometry.boundingSphere!.radius;
    const dist = radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.1;
    const dir = new THREE.Vector3(0.55, -1, 0.45).normalize();
    this.camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    this.camera.near = Math.max(0.1, dist / 100);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.ro.disconnect();
    this.setMesh(null);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
