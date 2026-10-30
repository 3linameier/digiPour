import { createProgram, createDouble, createTexture, PassRunner } from './gl.js';
import * as SHADERS from './shaders.js';

const TOOL_MODES = { pour: 0, swipe: 1, blow: 2, base: 3 };

// Thin-layer paint simulation on the GPU. See shaders.js for what each texture holds.
export class PourSim {
  constructor(gl, width, height) {
    this.gl = gl;
    this.width = width;
    this.height = height;
    this.runner = new PassRunner(gl);
    this.programs = {
      velocity: createProgram(gl, SHADERS.VELOCITY),
      flux: createProgram(gl, SHADERS.FLUX),
      advect: createProgram(gl, SHADERS.ADVECT),
      correct: createProgram(gl, SHADERS.CORRECT),
      tool: createProgram(gl, SHADERS.TOOL),
      render: createProgram(gl, SHADERS.RENDER),
    };
    this.state = createDouble(gl, width, height, gl.RGBA32F, gl.NEAREST);
    this.pigA = createDouble(gl, width, height, gl.RGBA16F, gl.LINEAR);
    this.pigB = createDouble(gl, width, height, gl.RGBA16F, gl.LINEAR);
    this.hatA = createTexture(gl, width, height, gl.RGBA16F, gl.LINEAR);
    this.hatB = createTexture(gl, width, height, gl.RGBA16F, gl.LINEAR);
    this.reset();
  }

  get res() {
    return [this.width, this.height];
  }

  reset() {
    const { state, pigA, pigB } = this;
    this.runner.clear([state.read, state.write, pigA.read, pigA.write]);
    this.runner.clear([pigB.read, pigB.write, this.hatA, this.hatB]);
  }

  pass(name, inputs, outputs, uniforms = {}) {
    this.runner.run(this.programs[name], {
      inputs,
      outputs,
      uniforms: { uRes: this.res, ...uniforms },
      width: this.width,
      height: this.height,
    });
  }

  // tool: { mode, pos, prev, radius, amount, paint: [vec4, vec4], reveal: [vec4, vec4], dots }
  applyTool(tool) {
    const { state, pigA, pigB } = this;
    this.pass(
      'tool',
      { uState: state.read, uPigA: pigA.read, uPigB: pigB.read },
      [state.write, pigA.write, pigB.write],
      {
        uMode: TOOL_MODES[tool.mode],
        uPos: tool.pos ?? [0, 0],
        uPrev: tool.prev ?? tool.pos ?? [0, 0],
        uRadius: tool.radius ?? 1,
        uAmount: tool.amount,
        uDots: tool.dots ?? 0,
        uSeed: Math.random() * 1000,
        uPaintA: tool.paint?.[0] ?? [0, 0, 0, 0],
        uPaintB: tool.paint?.[1] ?? [0, 0, 0, 0],
        uRevealA: tool.reveal?.[0] ?? [0, 0, 0, 0],
        uRevealB: tool.reveal?.[1] ?? [0, 0, 0, 0],
      },
    );
    state.swap();
    pigA.swap();
    pigB.swap();
  }

  // params: { gravity: [x, y], pressure, visc, cellForce, silDiff, silDecay, sharpen }
  step(params) {
    const { state, pigA, pigB } = this;
    this.pass('velocity', { uState: state.read }, [state.write], {
      uGravity: params.gravity,
      uPressure: params.pressure,
      uVisc: params.visc,
      uCellForce: params.cellForce,
      uSilDiff: params.silDiff,
      uSilDecay: params.silDecay,
    });
    state.swap();
    this.pass('flux', { uState: state.read }, [state.write]);
    state.swap();
    this.pass('advect', { uState: state.read, uPigA: pigA.read, uPigB: pigB.read }, [this.hatA, this.hatB]);
    this.pass(
      'correct',
      { uState: state.read, uPigA: pigA.read, uPigB: pigB.read, uHatA: this.hatA, uHatB: this.hatB },
      [pigA.write, pigB.write],
      { uSharpen: params.sharpen },
    );
    pigA.swap();
    pigB.swap();
  }

  // view: { colors: Float32Array(24), metalA, metalB, ground: [r, g, b], tilt: [x, y], time }
  render(view) {
    this.runner.run(this.programs.render, {
      inputs: { uState: this.state.read, uPigA: this.pigA.read, uPigB: this.pigB.read },
      uniforms: {
        uRes: this.res,
        uColors: view.colors,
        uMetalA: view.metalA,
        uMetalB: view.metalB,
        uGround: view.ground,
        uTilt: view.tilt,
        uTime: view.time,
      },
    });
  }
}
