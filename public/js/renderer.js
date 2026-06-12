// WebGL2 renderer: one shader for chunks, entities, sky objects and overlays.
'use strict';

const VSHADER = `#version 300 es
layout(location=0) in vec3 aPos;
layout(location=1) in vec2 aUV;
layout(location=2) in float aLight;
uniform mat4 uProj, uView, uModel;
uniform float uPointSize;
uniform float uUVWorld;     // >0.5: derive UV from world XZ (clouds)
uniform vec2 uUVOffset;
out vec2 vUV;
out float vLight;
out vec3 vWorldPos;
void main() {
  vec4 wp = uModel * vec4(aPos, 1.0);
  vWorldPos = wp.xyz;
  vUV = uUVWorld > 0.5 ? wp.xz * 0.002 + uUVOffset : aUV;
  vLight = aLight;
  gl_Position = uProj * uView * wp;
  gl_PointSize = uPointSize;
}`;

const FSHADER = `#version 300 es
precision mediump float;
in vec2 vUV;
in float vLight;
in vec3 vWorldPos;
uniform sampler2D uTex;
uniform float uDayLight;
uniform vec3 uFogColor;
uniform vec2 uFogRange;
uniform vec3 uCamPos;
uniform float uAlphaTest;
uniform float uAlphaMul;
uniform float uColorMode;   // >0.5: flat uColor instead of texture
uniform vec4 uColor;
uniform vec4 uTint;         // rgb multiplier + alpha multiplier (hurt flash etc)
uniform float uNoFog;
out vec4 outColor;
void main() {
  vec4 c = uColorMode > 0.5 ? uColor : texture(uTex, vUV);
  if (uAlphaTest > 0.5 && c.a < 0.5) discard;
  c.rgb *= vLight * uDayLight;
  c.rgb = mix(c.rgb, vec3(1.0, 0.2, 0.2), uTint.r);  // hurt flash
  c.rgb = mix(c.rgb, vec3(1.0), uTint.g);            // creeper flash
  c.a *= uTint.a;
  c.a *= uAlphaMul;
  float fog = 0.0;
  if (uNoFog < 0.5) {
    float d = distance(vWorldPos, uCamPos);
    fog = clamp((d - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
  }
  outColor = vec4(mix(c.rgb, uFogColor, fog), c.a);
}`;

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
    if (!gl) throw new Error('WebGL2 is not supported by this browser');
    this.gl = gl;

    this.prog = this._buildProgram(VSHADER, FSHADER);
    gl.useProgram(this.prog);
    this.u = {};
    for (const name of ['uProj','uView','uModel','uTex','uDayLight','uFogColor','uFogRange',
      'uCamPos','uAlphaTest','uAlphaMul','uColorMode','uColor','uTint','uNoFog','uPointSize','uUVWorld','uUVOffset']) {
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }
    gl.uniform1i(this.u.uTex, 0);

    this.atlasTex = this.textureFromCanvas(buildAtlas(), true, true);
    this.cloudTex = this._buildCloudTexture();

    this.chunkMeshes = new Map(); // key -> {cx,cz,solid:{vao,vbo,count}|null,water:...}
    this.IDENT = M4.ident();

    // static geometry
    this.quad = this.makeMesh(new Float32Array([
      -0.5,-0.5,0, 0,1, 1,  0.5,-0.5,0, 1,1, 1,  0.5,0.5,0, 1,0, 1,
      -0.5,-0.5,0, 0,1, 1,  0.5,0.5,0, 1,0, 1,  -0.5,0.5,0, 0,0, 1,
    ]));
    this.wireCube = this.makeMesh(this._wireCubeVerts(), 'LINES');
    this.crackMesh = this.makeMesh(makeCubeVerts(1.002, 1.002, 1.002, () => tileUV(TILE.CRACK_0), 1), 'TRIANGLES', true);
    this.stars = this.makeMesh(this._starVerts(), 'POINTS');
    this._defaults();
  }

  _defaults() {
    const gl = this.gl;
    gl.uniform1f(this.u.uAlphaTest, 0);
    gl.uniform1f(this.u.uAlphaMul, 1);
    gl.uniform4f(this.u.uTint, 0, 0, 0, 1);
    gl.uniform1f(this.u.uColorMode, 0);
    gl.uniform1f(this.u.uNoFog, 0);
    gl.uniform1f(this.u.uUVWorld, 0);
    gl.uniform1f(this.u.uPointSize, 2);
    gl.uniform1f(this.u.uDayLight, 1);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE); // neighbor-culled meshes; skip winding pitfalls
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }

  _buildProgram(vsSrc, fsSrc) {
    const gl = this.gl;
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error('Shader error: ' + gl.getShaderInfoLog(sh));
      }
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vsSrc));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fsSrc));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error('Program link error: ' + gl.getProgramInfoLog(prog));
    }
    return prog;
  }

  textureFromCanvas(cv, nearest, mipmap) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    if (mipmap) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 2);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, nearest ? gl.NEAREST : gl.LINEAR);
    }
    return tex;
  }

  _buildCloudTexture() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 256, 256);
    const n = Noise.makeNoise2D('clouds');
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++)
        if (Noise.fbm2(n, x / 14, y / 14, 3, 2, 0.5) > 0.18) ctx.fillRect(x * 4, y * 4, 4, 4);
    const gl = this.gl;
    const tex = this.textureFromCanvas(cv, true, false);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    return tex;
  }

  _wireCubeVerts() {
    const e = -0.004, f = 1.004; // slightly inflated unit cube
    const p = [
      [e,e,e],[f,e,e],[f,e,e],[f,e,f],[f,e,f],[e,e,f],[e,e,f],[e,e,e], // bottom
      [e,f,e],[f,f,e],[f,f,e],[f,f,f],[f,f,f],[e,f,f],[e,f,f],[e,f,e], // top
      [e,e,e],[e,f,e],[f,e,e],[f,f,e],[f,e,f],[f,f,f],[e,e,f],[e,f,f], // pillars
    ];
    const out = [];
    for (const v of p) out.push(v[0], v[1], v[2], 0, 0, 1);
    return new Float32Array(out);
  }

  _starVerts() {
    const rng = Noise.mulberry32(424242);
    const out = [];
    for (let i = 0; i < 420; i++) {
      const t = rng() * Math.PI * 2, u = rng() * 2 - 1;
      const r = Math.sqrt(1 - u * u);
      out.push(Math.cos(t) * r, u, Math.sin(t) * r, 0, 0, 0.6 + rng() * 0.4);
    }
    return new Float32Array(out);
  }

  makeMesh(data, mode = 'TRIANGLES', dynamic = false) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 24, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 24, 20);
    gl.bindVertexArray(null);
    return { vao, vbo, count: data.length / 6, mode: this.gl[mode] };
  }

  updateMesh(mesh, data) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    mesh.count = data.length / 6;
  }

  deleteMesh(mesh) {
    if (!mesh) return;
    this.gl.deleteVertexArray(mesh.vao);
    this.gl.deleteBuffer(mesh.vbo);
  }

  uploadChunk(key, cx, cz, meshData) {
    const old = this.chunkMeshes.get(key);
    if (old) { this.deleteMesh(old.solid); this.deleteMesh(old.water); }
    const entry = { cx, cz, solid: null, water: null };
    if (meshData.solidVerts > 0) entry.solid = this.makeMesh(meshData.solid);
    if (meshData.waterVerts > 0) entry.water = this.makeMesh(meshData.water);
    this.chunkMeshes.set(key, entry);
  }

  dropChunk(key) {
    const old = this.chunkMeshes.get(key);
    if (old) { this.deleteMesh(old.solid); this.deleteMesh(old.water); }
    this.chunkMeshes.delete(key);
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.floor(this.canvas.clientWidth * dpr);
    const h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // env: {skyColor:[r,g,b], fogColor, fogNear, fogFar, dayLight}
  beginFrame(cam, fovDeg, env) {
    const gl = this.gl;
    this.resize();
    this.cam = cam;
    this.env = env;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(env.skyColor[0], env.skyColor[1], env.skyColor[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.proj = M4.perspective(fovDeg, this.canvas.width / Math.max(1, this.canvas.height), 0.08, 1200);
    this.view = M4.fpsView(cam.pos, cam.yaw, cam.pitch);
    if (cam.roll) this.view = M4.mul(M4.rotZ(cam.roll), this.view);
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(this.u.uProj, false, this.proj);
    gl.uniformMatrix4fv(this.u.uView, false, this.view);
    gl.uniformMatrix4fv(this.u.uModel, false, this.IDENT);
    gl.uniform3fv(this.u.uCamPos, cam.pos);
    gl.uniform3fv(this.u.uFogColor, env.fogColor);
    gl.uniform2f(this.u.uFogRange, env.fogNear, env.fogFar);
    gl.uniform1f(this.u.uDayLight, env.dayLight);
    this.fwd = dirFromAngles(cam.yaw, cam.pitch);
  }

  // sun/moon/stars; call right after beginFrame
  drawSky(sunAngle, starAlpha) {
    const gl = this.gl;
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(this.u.uNoFog, 1);
    gl.uniform1f(this.u.uDayLight, 1);
    const camT = M4.translate(this.cam.pos[0], this.cam.pos[1], this.cam.pos[2]);

    if (starAlpha > 0.01) {
      gl.uniform1f(this.u.uColorMode, 1);
      gl.uniform4f(this.u.uColor, 1, 1, 1, starAlpha);
      const m = M4.mul(camT, M4.mul(M4.rotZ(sunAngle), M4.scale(900, 900, 900)));
      gl.uniformMatrix4fv(this.u.uModel, false, m);
      this._draw(this.stars);
      gl.uniform1f(this.u.uColorMode, 0);
    }

    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    const drawOrb = (angle, tile, size) => {
      const uv = tileUV(tile);
      // remap quad UV (0..1) to the tile by drawing with a temp mesh? cheaper:
      // reuse quad and set UV via uniform trick is overkill — use crack mesh
      // path instead: build tiny dynamic quad
      const v = [];
      const corners = [[-0.5,-0.5],[0.5,-0.5],[0.5,0.5],[-0.5,-0.5],[0.5,0.5],[-0.5,0.5]];
      const uvs = [[uv.u0,uv.v1],[uv.u1,uv.v1],[uv.u1,uv.v0],[uv.u0,uv.v1],[uv.u1,uv.v0],[uv.u0,uv.v0]];
      for (let i = 0; i < 6; i++) v.push(corners[i][0], corners[i][1], 0, uvs[i][0], uvs[i][1], 1);
      if (!this.orbMesh) this.orbMesh = this.makeMesh(new Float32Array(v), 'TRIANGLES', true);
      else this.updateMesh(this.orbMesh, new Float32Array(v));
      let m = M4.mul(M4.rotZ(angle), M4.translate(700, 0, 0));
      m = M4.mul(m, M4.mul(M4.rotY(-Math.PI / 2), M4.scale(size, size, size)));
      gl.uniformMatrix4fv(this.u.uModel, false, M4.mul(camT, m));
      this._draw(this.orbMesh);
    };
    drawOrb(sunAngle, TILE.SUN, 90);
    drawOrb(sunAngle + Math.PI, TILE.MOON, 60);

    gl.uniform1f(this.u.uNoFog, 0);
    gl.uniform1f(this.u.uDayLight, this.env.dayLight);
    gl.uniformMatrix4fv(this.u.uModel, false, this.IDENT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  _visible(cx, cz) {
    const dx = (cx + 0.5) * CHUNK - this.cam.pos[0];
    const dz = (cz + 0.5) * CHUNK - this.cam.pos[2];
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < CHUNK * 2.2) return true;
    return (dx * this.fwd[0] + dz * this.fwd[2]) / d > -0.35;
  }

  drawChunksSolid(renderDist) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1f(this.u.uAlphaTest, 1);
    const maxD = renderDist * CHUNK;
    for (const m of this.chunkMeshes.values()) {
      if (!m.solid) continue;
      if (!this._withinDist(m, maxD) || !this._visible(m.cx, m.cz)) continue;
      this._draw(m.solid);
    }
    gl.uniform1f(this.u.uAlphaTest, 0);
  }

  drawChunksWater(renderDist) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.depthMask(false);
    gl.uniform1f(this.u.uAlphaMul, 0.82);
    const maxD = renderDist * CHUNK;
    const list = [];
    for (const m of this.chunkMeshes.values()) {
      if (!m.water) continue;
      if (!this._withinDist(m, maxD) || !this._visible(m.cx, m.cz)) continue;
      const dx = (m.cx + 0.5) * CHUNK - this.cam.pos[0];
      const dz = (m.cz + 0.5) * CHUNK - this.cam.pos[2];
      list.push([dx * dx + dz * dz, m]);
    }
    list.sort((a, b) => b[0] - a[0]);
    for (const [, m] of list) this._draw(m.water);
    gl.uniform1f(this.u.uAlphaMul, 1);
    gl.depthMask(true);
  }

  _withinDist(m, maxD) {
    const dx = (m.cx + 0.5) * CHUNK - this.cam.pos[0];
    const dz = (m.cz + 0.5) * CHUNK - this.cam.pos[2];
    return dx * dx + dz * dz <= (maxD + CHUNK) * (maxD + CHUNK);
  }

  drawClouds(offset) {
    const gl = this.gl;
    gl.depthMask(false);
    gl.bindTexture(gl.TEXTURE_2D, this.cloudTex);
    gl.uniform1f(this.u.uUVWorld, 1);
    gl.uniform2f(this.u.uUVOffset, offset, offset * 0.3);
    gl.uniform1f(this.u.uNoFog, 1);
    const m = M4.mul(
      M4.translate(this.cam.pos[0], WORLD_H + 14, this.cam.pos[2]),
      M4.mul(M4.rotX(-Math.PI / 2), M4.scale(1900, 1900, 1))
    );
    gl.uniformMatrix4fv(this.u.uModel, false, m);
    this._draw(this.quad);
    gl.uniformMatrix4fv(this.u.uModel, false, this.IDENT);
    gl.uniform1f(this.u.uUVWorld, 0);
    gl.uniform1f(this.u.uNoFog, 0);
    gl.depthMask(true);
  }

  drawSelection(x, y, z) {
    const gl = this.gl;
    gl.uniform1f(this.u.uColorMode, 1);
    gl.uniform4f(this.u.uColor, 0.05, 0.05, 0.05, 0.85);
    gl.uniformMatrix4fv(this.u.uModel, false, M4.translate(x, y, z));
    this._draw(this.wireCube);
    gl.uniform1f(this.u.uColorMode, 0);
    gl.uniformMatrix4fv(this.u.uModel, false, this.IDENT);
  }

  drawCrack(x, y, z, stage) {
    const gl = this.gl;
    stage = clamp(stage | 0, 0, 9);
    if (this._crackStage !== stage) {
      this._crackStage = stage;
      this.updateMesh(this.crackMesh, makeCubeVerts(1.002, 1.002, 1.002, () => tileUV(TILE.CRACK_0 + stage), 1));
    }
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1f(this.u.uAlphaTest, 1);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-1, -2);
    gl.uniformMatrix4fv(this.u.uModel, false, M4.translate(x - 0.001, y - 0.001, z - 0.001));
    this._draw(this.crackMesh);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.uniform1f(this.u.uAlphaTest, 0);
    gl.uniformMatrix4fv(this.u.uModel, false, this.IDENT);
  }

  // generic textured box (entities, first-person arm, held block)
  drawBox(mesh, model, texture, opts = {}) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (opts.noFog) gl.uniform1f(this.u.uNoFog, 1);
    if (opts.alphaTest) gl.uniform1f(this.u.uAlphaTest, 1);
    if (opts.tint) gl.uniform4fv(this.u.uTint, opts.tint);
    gl.uniformMatrix4fv(this.u.uModel, false, model);
    this._draw(mesh);
    if (opts.noFog) gl.uniform1f(this.u.uNoFog, 0);
    if (opts.alphaTest) gl.uniform1f(this.u.uAlphaTest, 0);
    if (opts.tint) gl.uniform4f(this.u.uTint, 0, 0, 0, 1);
  }

  endWorld() {
    this.gl.uniformMatrix4fv(this.u.uModel, false, this.IDENT);
  }

  // draw in camera space (first person arm): clears depth so it's never inside walls
  beginViewSpace() {
    const gl = this.gl;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(this.u.uView, false, this.IDENT);
    gl.uniform1f(this.u.uNoFog, 1);
    gl.uniform3f(this.u.uCamPos, 0, 0, 0);
  }
  endViewSpace() {
    const gl = this.gl;
    gl.uniformMatrix4fv(this.u.uView, false, this.view);
    gl.uniform1f(this.u.uNoFog, 0);
    gl.uniform3fv(this.u.uCamPos, this.cam.pos);
  }

  makeTextTexture(text) {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    ctx.font = 'bold 28px monospace';
    const w = Math.ceil(ctx.measureText(text).width) + 16;
    cv.width = w; cv.height = 40;
    const c2 = cv.getContext('2d');
    c2.fillStyle = 'rgba(0,0,0,0.4)';
    c2.fillRect(0, 0, w, 40);
    c2.font = 'bold 28px monospace';
    c2.fillStyle = '#fff';
    c2.textAlign = 'center';
    c2.textBaseline = 'middle';
    c2.fillText(text, w / 2, 21);
    return { tex: this.textureFromCanvas(cv, false, false), aspect: w / 40 };
  }

  drawNametag(tag, x, y, z) {
    const gl = this.gl;
    const dx = this.cam.pos[0] - x, dz = this.cam.pos[2] - z;
    const yaw = Math.atan2(dx, dz);
    const h = 0.28;
    const m = M4.mul(M4.translate(x, y, z), M4.mul(M4.rotY(yaw), M4.scale(h * tag.aspect, h, 1)));
    gl.uniform1f(this.u.uDayLight, 1);
    this.drawBox(this.quad, m, tag.tex);
    gl.uniform1f(this.u.uDayLight, this.env.dayLight);
  }

  _draw(mesh) {
    const gl = this.gl;
    gl.bindVertexArray(mesh.vao);
    gl.drawArrays(mesh.mode, 0, mesh.count);
    gl.bindVertexArray(null);
  }
}

