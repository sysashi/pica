/*global window,document*/
'use strict';


var unsharp = require('./js/unsharp');
var generateId = require('./js/generate_id');

var shadersContent = {};

/*eslint-disable no-path-concat*/
shadersContent['#vsh-basic'] =`
precision highp float;
attribute vec2 a_position;
attribute vec2 a_texCoord;

uniform vec2 u_resolution;

varying vec2 v_texCoord;

void main() {
   vec2 clipSpace = a_position / u_resolution * 2.0 - 1.0;

   gl_Position = vec4(clipSpace, 0, 1);
   v_texCoord = a_texCoord;
}`

shadersContent['#fsh-lanczos-1d-covolve-horizontal'] =`
precision highp float;
uniform vec2 u_resolution;
uniform sampler2D u_image;
uniform vec2 u_imageSize;

#define winSize 3.0

varying vec2 v_texCoord;

#define sinc(a) (sin(a)/a)
#define M_PI 3.1415926535897932384626433832795

void main() {
  vec2 pixel = vec2(1.) / u_imageSize;
  gl_FragColor = vec4(0.);

  float total = 0.;
  float scale = u_imageSize.x / u_resolution.x;
  float count = winSize * scale * 2.;
  for (int i = 0; i < 1024*8; i++) {
    if (float(i) >= count) {
      break;
    }
    float k = float(i) - (count / 2.);
    vec2 offset = vec2(pixel.x * k, 0.);
    vec4 c = texture2D(u_image, v_texCoord+offset);
    float x = k / scale; // max [-3, 3]
    float xpi = x * M_PI;
    float b = sinc(xpi) * sinc(xpi / winSize);
    if (x > -1.19209290E-07 && x < 1.19209290E-07) { 
      b = 1.;
    }
    total += b;
    c *= vec4(b);
    gl_FragColor += c;
  }
  gl_FragColor /= vec4(total);
}
`

shadersContent['#fsh-lanczos-1d-covolve-vertical'] =`
precision highp float;
uniform vec2 u_resolution;
uniform sampler2D u_image;
uniform vec2 u_imageSize;

#define winSize 3.0

varying vec2 v_texCoord;

#define sinc(a) (sin(a)/a)
#define M_PI 3.1415926535897932384626433832795

void main() {
  vec2 pixel = vec2(1.) / u_imageSize;
  gl_FragColor = vec4(0.);

  float total = 0.;
  float scale = u_imageSize.y / u_resolution.y;
  float count = winSize * scale * 2.;
  for (int i = 0; i < 1024*8; i++) {
    if (float(i) >= count) {
      break;
    }
    float k = float(i) - (count / 2.);
    vec2 offset = vec2(0., pixel.y * k);
    vec4 c = texture2D(u_image, v_texCoord+offset);
    float x = k / scale; // max [-3, 3]
    float xpi = x * M_PI;
    float b = sinc(xpi) * sinc(xpi / winSize);
    if (x > -1.19209290E-07 && x < 1.19209290E-07) { 
      b = 1.;
    }
    total += b;
    c *= vec4(b);
    gl_FragColor += c;
  }
  gl_FragColor /= vec4(total);
}
`

function error(msg) {
  try {
    (window.console.error || window.console.log).call(window.console, msg);
  } catch (__) {}
}


function checkGlError(gl) {
  var e = gl.getError();
  if (e !== gl.NO_ERROR) { throw new Error('gl error ' + e); }
}


function createGl(canvas) {
  return canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
}


function createShader(gl, type, src) {
  var shader = gl.createShader(type);

  gl.shaderSource(shader, src);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    error('Shader compile error: ' + gl.getShaderInfoLog(shader) + '. Source: `' + src + '`');
    gl.deleteShader(shader);
    return null;
  }

  return shader;
}


function createProgram(gl, vshFile, fshFile) {
  var vertexShader = createShader(gl, gl.VERTEX_SHADER, shadersContent[vshFile]);
  var fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, shadersContent[fshFile]);

  var program = gl.createProgram();

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);

  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    error('Program linking error: ' + gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
  }

  checkGlError(gl);
  return program;
}


function setAttributeValues(gl, program, name, values, options) {
  var a = gl.getAttribLocation(program, name);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, options.elementSize, gl.FLOAT, false, 0, 0);
  checkGlError(gl);
}


function loadTexture(gl, texUnit, data) {
  var tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + texUnit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, data);
  checkGlError(gl);
  return tex;
}


function setUniform1i(gl, program, name, i0) {
  var u = gl.getUniformLocation(program, name);
  gl.uniform1i(u, i0);
}


