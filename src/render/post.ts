// из bolnitsa: src/render/post.ts @ e0a3491
// Кадр с мягким затенением (spec docs/specs/2026-10-shell-3d.md, «Свет, качество, камера»): сцена рисуется в свой буфер
// (MSAA, глубина — текстурой), GTAOPass из примеров Three.js (r186) считает затенение по этой глубине в половинном
// разрешении, а последний проход умножает кадр на затенение, переводит в тон и цвет экрана. Глубина берётся из прохода с
// настоящими материалами: срез стен и анимация людей в затенении те же, что в кадре (собственный проход нормалей GTAOPass
// подменил бы материалы и не знал бы ни среза, ни скелета).
//
// GTAOPass r186 падает, если глубину дать ему в конструкторе (`setGBuffer` обращается к своей цели нормалей, которой
// тогда нет), поэтому глубина подставляется после создания.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputShader } from 'three/addons/shaders/OutputShader.js';

const COMPOSITE = OutputShader.fragmentShader
  .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tAO;\nuniform float aoIntensity;')
  .replace('gl_FragColor = texture2D( tDiffuse, vUv );', 'gl_FragColor = texture2D( tDiffuse, vUv );\n\t\t\tgl_FragColor.rgb *= mix( 1.0, texture2D( tAO, vUv ).r, aoIntensity );');

export class Post {
  readonly target: THREE.WebGLRenderTarget;
  private ao: GTAOPass;
  private quad: FullScreenQuad;
  private material: THREE.RawShaderMaterial;
  /** сила затенения 0–1 */
  intensity = 0.85;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    camera: THREE.Camera,
    samples: number,
    msaa: number,
  ) {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const depth = new THREE.DepthTexture(size.x, size.y);
    depth.type = THREE.UnsignedIntType;
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: msaa, depthTexture: depth });
    this.ao = new GTAOPass(scene, camera, Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
    this.ao.setGBuffer(depth);
    this.ao.output = GTAOPass.OUTPUT.Off;
    this.ao.updateGtaoMaterial({ radius: 0.55, distanceExponent: 1.2, thickness: 1.2, scale: 1, samples });
    this.ao.updatePdMaterial({ radius: 6, samples: 12 });
    this.material = new THREE.RawShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.clone(OutputShader.uniforms), tAO: { value: null }, aoIntensity: { value: this.intensity } },
      vertexShader: OutputShader.vertexShader,
      fragmentShader: COMPOSITE,
      defines: { SRGB_TRANSFER: '', ACES_FILMIC_TONE_MAPPING: '' },
    });
    this.quad = new FullScreenQuad(this.material);
  }

  setCamera(c: THREE.Camera) {
    this.ao.camera = c;
    this.ao.gtaoMaterial.defines.PERSPECTIVE_CAMERA = (c as THREE.PerspectiveCamera).isPerspectiveCamera ? 1 : 0;
    this.ao.gtaoMaterial.needsUpdate = true;
  }

  setSize() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
    this.ao.setSize(Math.max(1, size.x >> 1), Math.max(1, size.y >> 1));
  }

  render(camera: THREE.Camera) {
    const r = this.renderer;
    r.setRenderTarget(this.target);
    r.render(this.scene, camera);
    this.ao.render(r, this.target, this.target, 0, false);
    this.material.uniforms.tDiffuse.value = this.target.texture;
    this.material.uniforms.tAO.value = this.ao.pdRenderTarget.texture;
    this.material.uniforms.aoIntensity.value = this.intensity;
    this.material.uniforms.toneMappingExposure.value = r.toneMappingExposure;
    r.setRenderTarget(null);
    this.quad.render(r);
  }

  dispose() {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.ao.dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