// axis-aligned cuboid (origin corner at 0,0,0) with per-face uv + baked shading.
// uvFor(faceIndex) -> {u0,v0,u1,v1}; faces: 0:+X 1:-X 2:+Y 3:-Y 4:+Z 5:-Z
function makeCubeVerts(w, h, d, uvFor, lightMul = 1) {
  const shades = [0.7, 0.7, 1.0, 0.6, 0.85, 0.85];
  const out = [];
  const faces = [
    [[w,0,d],[w,0,0],[w,h,0],[w,h,d]],
    [[0,0,0],[0,0,d],[0,h,d],[0,h,0]],
    [[0,h,d],[w,h,d],[w,h,0],[0,h,0]],
    [[0,0,0],[w,0,0],[w,0,d],[0,0,d]],
    [[0,0,d],[w,0,d],[w,h,d],[0,h,d]],
    [[w,0,0],[0,0,0],[0,h,0],[w,h,0]],
  ];
  for (let f = 0; f < 6; f++) {
    const uv = uvFor(f);
    if (!uv) continue;
    const uvs = [[uv.u0, uv.v1], [uv.u1, uv.v1], [uv.u1, uv.v0], [uv.u0, uv.v0]];
    const c = faces[f];
    for (const vi of [0, 1, 2, 0, 2, 3]) {
      out.push(c[vi][0], c[vi][1], c[vi][2], uvs[vi][0], uvs[vi][1], shades[f] * lightMul);
    }
  }
  return new Float32Array(out);
}