function setUniform2f(gl, program, name, f0, f1) {
  var u = gl.getUniformLocation(program, name);
  gl.uniform2f(u, f0, f1);
}


function vec2Rectangle(x, y, w, h) {
  var x1 = x;
  var x2 = x + w;
  var y1 = y;
  var y2 = y + h;
  return [ x1, y1, x2, y1, x1, y2, x1, y2, x2, y1, x2, y2 ];
}


function createTextureSize(gl, texUnit, width, height) {
  var tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + texUnit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  checkGlError(gl);
  return tex;
}


function setupTextureFBO(gl, texUnit, width, height) {
  var texture = createTextureSize(gl, texUnit, width, height);

  var oldFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING);

  var fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

//  gl.viewport(0, 0, width, height);

  checkGlError(gl);

  return {
    fbo: fbo,
    texture: texture,
    oldFbo: oldFbo
  };
}


function convolve(gl, texUnit0, texWidth, texHeight, texUnit, fsh, destW, destH, flipY) {
  var program = createProgram(gl, '#vsh-basic', fsh);

  gl.useProgram(program);

  setUniform1i(gl, program, 'u_image', texUnit0);
  setUniform2f(gl, program, 'u_imageSize', texWidth, texHeight);
  setUniform2f(gl, program, 'u_resolution', destW, destH);

  setAttributeValues(gl, program, 'a_texCoord',
    [ 0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1 ], { elementSize: 2 });
  setAttributeValues(gl, program, 'a_position',
    !flipY ? vec2Rectangle(0, 0, destW, destH) : vec2Rectangle(0, destH, destW, -destH), { elementSize: 2 });

  gl.viewport(0, 0, destW, destH);

  var fboObject = setupTextureFBO(gl, texUnit, destW, destH);

  gl.viewport(0, 0, destW, destH);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fboObject.oldFbo);

  checkGlError(gl);

  return fboObject;
}


function webglProcessResize(from, gl, options) {

  var srcW = from.naturalWidth || from.width,
      srcH = from.naturalHeight || from.height,
      dstW = gl.canvas.width,
      dstH = gl.canvas.height;

  gl.viewport(0, 0, dstW, dstH);

  var texUnit0 = 0;

  loadTexture(gl, texUnit0, from);

  // resize [

  var texUnit2 = 2;
  var texUnit3 = 3;

  convolve(gl, texUnit0, srcW, srcH,
    texUnit2, '#fsh-lanczos-1d-covolve-horizontal', dstW, srcH, false);

  var finalFboObject = convolve(gl, texUnit2, dstW, srcH,
    texUnit3, '#fsh-lanczos-1d-covolve-vertical', dstW, dstH, true);

  // resize ]

  gl.flush();

  var fb = gl.createFramebuffer();

  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, finalFboObject.texture, 0);

  var fb_status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);

  if (fb_status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Bad framebuffer status: ' + fb_status);
  }

  // Clear alpha for sure, if disabled.
  if (!options.alpha) {
    gl.clearColor(1, 1, 1, 1);
    gl.colorMask(false, false, false, true);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  var pixels = new Uint8Array(dstW * dstH * 4);

  gl.readPixels(0, 0, dstW, dstH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

  var unsharpAmount = typeof options.unsharpAmount === 'undefined' ? 0 : (options.unsharpAmount | 0);
  var unsharpRadius = typeof options.unsharpRadius === 'undefined' ? 0 : (options.unsharpRadius);
  var unsharpThreshold = typeof options.unsharpThreshold === 'undefined' ? 0 : (options.unsharpThreshold | 0);

  if (unsharpAmount) {
    unsharp(pixels, dstW, dstH, unsharpAmount, unsharpRadius, unsharpThreshold);
  }

  return pixels;
}


module.exports = function (from, to, options, callback) {
  var gl, canvas;

  try {
    // create temporarry canvas [

    canvas = document.createElement('canvas');
    canvas.id = 'pica-webgl-temporarry-canvas';
    canvas.height = to.height;
    canvas.width = to.width;
    document.body.appendChild(canvas);

    // create temporarry canvas ]

    gl = createGl(canvas);

    var data = webglProcessResize(from, gl, options);

    gl.finish();
    document.body.removeChild(canvas);

    var ctxTo = to.getContext('2d');
    var imageDataTo = ctxTo.createImageData(to.width, to.height);

    imageDataTo.data.set(data);
    ctxTo.putImageData(imageDataTo, 0, 0);

    callback(null, data);
  } catch (e) {
    error(e);
    gl.finish();
    document.body.removeChild(canvas);
    callback(e);
  }

  return generateId();
};

module.exports.terminate = function () {};
