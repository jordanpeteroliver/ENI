/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// tslint:disable:organize-imports
// tslint:disable:ban-malformed-import-paths
// tslint:disable:no-new-decorators

import {LitElement, css, html} from 'lit';
import {customElement, property} from 'lit/decorators.js';
import {Analyser} from './analyser';

import * as THREE from 'three';
import {EXRLoader} from 'three/addons/loaders/EXRLoader.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {ShaderPass} from 'three/addons/postprocessing/ShaderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {FXAAShader} from 'three/addons/shaders/FXAAShader.js';
import {fs as backdropFS, vs as backdropVS} from './backdrop-shader';
import {vs as sphereVS} from './sphere-shader';

/**
 * 3D live audio visual.
 */
@customElement('gdm-live-audio-visuals-3d')
export class GdmLiveAudioVisuals3D extends LitElement {
  private inputAnalyser!: Analyser;
  private outputAnalyser!: Analyser;
  private camera!: THREE.PerspectiveCamera;
  private backdrop!: THREE.Mesh;
  private composer!: EffectComposer;
  private sphere!: THREE.Mesh;
  private prevTime = 0;
  private rotation = new THREE.Vector3(0, 0, 0);

  private _outputNode!: AudioNode;

  @property()
  set outputNode(node: AudioNode) {
    this._outputNode = node;
    this.outputAnalyser = new Analyser(this._outputNode);
  }

  get outputNode() {
    return this._outputNode;
  }

  private _inputNode!: AudioNode;

  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private activePointers = new Map<number, { event: PointerEvent, history: {x: number, y: number, time: number}[] }>();
  private isTouchingOrb = false;
  private touchCount = 0;
  private touchPressure = 0;
  private excitement = 0;

  @property()
  set inputNode(node: AudioNode) {
    this._inputNode = node;
    this.inputAnalyser = new Analyser(this._inputNode);
  }

  get inputNode() {
    return this._inputNode;
  }

  private canvas!: HTMLCanvasElement;

