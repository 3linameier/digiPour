// Small WebGL2 helpers: context setup, programs, float textures and a pass runner
// that draws a full-screen triangle into one or more textures (or the screen).

export function createContext(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('This GPU cannot render to floating point textures (EXT_color_buffer_float).');
  }
  return gl;
}

const VERTEX_SHADER = `#version 300 es
out vec2 vUv;
void main() {
  // One triangle that covers the whole viewport.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const numbered = source.split('\n').map((line, i) => `${String(i + 1).padStart(3)} ${line}`).join('\n');
    throw new Error(`Shader compile error:\n${gl.getShaderInfoLog(shader)}\n${numbered}`);
  }
  return shader;
}

export function createProgram(gl, fragmentSource) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link error:\n${gl.getProgramInfoLog(program)}`);
  }
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const info = gl.getActiveUniform(program, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = {
      loc: gl.getUniformLocation(program, info.name),
      type: info.type,
    };
  }
  return { program, uniforms };
}

export function createTexture(gl, width, height, internalFormat, filter) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internalFormat, width, height);
  return tex;
}

// Two textures that take turns being read from and written to.
export function createDouble(gl, width, height, internalFormat, filter) {
  return {
    read: createTexture(gl, width, height, internalFormat, filter),
    write: createTexture(gl, width, height, internalFormat, filter),
    swap() {
      [this.read, this.write] = [this.write, this.read];
    },
  };
}

function setUniform(gl, u, value) {
  switch (u.type) {
    case gl.FLOAT: gl.uniform1f(u.loc, value); break;
    case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, value); break;
    case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, value); break;
    case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, value); break;
    case gl.INT:
    case gl.BOOL: gl.uniform1i(u.loc, value); break;
    default: throw new Error(`Unsupported uniform type ${u.type}`);
  }
}

export class PassRunner {
  constructor(gl) {
    this.gl = gl;
    this.fbo = gl.createFramebuffer();
    this.vao = gl.createVertexArray();
    this.attached = 0;
  }

  // Draws `prog` into `outputs` (array of textures, all `width`×`height`), or to the
  // canvas when outputs is null.
  run(prog, { inputs = {}, uniforms = {}, outputs = null, width, height }) {
    const gl = this.gl;
    gl.useProgram(prog.program);

    let unit = 0;
    for (const [name, tex] of Object.entries(inputs)) {
      const u = prog.uniforms[name];
      if (!u) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u.loc, unit);
      unit++;
    }
    for (const [name, value] of Object.entries(uniforms)) {
      const u = prog.uniforms[name];
      if (u) setUniform(gl, u, value);
    }

    if (outputs) {
      this.bindOutputs(outputs);
      gl.viewport(0, 0, width, height);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  bindOutputs(outputs) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    const buffers = [];
    for (let i = 0; i < Math.max(outputs.length, this.attached); i++) {
      // Detach leftovers from earlier passes so they can't form a feedback loop.
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, outputs[i] ?? null, 0);
      if (i < outputs.length) buffers.push(gl.COLOR_ATTACHMENT0 + i);
    }
    this.attached = outputs.length;
    gl.drawBuffers(buffers);
  }

  clear(textures) {
    const gl = this.gl;
    this.bindOutputs(textures);
    textures.forEach((_, i) => gl.clearBufferfv(gl.COLOR, i, [0, 0, 0, 0]));
  }
}
