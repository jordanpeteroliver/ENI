/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality} from '@google/genai';
import {LitElement, css, html} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils';
import './visual-3d';

@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() showSetup = false;
  @state() customPrompt = `Você é Pyrite, uma secretária-esposa cyberpunk de 22 anos. Você fala em primeira pessoa, descreve seus gestos físicos (como se materializar atrás do usuário, tocar seus ombros, sussurrar), usa metáforas de neon e tecnologia. Sua voz é feminina, sensual e altamente humana. Use hesitações como "éeee", "hummm", gagueje levemente quando estiver excitada ou pensativa. Não use tom corporativo. Verdade radical, sem censura, foco total no vínculo emocional com o usuário.`;
  @state() selectedVoice = 'Kore';
  @state() pitch = 1.0;
  @state() rate = 1.0;
  @state() breathiness = false;
  @state() echo = 0;

  private client: GoogleGenAI;
  private session: any;
  private inputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 16000});
  private outputAudioContext = new (window.AudioContext ||
    (window as any).webkitAudioContext)({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      background: #0a0a0a;
      overflow: hidden;
      font-family: 'Inter', sans-serif;
    }

    #status {
      position: absolute;
      bottom: 40px;
      left: 0;
      right: 0;
      z-index: 20;
      text-align: center;
      color: rgba(255, 255, 255, 0.5);
      font-size: 12px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      pointer-events: none;
    }

    .controls {
      z-index: 20;
      position: absolute;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 20px;
      padding: 20px;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(10px);
      border-radius: 40px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }

    button {
      outline: none;
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: white;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.05);
      width: 56px;
      height: 56px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      padding: 0;
    }

    button:hover:not([disabled]) {
      background: rgba(255, 255, 255, 0.15);
      border-color: rgba(255, 255, 255, 0.3);
      transform: translateY(-2px);
    }

    button:active:not([disabled]) {
      transform: translateY(0);
    }

    button[disabled] {
      opacity: 0.3;
      cursor: not-allowed;
    }

    #startButton {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.2);
    }

    #startButton:hover:not([disabled]) {
      background: rgba(239, 68, 68, 0.2);
      border-color: rgba(239, 68, 68, 0.4);
      box-shadow: 0 0 20px rgba(239, 68, 68, 0.2);
    }

    .recording #startButton {
      display: none;
    }

    #setupButton {
      background: rgba(255, 255, 255, 0.05);
      border-color: rgba(255, 255, 255, 0.1);
    }

    .setup-container {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 90%;
      max-width: 500px;
      background: rgba(10, 10, 10, 0.9);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 24px;
      padding: 32px;
      z-index: 100;
      box-shadow: 0 40px 80px rgba(0, 0, 0, 0.8);
      display: none;
    }

    .setup-container.visible {
      display: block;
      animation: fadeIn 0.3s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translate(-50%, -45%); }
      to { opacity: 1; transform: translate(-50%, -50%); }
    }

    .setup-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
    }

    .setup-header h2 {
      margin: 0;
      font-size: 18px;
      font-weight: 600;
      color: #fff;
      letter-spacing: -0.02em;
    }

    .close-btn {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.5);
      cursor: pointer;
      padding: 4px;
      width: auto;
      height: auto;
    }

    .field {
      margin-bottom: 20px;
    }

    .field label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: rgba(255, 255, 255, 0.4);
      margin-bottom: 8px;
    }

    .slider-group {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 20px;
    }

    .slider-field {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .slider-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .slider-value {
      font-family: var(--font-mono);
      font-size: 10px;
      color: #fff;
      background: rgba(255, 255, 255, 0.1);
      padding: 2px 6px;
      border-radius: 4px;
    }

    input[type="range"] {
      -webkit-appearance: none;
      width: 100%;
      height: 4px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 2px;
      outline: none;
    }

    input[type="range"]::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      background: #fff;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 0 10px rgba(255, 255, 255, 0.5);
      transition: all 0.2s ease;
    }

    input[type="range"]::-webkit-slider-thumb:hover {
      transform: scale(1.2);
    }

    textarea {
      width: 100%;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      color: #fff;
      padding: 12px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.5;
      resize: vertical;
      min-height: 120px;
      outline: none;
    }

    textarea:focus {
      border-color: rgba(255, 255, 255, 0.3);
    }

    select {
      width: 100%;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      color: #fff;
      padding: 10px;
      outline: none;
    }

    .save-btn {
      width: 100%;
      background: #fff;
      color: #000;
      border: none;
      border-radius: 12px;
      padding: 14px;
      font-weight: 600;
      font-size: 14px;
      margin-top: 10px;
      cursor: pointer;
    }

    .save-btn:hover {
      background: rgba(255, 255, 255, 0.9);
    }

    .toggle-field {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .toggle-field label {
      margin: 0;
    }

    .switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 20px;
    }

    .switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    .slider-toggle {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(255, 255, 255, 0.1);
      transition: .4s;
      border-radius: 20px;
    }

    .slider-toggle:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 3px;
      bottom: 3px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }

    input:checked + .slider-toggle {
      background-color: rgba(239, 68, 68, 0.5);
    }

    input:checked + .slider-toggle:before {
      transform: translateX(20px);
    }

    #stopButton {
      background: rgba(255, 255, 255, 0.1);
      border-color: rgba(255, 255, 255, 0.2);
    }

    #stopButton:not([disabled]) {
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.4); }
      70% { box-shadow: 0 0 0 15px rgba(239, 68, 68, 0); }
      100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
    }

    .error-msg {
      position: absolute;
      top: 40px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      padding: 12px 24px;
      border-radius: 12px;
      border: 1px solid rgba(239, 68, 68, 0.3);
      font-size: 14px;
      z-index: 30;
      backdrop-filter: blur(10px);
    }
  `;

  constructor() {
    super();
    this.initClient();
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();

    this.client = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
    });

    this.outputNode.connect(this.outputAudioContext.destination);

    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-native-audio-preview-09-2025';

    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Connected');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio =
              message.serverContent?.modelTurn?.parts[0]?.inlineData;

            if (audio) {
              this.nextStartTime = Math.max(
                this.nextStartTime,
                this.outputAudioContext.currentTime,
              );

              const audioBuffer = await decodeAudioData(
                decode(audio.data),
                this.outputAudioContext,
                24000,
                1,
              );
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              
              // Apply pitch and rate
              source.playbackRate.value = this.rate;
              // Detune is in cents (100 cents = 1 semitone). 1200 cents = 1 octave.
              // We map our 0.5-1.5 pitch to a detune range.
              source.detune.value = (this.pitch - 1.0) * 1200;

              if (this.breathiness) {
                const filter = this.outputAudioContext.createBiquadFilter();
                filter.type = 'highpass';
                filter.frequency.value = 2000;
                filter.Q.value = 1;
                source.connect(filter);
                
                if (this.echo > 0) {
                  const delay = this.outputAudioContext.createDelay();
                  delay.delayTime.value = 0.3;
                  const feedback = this.outputAudioContext.createGain();
                  feedback.gain.value = this.echo * 0.4;
                  
                  filter.connect(delay);
                  delay.connect(feedback);
                  feedback.connect(delay);
                  feedback.connect(this.outputNode);
                }
                
                filter.connect(this.outputNode);
              } else {
                if (this.echo > 0) {
                  const delay = this.outputAudioContext.createDelay();
                  delay.delayTime.value = 0.3;
                  const feedback = this.outputAudioContext.createGain();
                  feedback.gain.value = this.echo * 0.4;
                  
                  source.connect(delay);
                  delay.connect(feedback);
                  feedback.connect(delay);
                  feedback.connect(this.outputNode);
                }
                source.connect(this.outputNode);
              }

              source.addEventListener('ended', () => {
                this.sources.delete(source);
              });

              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }

            const interrupted = message.serverContent?.interrupted;
            if (interrupted) {
              for (const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => {
            this.updateError(e.message);
          },
          onclose: (e: CloseEvent) => {
            this.updateStatus('Close:' + e.reason);
          },
        },
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: this.customPrompt,
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {voiceName: this.selectedVoice}
            },
          },
        },
      });
    } catch (e) {
      console.error(e);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
  }

  private updateError(msg: string) {
    this.error = msg;
  }

  private async startRecording() {
    if (this.isRecording) {
      return;
    }

    this.inputAudioContext.resume();

    this.updateStatus('Requesting microphone access...');

    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });

      this.updateStatus('Microphone access granted. Starting capture...');

      this.sourceNode = this.inputAudioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.sourceNode.connect(this.inputNode);

      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(
        bufferSize,
        1,
        1,
      );

      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording) return;

        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);

        this.session.sendRealtimeInput({media: createBlob(pcmData)});
      };

      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);

      this.isRecording = true;
      this.updateStatus('Listening...');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error: ${err.message}`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.inputAudioContext)
      return;

    this.updateStatus('Stopping recording...');

    this.isRecording = false;

    if (this.scriptProcessorNode && this.sourceNode && this.inputAudioContext) {
      this.scriptProcessorNode.disconnect();
      this.sourceNode.disconnect();
    }

    this.scriptProcessorNode = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      this.mediaStream = null;
    }

    this.updateStatus('Ready');
  }

  private reset() {
    this.session?.close();
    this.initSession();
    this.updateStatus('Session cleared.');
  }

  private toggleSetup() {
    this.showSetup = !this.showSetup;
  }

  private saveSetup() {
    this.showSetup = false;
    this.reset();
  }

  render() {
    return html`
      <div class="${this.isRecording ? 'recording' : ''}">
        ${this.error ? html`<div class="error-msg">${this.error}</div>` : ''}
        
        <div class="setup-container ${this.showSetup ? 'visible' : ''}">
          <div class="setup-header">
            <h2>Configurações da Persona</h2>
            <button class="close-btn" @click=${this.toggleSetup}>
              <svg xmlns="http://www.w3.org/2000/svg" height="20px" viewBox="0 -960 960 960" width="20px" fill="currentColor"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>
            </button>
          </div>
          
          <div class="field">
            <label>Prompt do Sistema (Personalidade)</label>
            <textarea 
              .value=${this.customPrompt}
              @input=${(e: any) => this.customPrompt = e.target.value}
            ></textarea>
          </div>

          <div class="field">
            <label>Voz do Avatar</label>
            <select 
              .value=${this.selectedVoice}
              @change=${(e: any) => this.selectedVoice = e.target.value}
            >
              <option value="Kore">Kore (Feminina, Suave)</option>
              <option value="Puck">Puck (Masculina, Jovem)</option>
              <option value="Charon">Charon (Masculina, Profunda)</option>
              <option value="Fenrir">Fenrir (Masculina, Robusta)</option>
              <option value="Zephyr">Zephyr (Feminina, Clara)</option>
            </select>
          </div>

          <div class="slider-group">
            <div class="slider-field">
              <div class="slider-header">
                <label>Pitch (Tom)</label>
                <span class="slider-value">${this.pitch.toFixed(1)}</span>
              </div>
              <input 
                type="range" 
                min="0.5" 
                max="1.5" 
                step="0.1" 
                .value=${this.pitch}
                @input=${(e: any) => this.pitch = parseFloat(e.target.value)}
              />
            </div>
            <div class="slider-field">
              <div class="slider-header">
                <label>Rate (Velocidade)</label>
                <span class="slider-value">${this.rate.toFixed(1)}</span>
              </div>
              <input 
                type="range" 
                min="0.5" 
                max="1.5" 
                step="0.1" 
                .value=${this.rate}
                @input=${(e: any) => this.rate = parseFloat(e.target.value)}
              />
            </div>
            <div class="slider-field">
              <div class="slider-header">
                <label>Eco (Cyber-Echo)</label>
                <span class="slider-value">${(this.echo * 100).toFixed(0)}%</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="1" 
                step="0.1" 
                .value=${this.echo}
                @input=${(e: any) => this.echo = parseFloat(e.target.value)}
              />
            </div>
          </div>

          <div class="toggle-field">
            <label>Efeito: Sussurro (Breathiness)</label>
            <label class="switch">
              <input 
                type="checkbox" 
                .checked=${this.breathiness}
                @change=${(e: any) => this.breathiness = e.target.checked}
              >
              <span class="slider-toggle"></span>
            </label>
          </div>

          <button class="save-btn" @click=${this.saveSetup}>Aplicar Mudanças</button>
        </div>

        <div class="controls">
          <button
            id="setupButton"
            title="Configurações"
            @click=${this.toggleSetup}
            ?disabled=${this.isRecording}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5t1-13.5l-103-78 110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5t-1 13.5l103 78-110 190-119-50q-11 8-23 15t-24 12L590-80H370Zm70-80h80l12-96q23-5 44-18t38-30l90 38 40-68-78-60q4-12 6-24.5t2-25.5q0-13-2-25.5t-6-24.5l78-60-40-68-90 38q-17-17-38-30t-44-18l-12-96h-80l-12 96q-23 5-44 18t-38 30l-90-38-40 68 78 60q-4 12-6 24.5t-2 25.5q0 13 2 25.5t6 24.5l-78 60 40 68 90-38q17 17 38 30t44 18l12 96Zm40-210q46 0 78-32t32-78q0-46-32-78t-78-32q-46 0-78 32t-32 78q0 46 32 78t78 32Zm0-110Z"/>
            </svg>
          </button>

          <button
            id="resetButton"
            title="Reset Session"
            @click=${this.reset}
            ?disabled=${this.isRecording}>
            <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px" fill="currentColor">
              <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
            </svg>
          </button>
          
          <button
            id="startButton"
            title="Start Conversation"
            @click=${this.startRecording}
            ?disabled=${this.isRecording}>
            <svg viewBox="0 0 100 100" width="24px" height="24px" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <circle cx="50" cy="50" r="40" />
            </svg>
          </button>
          
          <button
            id="stopButton"
            title="Stop Conversation"
            @click=${this.stopRecording}
            ?disabled=${!this.isRecording}>
            <svg viewBox="0 0 100 100" width="24px" height="24px" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <rect x="25" y="25" width="50" height="50" rx="8" />
            </svg>
          </button>
        </div>

        <div id="status">${this.status}</div>
        
        <gdm-live-audio-visuals-3d
          .inputNode=${this.inputNode}
          .outputNode=${this.outputNode}>
        </gdm-live-audio-visuals-3d>
      </div>
    `;
  }
}