  static styles = css`
    canvas {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      inset: 0;
      image-rendering: pixelated;
      touch-action: none;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
  }

  private init() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x100c14);

    const backdrop = new THREE.Mesh(
      new THREE.IcosahedronGeometry(10, 5),
      new THREE.RawShaderMaterial({
        uniforms: {
          resolution: {value: new THREE.Vector2(1, 1)},
          rand: {value: 0},
        },
        vertexShader: backdropVS,
        fragmentShader: backdropFS,
        glslVersion: THREE.GLSL3,
      }),
    );
    backdrop.material.side = THREE.BackSide;
    scene.add(backdrop);
    this.backdrop = backdrop;

    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    camera.position.set(2, -2, 5);
    this.camera = camera;

    const renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: !true,
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio / 1);

    const geometry = new THREE.IcosahedronGeometry(1, 10);

    new EXRLoader().load('piz_compressed.exr', (texture: THREE.Texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const exrCubeRenderTarget = pmremGenerator.fromEquirectangular(texture);
      sphereMaterial.envMap = exrCubeRenderTarget.texture;
      sphere.visible = true;
    });

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const sphereMaterial = new THREE.MeshStandardMaterial({
      color: 0x000010,
      metalness: 0.5,
      roughness: 0.1,
      emissive: 0x000010,
      emissiveIntensity: 1.5,
    });

    sphereMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.time = {value: 0};
      shader.uniforms.inputData = {value: new THREE.Vector4()};
      shader.uniforms.outputData = {value: new THREE.Vector4()};
      shader.uniforms.emotionColor = {value: new THREE.Color(0x000010)};
      
      const touchPointsArray = [];
      for(let i=0; i<10; i++) touchPointsArray.push(new THREE.Vector4(0,0,0,0));
      shader.uniforms.touchPoints = {value: touchPointsArray};
      shader.uniforms.touchCount = {value: 0};

      sphereMaterial.userData.shader = shader;

      shader.vertexShader = sphereVS;

      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform vec3 emotionColor;`
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        'vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( emotionColor, opacity );'
      );
    };

    const sphere = new THREE.Mesh(geometry, sphereMaterial);
    scene.add(sphere);
    sphere.visible = false;

    this.sphere = sphere;

    const renderPass = new RenderPass(scene, camera);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      5,
      0.5,
      0,
    );

    const fxaaPass = new ShaderPass(FXAAShader);

    const composer = new EffectComposer(renderer);
    composer.addPass(renderPass);
    // composer.addPass(fxaaPass);
    composer.addPass(bloomPass);

    this.composer = composer;

    function onWindowResize() {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      const dPR = renderer.getPixelRatio();
      const w = window.innerWidth;
      const h = window.innerHeight;
      backdrop.material.uniforms.resolution.value.set(w * dPR, h * dPR);
      renderer.setSize(w, h);
      composer.setSize(w, h);
      fxaaPass.material.uniforms['resolution'].value.set(
        1 / (w * dPR),
        1 / (h * dPR),
      );
    }

    window.addEventListener('resize', onWindowResize);
    onWindowResize();

    this.canvas.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.canvas.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.canvas.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointercancel', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerout', this.onPointerUp.bind(this));
    this.canvas.addEventListener('pointerleave', this.onPointerUp.bind(this));

    this.animation();
  }

  private onPointerDown(e: PointerEvent) {
    this.activePointers.set(e.pointerId, { event: e, history: [{ x: e.clientX, y: e.clientY, time: performance.now() }] });
    this.processTouches();
  }

  private onPointerMove(e: PointerEvent) {
    if (this.activePointers.has(e.pointerId)) {
      const data = this.activePointers.get(e.pointerId)!;
      data.event = e;
      data.history.push({ x: e.clientX, y: e.clientY, time: performance.now() });
      if (data.history.length > 10) data.history.shift();
      this.processTouches();
    }
  }

  private onPointerUp(e: PointerEvent) {
    this.activePointers.delete(e.pointerId);
    this.processTouches();
  }

  private processTouches() {
    let orbTouched = false;
    let maxPressure = 0;
    let count = this.activePointers.size;
    let maxArea = 0;

    for (const [id, data] of this.activePointers.entries()) {
      const e = data.event;
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      this.raycaster.setFromCamera(this.mouse, this.camera);
      const intersects = this.raycaster.intersectObject(this.sphere);

      if (intersects.length > 0) {
        orbTouched = true;
      }
      maxPressure = Math.max(maxPressure, e.pressure || 0.5);
      
      const width = e.width || 1;
      const height = e.height || 1;
      maxArea = Math.max(maxArea, width * height);
    }

    let touchType = 'dedo';
    if (maxArea > 150) {
      touchType = 'lábios/língua';
    } else if (maxArea > 0 && maxArea < 15) {
      touchType = 'objeto fino';
    }

    let rhythm = 'suave';
    if (this.excitement > 2.0) rhythm = 'acelerado';
    if (this.excitement > 5.0) rhythm = 'frenético';

    if (count > 0) {
      if (orbTouched && !this.isTouchingOrb && navigator.vibrate) {
        navigator.vibrate([50, 30, 50]);
      } else if (!this.isTouchingOrb && navigator.vibrate) {
        navigator.vibrate(20);
      }
    }

    this.isTouchingOrb = orbTouched;
    this.touchCount = count;
    this.touchPressure = maxPressure;

    this.dispatchEvent(new CustomEvent('orb-touch', {
      detail: { 
        isOrb: orbTouched, 
        count, 
        pressure: maxPressure,
        touchType,
        rhythm
      },
      bubbles: true,
      composed: true
    }));
  }

  private animation() {
    requestAnimationFrame(() => this.animation());

    this.inputAnalyser.update();
    this.outputAnalyser.update();

    const t = performance.now();
    const dt = (t - this.prevTime) / (1000 / 60);
    this.prevTime = t;
    const backdropMaterial = this.backdrop.material as THREE.RawShaderMaterial;
    const sphereMaterial = this.sphere.material as THREE.MeshStandardMaterial;

    backdropMaterial.uniforms.rand.value = Math.random() * 10000;

    if (sphereMaterial.userData.shader) {
      this.sphere.scale.setScalar(
        1 + (0.2 * this.outputAnalyser.data[1]) / 255,
      );

      const f = 0.001;
      this.rotation.x += (dt * f * 0.5 * this.outputAnalyser.data[1]) / 255;
      this.rotation.z += (dt * f * 0.5 * this.inputAnalyser.data[1]) / 255;
      this.rotation.y += (dt * f * 0.25 * this.inputAnalyser.data[2]) / 255;
      this.rotation.y += (dt * f * 0.25 * this.outputAnalyser.data[2]) / 255;

      const euler = new THREE.Euler(
        this.rotation.x,
        this.rotation.y,
        this.rotation.z,
      );
      const quaternion = new THREE.Quaternion().setFromEuler(euler);
      const vector = new THREE.Vector3(0, 0, 5);
      vector.applyQuaternion(quaternion);
      this.camera.position.copy(vector);
      this.camera.lookAt(this.sphere.position);

      sphereMaterial.userData.shader.uniforms.time.value +=
        (dt * 0.1 * this.outputAnalyser.data[0]) / 255;
      sphereMaterial.userData.shader.uniforms.inputData.value.set(
        (1 * this.inputAnalyser.data[0]) / 255,
        (0.1 * this.inputAnalyser.data[1]) / 255,
        (10 * this.inputAnalyser.data[2]) / 255,
        0,
      );
      sphereMaterial.userData.shader.uniforms.outputData.value.set(
        (2 * this.outputAnalyser.data[0]) / 255,
        (0.1 * this.outputAnalyser.data[1]) / 255,
        (10 * this.outputAnalyser.data[2]) / 255,
        0,
      );

      // Update touch points for shader
      let shaderTouchCount = 0;
      const touchPointsUniform = sphereMaterial.userData.shader.uniforms.touchPoints.value;
      
      for (const [id, data] of this.activePointers.entries()) {
        if (shaderTouchCount >= 10) break;
        const e = data.event;
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObject(this.sphere);
        
        if (intersects.length > 0) {
          const localPoint = this.sphere.worldToLocal(intersects[0].point.clone());
          touchPointsUniform[shaderTouchCount].set(localPoint.x, localPoint.y, localPoint.z, e.pressure || 0.5);
          shaderTouchCount++;
        }
      }
      sphereMaterial.userData.shader.uniforms.touchCount.value = shaderTouchCount;

      this.excitement = Math.min(10, this.excitement + (this.isTouchingOrb ? 0.05 : -0.02));
      this.excitement = Math.max(0, this.excitement);

      // Emotion color logic
      const agitation = this.outputAnalyser.data[0] / 255;
      
      // Interpolate between deep blue (calm) and bright red (agitated)
      const calmColor = new THREE.Color(0x000010);
      const agitatedColor = new THREE.Color(0xff2200);
      const currentColor = calmColor.clone().lerp(agitatedColor, agitation * 1.5);
      
      let emissiveInt = 1.5 + (agitation * 5.0);

      if (this.touchCount > 0) {
        const touchColor = new THREE.Color(0xffff00).lerp(new THREE.Color(0xffffff), this.touchPressure);
        currentColor.lerp(touchColor, 0.4 + (this.touchPressure * 0.4));
        emissiveInt += 1.0 + (this.touchPressure * 3.0);
        
        const scaleMultiplier = 1.0 + (this.touchPressure * 0.05) + (this.excitement * 0.02);
        this.sphere.scale.multiplyScalar(scaleMultiplier);
      }

      if (this.excitement > 0) {
         const pulse = Math.sin(performance.now() * 0.005 * (1 + this.excitement * 0.1)) * 0.05 * this.excitement;
         this.sphere.scale.addScalar(pulse);
      }

      sphereMaterial.userData.shader.uniforms.emotionColor.value.copy(currentColor);
      sphereMaterial.emissive.copy(currentColor);
      sphereMaterial.emissiveIntensity = emissiveInt;
    }

    this.composer.render();
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot!.querySelector('canvas') as HTMLCanvasElement;
    this.init();
  }

  protected render() {
    return html`<canvas></canvas>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-live-audio-visuals-3d': GdmLiveAudioVisuals3D;
  }
}
